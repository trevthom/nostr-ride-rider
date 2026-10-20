// ════════════════════════════════════════════════════════════
//  ECASH — The ecash (Cashu) wallet both apps use. A rider pays the driver
//  in small ecash tokens while the ride runs (lib/ticks.js); the driver
//  redeems each token at the mint straight away, so the money is theirs as it
//  is earned. Ecash is a bearer note: whoever holds the token owns it.
//
//  This file holds the wallet's BOOKKEEPING and has no network code of its
//  own. Everything that talks to a mint goes through a small "mint adapter"
//  (nostr/cashuMint.js is the real one; the tests use a fake mint):
//
//    adapter(url) → {
//      quoteMint(sats) → { id, invoice, expiry }      ask the mint for a Lightning invoice to fund
//      quoteState(id) → "UNPAID" | "PAID" | "ISSUED"
//      mint(sats, id) → proofs                         turn a paid invoice into ecash
//      onchainSupported() → bool                       does the mint take on-chain deposits (NUT-30)?
//      onchainPubkey(index) → hex                      the key quote number `index` is locked to (no network; only this phrase can sign for it)
//      quoteOnchain(index) → { id, address, expiry, pubkey }   a bitcoin address for quote number `index` (its key comes from the recovery seed)
//      onchainState(id) → { paid, issued }             sats the mint saw paid to the address / already issued as ecash
//      mintOnchain(id, index, sats, {random}) → proofs turn `sats` of a paid deposit into ecash
//      split(proofs, sats) → { keep, send }            exactly `sats` to send (fees on top), the rest to keep
//      receive(token) → proofs                         swap a received token for fresh proofs
//      quoteMelt(invoice) → { id, sats, fee }          what paying a Lightning invoice costs
//      melt(quote, proofs) → { paid, change }          pay it from ecash
//      states(proofs) → ["UNSPENT" | "SPENT" | "PENDING"]
//      encode(proofs) → "cashuB…"
//      restore() → { proofs, next }                    find the coins the mint signed for this recovery phrase and still
//                                                       calls unspent; next = { keysetId: first unused counter }
//    }
//
//  Recovery (see lib/recovery.js, nostr/ecashRecovery.js): the adapter makes every coin's secret from the person's
//  recovery phrase and a counter per keyset (Cashu NUT-13). The counters live here, in `state.counters`, and are
//  SAVED BEFORE the mint is asked (counterSource()), so a crash can never make the wallet reuse a number; a coin the
//  mint signed but the wallet never saved is found again by restore(). Coins SENT to someone else use random secrets,
//  so a restore never brings back a token that was already handed to a driver.
//
//  Safety rules:
//    • Proofs are saved on this device ONLY ENCRYPTED to the user's own key (NIP-44), in
//      pieces, because one NIP-44 message holds at most 64 KB.
//    • A token being sent is kept in `pending` until the event that carries it is published
//      (or queued in the outbox). A crash in between loses nothing: recoverPending() takes
//      back what the mint still says is unspent.
//    • A paid funding invoice is remembered (`quotes`) until its ecash is claimed, so a
//      reload between "paid" and "minted" loses nothing.
//    • Nobody but the user can read the proofs. Never log them. Never log the recovery phrase either.
//
//  The wallet is a plain object so it can be tested without a browser.
// ════════════════════════════════════════════════════════════

import { nip44 } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getSetting, setSetting } from "../config/relays.js";

const CHUNK = 30000; // characters per sealed piece
const sum = (proofs) => proofs.reduce((s, p) => s + Number(p.amount), 0);
export const proofsTotal = sum;

// code: "funds" | "amount" | "mint" | "token" | "used". `definitive` = the answer will not change if tried
// again (a mint that says "already spent"); false = worth another try (the mint did not answer).
export class EcashError extends Error {
  constructor(code, message, definitive = false) { super(message); this.code = code; this.definitive = definitive; }
}

// ── Saving: encrypted to the user's own key ──
export function makeStore(user) {
  const key = "ecash_" + user.publicKey.slice(0, 16);
  const mirror = "onchain_" + user.publicKey.slice(0, 16);
  const ck = () => nip44.getConversationKey(user.sk, user.publicKey);
  return {
    load() {
      const pieces = getSetting(key, null);
      if (!Array.isArray(pieces)) return null;
      try {
        return JSON.parse(pieces.map((p) => nip44.decrypt(p, ck())).join(""));
      } catch { return null; }
    },
    save(state) {
      const text = JSON.stringify(state);
      const pieces = [];
      for (let i = 0; i < text.length; i += CHUNK) pieces.push(nip44.encrypt(text.slice(i, i + CHUNK), ck()));
      setSetting(key, pieces);
    },
    erase() { setSetting(key, null); },
    // The on-chain deposit addresses (quote ids, numbers, addresses: no key, no coin) are ALSO kept as a plain setting, which the encrypted
    // backup (lib/backup.js, prefix "onchain_") carries to a new phone. A deposit sent to an address must stay claimable.
    loadOnchain() { const l = getSetting(mirror, []); return Array.isArray(l) ? l : []; },
    saveOnchain(list) { setSetting(mirror, list); },
  };
}

const emptyState = () => ({ v: 1, mints: {}, pending: [], quotes: [], redeemed: [], counters: {}, legacy: [], onchain: [], onchainIndex: 0 });

export class EcashWallet {
  // store: { load, save }   mintFor: (url) => adapter   tokenInfo: (token) => { mint, sats } | null
  constructor({ store, mintFor, tokenInfo }) {
    this.store = store;
    this.mintFor = mintFor;
    this.tokenInfo = tokenInfo;
    this.state = { ...emptyState(), ...(store.load() || {}) };
    this.listeners = new Set();
    this.busy = Promise.resolve(); // one money move at a time, so two taps cannot spend the same proofs
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _save() {
    this.store.save(this.state);
    this.listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  }
  _exclusive(fn) {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => {});
    return run;
  }
  _proofs(url) { return this.state.mints[url]?.proofs || []; }
  _setProofs(url, proofs) { this.state.mints[url] = { proofs }; }

  balance(url) { return sum(this._proofs(url)); }
  balances() { return Object.fromEntries(Object.keys(this.state.mints).map((u) => [u, this.balance(u)]).filter(([, b]) => b > 0)); }
  total() { return Object.values(this.balances()).reduce((a, b) => a + b, 0); }
  pendingList() { return this.state.pending.slice(); }
  quotesList() { return this.state.quotes.slice(); }

  // ── Funding: pay a Lightning invoice, get ecash ──
  // Returns { id, invoice, expiry }. Pay `invoice` with the NWC wallet or any Lightning wallet, then claim().
  fundStart(url, sats) {
    return this._exclusive(async () => {
      const amount = Math.round(sats);
      if (!(amount >= 1)) throw new EcashError("amount", "Enter an amount of at least 1 sat.");
      const q = await this.mintFor(url).quoteMint(amount);
      this.state.quotes.push({ id: q.id, mint: url, sats: amount, invoice: q.invoice, expiry: q.expiry ?? null, at: Date.now() });
      this.state.quotes = this.state.quotes.slice(-20);
      this._save();
      return q;
    });
  }

  // Claim one funding invoice if it has been paid. Returns { state, sats }:
  // state "UNPAID" (not yet), "ISSUED" (claimed now or before). Never claims twice.
  claim(id) {
    return this._exclusive(async () => {
      const q = this.state.quotes.find((x) => x.id === id);
      if (!q) return { state: "ISSUED", sats: 0 };
      const mint = this.mintFor(q.mint);
      const st = await mint.quoteState(id);
      if (st === "UNPAID") return { state: "UNPAID", sats: 0 };
      if (st === "ISSUED") { this.state.quotes = this.state.quotes.filter((x) => x.id !== id); this._save(); return { state: "ISSUED", sats: 0 }; }
      const proofs = await mint.mint(q.sats, id);
      this._setProofs(q.mint, [...this._proofs(q.mint), ...proofs]);
      this.state.quotes = this.state.quotes.filter((x) => x.id !== id);
      this._save();
      return { state: "ISSUED", sats: sum(proofs) };
    });
  }

  // Claim everything that was paid while the app was closed (invoices and on-chain deposits). Returns the sats added.
  async claimAll() {
    let added = 0;
    for (const q of this.quotesList()) {
      try { added += (await this.claim(q.id)).sats; } catch { /* the mint is down: try again later */ }
    }
    const now = Date.now() / 1000;
    for (const q of this.onchainList()) {
      if ((q.expiry != null && q.expiry < now) || !this._ownsOnchain(q)) continue;
      try { added += (await this.claimOnchain(q.id)).sats; } catch { /* the mint is down: try again later */ }
    }
    return added;
  }

  // ── Funding on-chain (NUT-30) ──
  // The mint gives a bitcoin address. When a payment to it is confirmed, the mint lets this wallet turn it into ecash (claimOnchain).
  // Only some mints can do this: onchainStart says so (EcashError "onchain") before anyone sends bitcoin to a mint that cannot.
  // The deposit addresses are kept in the wallet AND in a plain setting that the backup carries (see makeStore).
  onchainList() {
    const seen = new Set();
    return [...this.state.onchain, ...(this.store.loadOnchain?.() || [])].filter((q) => q && q.id && !seen.has(q.id) && seen.add(q.id));
  }
  // Is this address one THIS wallet can claim (its key comes from this wallet's recovery phrase)? An address from a backup of another
  // phrase is not: it is claimed by restoring with that phrase, and it is never handed out again.
  _ownsOnchain(q) {
    const mint = this.mintFor(q.mint);
    return typeof mint.onchainPubkey !== "function" || !q.pubkey || mint.onchainPubkey(q.index) === q.pubkey;
  }
  _saveOnchain() {
    this.state.onchain = this.onchainList().slice(-10);
    this._save();
    try { this.store.saveOnchain?.(this.state.onchain); } catch { /* only the backup copy is missed */ }
  }
  // Returns { id, mint, index, address, expiry }. The newest address at this mint that has not expired is used again: it can be paid many times.
  onchainStart(url) {
    return this._exclusive(async () => {
      const mint = this.mintFor(url);
      let ok = false;
      try { ok = typeof mint.onchainSupported === "function" && (await mint.onchainSupported()); }
      catch (e) { throw new EcashError("mint", e?.message || "The mint did not answer."); }
      if (!ok) throw new EcashError("onchain", "This mint does not take on-chain deposits. Use Lightning, or choose another mint.", true);
      const now = Date.now() / 1000;
      const have = this.onchainList().filter((q) => q.mint === url && (q.expiry == null || q.expiry > now) && this._ownsOnchain(q)).pop();
      if (have) return have;
      const index = (this.state.onchainIndex = (Number(this.state.onchainIndex) || 0) + 1);
      this._save(); // the number is used up before the mint is asked
      let q;
      try { q = await mint.quoteOnchain(index); }
      catch (e) { throw new EcashError("mint", e?.message || "The mint did not give an address."); }
      const rec = { id: q.id, mint: url, index, address: q.address, expiry: q.expiry ?? null, pubkey: q.pubkey ?? null, at: Date.now() };
      this.state.onchain = [...this.onchainList(), rec];
      this._saveOnchain();
      return rec;
    });
  }
  // Turn what the mint has seen paid to one address into ecash, once. Returns { state, sats, paid }:
  // "UNPAID" (nothing confirmed yet), "ISSUED" (sats = what was added now; 0 when there was nothing new), "NONE" (no such address here).
  claimOnchain(id) {
    return this._exclusive(async () => {
      const q = this.onchainList().find((x) => x.id === id);
      if (!q) return { state: "NONE", sats: 0, paid: 0 };
      if (!this._ownsOnchain(q)) throw new EcashError("onchain", "This address belongs to another recovery phrase. Restore with that phrase to collect it.", true);
      const mint = this.mintFor(q.mint);
      const st = await mint.onchainState(id);
      const due = st.paid - st.issued;
      if (due <= 0) return { state: st.paid > 0 ? "ISSUED" : "UNPAID", sats: 0, paid: st.paid };
      const proofs = await mint.mintOnchain(id, q.index, due);
      this._setProofs(q.mint, [...this._proofs(q.mint), ...proofs]);
      this._save();
      return { state: "ISSUED", sats: sum(proofs), paid: st.paid };
    });
  }

  // ── Paying: take exactly `sats` out as a token ──
  // Returns { id, token, sats }. Call settle(id) once the event carrying the token is published
  // (or queued), or unreserve(id) if it never will be. Throws EcashError "funds" when short.
  pay(url, sats) {
    return this._exclusive(async () => {
      const amount = Math.round(sats);
      if (!(amount >= 1)) throw new EcashError("amount", "Nothing to pay.");
      const have = this._proofs(url);
      if (sum(have) < amount) throw new EcashError("funds", "Not enough ecash at this mint.");
      const mint = this.mintFor(url);
      let split;
      try {
        split = await mint.split(have, amount);
      } catch (e) {
        // Fees can make the exact amount a few sats short of the balance.
        throw new EcashError(sum(have) - amount < 5 ? "funds" : "mint", e?.message || "The mint did not answer.");
      }
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      this._setProofs(url, split.keep);
      this.state.pending.push({ id, mint: url, sats: amount, proofs: split.send, at: Date.now() });
      this._save();
      return { id, token: mint.encode(split.send), sats: amount };
    });
  }
  // Like pay(), but when the mint's fee makes the whole balance a few sats too short, sends the most the balance allows.
  // Spending proofs costs the sender a fee, so a wallet cannot send back every sat it holds. Returns the same as pay();
  // read `sats` for what was really sent. Only a "funds" shortage is retried; the checks are local, so a miss costs no mint call.
  async payUpTo(url, sats) {
    let amount = Math.min(Math.round(sats), this.balance(url));
    for (let cut = 1; ; cut *= 2) {
      try { return await this.pay(url, amount); }
      catch (e) {
        if (e.code !== "funds" || cut > 256 || amount - cut < 1) throw e;
        amount -= cut;
      }
    }
  }
  settle(id) {
    this.state.pending = this.state.pending.filter((p) => p.id !== id);
    this._save();
  }
  unreserve(id) {
    const p = this.state.pending.find((x) => x.id === id);
    if (!p) return;
    this._setProofs(p.mint, [...this._proofs(p.mint), ...p.proofs]);
    this.settle(id);
  }
  // After a crash: a pending token older than `afterMs` whose proofs the mint still calls unspent was never
  // delivered, so it goes back into the wallet. Spent ones were delivered and are dropped.
  async recoverPending(afterMs = 5 * 60000) {
    for (const p of this.pendingList()) {
      if (Date.now() - p.at < afterMs) continue;
      try {
        const states = await this.mintFor(p.mint).states(p.proofs);
        if (states.every((s) => s === "UNSPENT")) this.unreserve(p.id);
        else if (states.every((s) => s === "SPENT")) this.settle(p.id);
      } catch { /* the mint is down: keep it for next time */ }
    }
  }

  // ── Receiving: a token someone sent us ──
  // `only` (optional) = the mint URLs we accept. `ref` (optional) = what this token paid for (a tick's id): it is saved with the
  // token's fingerprint, so the SAME payment seen again is recognised (`EcashError.ref` / `.sats` on a "used" error) while the same
  // token inside ANOTHER payment is a replay. Returns { sats, mint }. Throws EcashError.
  redeem(token, { only, ref } = {}) {
    return this._exclusive(async () => {
      const meta = this.tokenInfo(token);
      if (!meta) throw new EcashError("token", "That is not an ecash token.", true);
      if (only && !only.includes(meta.mint)) throw new EcashError("mint", "This token is from a mint we do not accept.", true);
      const tag = bytesToHex(sha256(new TextEncoder().encode(token))).slice(0, 32); // a fingerprint of the whole token
      const prev = this.state.redeemed.find((x) => (x.h || x) === tag);
      if (prev) {
        const err = new EcashError("used", "This token was already redeemed.", true);
        err.ref = prev.ref ?? null;
        err.sats = prev.sats ?? null;
        throw err;
      }
      let proofs;
      try {
        proofs = await this.mintFor(meta.mint).receive(token);
      } catch (e) {
        throw new EcashError("mint", e?.message || "The mint refused this token (already spent?).", e?.definitive === true);
      }
      this._setProofs(meta.mint, [...this._proofs(meta.mint), ...proofs]);
      this.state.redeemed = [...this.state.redeemed, { h: tag, ref: ref ?? null, sats: sum(proofs) }].slice(-500);
      this._save();
      return { sats: sum(proofs), mint: meta.mint };
    });
  }

  // ── Cashing out to Lightning ──
  // getInvoice(sats) → a bolt11 invoice for exactly that amount (for example from a Lightning address).
  // Pays as much of the balance as the mint's fee allows. Returns { paidSats, feeSats, preimage }.
  cashOut(url, getInvoice) {
    return this._exclusive(async () => {
      const mint = this.mintFor(url);
      const have = this._proofs(url);
      const balance = sum(have);
      if (balance < 2) throw new EcashError("funds", "Nothing to cash out.");
      // The mint tells the fee only when it is shown an invoice, so look for the largest invoice whose amount + fee
      // (+ the mint's fee for spending the proofs, known only when the proofs are split) fits the balance. Aim to leave
      // 2-6 sats over; if the split still does not fit, ask for a smaller invoice.
      let amount = Math.max(1, balance - Math.ceil(balance * 0.02) - 2);
      let best = null, split = null;
      for (let attempt = 0; attempt < 4 && !split; attempt++) {
        best = null;
        for (let i = 0; i < 6; i++) {
          const quote = await mint.quoteMelt(await getInvoice(amount));
          const need = quote.sats + quote.fee;
          const slack = balance - need;
          if (slack >= 0) best = { quote, need };
          if (slack >= 2 && slack <= 6) break;
          amount = Math.max(1, amount + slack - 4);
        }
        if (!best) break;
        try {
          split = await mint.split(have, best.need);
        } catch {
          amount = Math.max(1, best.quote.sats - 3); // the input fee did not fit
        }
      }
      if (!best || !split) throw new EcashError("funds", "The balance is too small to cover the mint's fee.");
      return this._meltWith(url, mint, best.quote, best.need, split);
    });
  }

  // The last steps of every Lightning payment: the coins that pay it leave the balance and wait in `pending`; the mint pays; the
  // change comes back. A payment that fails puts the coins back. Runs inside the money lock. Returns { paidSats, feeSats, preimage }.
  async _meltWith(url, mint, q, need, split) {
    this._setProofs(url, split.keep);
    this.state.pending.push({ id: "melt-" + q.id, mint: url, sats: need, proofs: split.send, at: Date.now() });
    this._save();
    let res;
    try {
      res = await mint.melt(q, split.send);
    } catch (e) {
      this.unreserve("melt-" + q.id);
      throw new EcashError("mint", e?.message || "The mint could not pay the invoice.");
    }
    if (!res.paid) { this.unreserve("melt-" + q.id); throw new EcashError("mint", "The Lightning payment failed. Your ecash is still here."); }
    this._setProofs(url, [...this._proofs(url), ...res.change]);
    this.settle("melt-" + q.id);
    return { paidSats: q.sats, feeSats: need - sum(res.change) - q.sats, preimage: res.preimage || null };
  }

  // ── Sending to another wallet ──
  // Pay a Lightning invoice (any wallet's) from the ecash held at `url`. The invoice must name an amount. The mint's fee comes on top
  // (and the fee for spending the coins), so the wallet needs a little more than the invoice. Returns { paidSats, feeSats, preimage }.
  payInvoice(url, invoice) {
    return this._exclusive(async () => {
      const mint = this.mintFor(url);
      const have = this._proofs(url);
      const balance = sum(have);
      if (balance < 2) throw new EcashError("funds", "Not enough ecash at this mint.");
      let quote;
      try { quote = await mint.quoteMelt(invoice); }
      catch (e) { throw new EcashError("mint", e?.message || "The mint could not read that invoice."); }
      const need = quote.sats + quote.fee;
      if (need > balance) throw new EcashError("funds", `Not enough ecash: this payment needs ${need.toLocaleString()} sats with the mint's fee, and you have ${balance.toLocaleString()}.`);
      let split;
      try { split = await mint.split(have, need); }
      catch { throw new EcashError("funds", "Not enough ecash to cover the mint's fee as well."); }
      return this._meltWith(url, mint, quote, need, split);
    });
  }

  // A token that was taken out to hand over by hand (`pay`, then shown on screen): has the other person taken it yet?
  // The mint says. Still unspent → the coins come back into the wallet; spent → it was delivered and is forgotten.
  // Returns "back" | "taken". Throws EcashError "mint" when the mint cannot say (the token stays pending).
  reclaim(id) {
    return this._exclusive(async () => {
      const p = this.state.pending.find((x) => x.id === id);
      if (!p) return "taken";
      let states;
      try { states = await this.mintFor(p.mint).states(p.proofs); }
      catch (e) { throw new EcashError("mint", e?.message || "The mint did not answer. Try again in a moment."); }
      if (states.every((x) => x === "UNSPENT")) { this.unreserve(id); return "back"; }
      if (states.every((x) => x === "SPENT")) { this.settle(id); return "taken"; }
      throw new EcashError("mint", "The mint is still working on this token. Try again in a moment.");
    });
  }

  // Drop the coins the mint calls SPENT. Money that was moved elsewhere (a restore on another device swaps every coin, so the copies
  // on this device are spent) must not stay in this device's balance. The mint is asked WITHOUT holding the money lock (a slow mint must
  // never hold up a payment); only coins that are still held and reported spent are removed. Returns the sats dropped.
  async syncSpent() {
    let dropped = 0;
    for (const url of Object.keys(this.state.mints)) {
      const snapshot = this._proofs(url).slice();
      if (!snapshot.length) continue;
      let states;
      try { states = await this.mintFor(url).states(snapshot); } catch { continue; } // the mint is down: try again later
      if (!Array.isArray(states) || states.length !== snapshot.length) continue;
      const gone = new Set(snapshot.filter((_, i) => states[i] === "SPENT").map((p) => p.secret));
      if (!gone.size) continue;
      await this._exclusive(async () => {
        const have = this._proofs(url);
        const keep = have.filter((p) => !gone.has(p.secret));
        dropped += sum(have) - sum(keep);
        this._setProofs(url, keep);
      });
    }
    if (dropped) this._save();
    return dropped;
  }

  // Forget everything this device holds: the coins, the counters, the pending and unclaimed lists, and the saved copy. Used by
  // recovery.disconnect() after the coins were swapped; the wallet object is not used again.
  wipe() {
    this.state = emptyState();
    this._counters = null;
    try { this.store.erase?.(); } catch { /* nothing to erase */ }
    this.listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  }

  // Is `url` a working mint? Resolves { name } or throws an EcashError with a short reason (an address that is a website, a mint that
  // does not answer). Used before a mint address is saved.
  async checkMint(url) {
    const m = this.mintFor(url);
    if (typeof m.info !== "function") return { name: "" };
    try { return await m.info(); }
    catch (e) { throw new EcashError("mint", e?.message || "The mint did not answer.", e?.definitive === true); }
  }

  // ── Recovery: counters, restore, rotate ──
  // The counter source the Cashu client uses for deterministic coins. Every change is saved (synchronously) BEFORE the
  // client builds its request to the mint: a number is never used twice, even if the app dies in the middle.
  counterSource() {
    if (this._counters) return this._counters;
    const c = () => (this.state.counters ||= {});
    const next = (id) => Math.max(0, Math.floor(Number(c()[id]) || 0));
    this._counters = {
      reserve: async (id, n) => {
        const start = next(id);
        if (n > 0) { c()[id] = start + n; this._save(); }
        return { start, count: n };
      },
      reserveAt: async (id, start, count) => {
        if (start < next(id)) throw new EcashError("counter", "That counter range was already used.");
        c()[id] = start + count;
        this._save();
        return { start, count };
      },
      advanceToAtLeast: async (id, min) => { if (next(id) < min) { c()[id] = min; this._save(); } },
      snapshot: async () => ({ ...c() }),
      setNext: async (id, n) => { c()[id] = n; this._save(); },
    };
    return this._counters;
  }

  // Swap every coin held at `url` for fresh ones. Coins that were copied somewhere (a lost phone, a backup) are spent
  // at the mint by this, so the copies are worth nothing. Returns { sats } held after. Throws EcashError.
  rotate(url) {
    return this._exclusive(() => this._rotate(url));
  }
  async _rotate(url) {
    const have = this._proofs(url);
    if (!have.length) return { sats: 0 };
    const mint = this.mintFor(url);
    let fresh;
    try {
      fresh = await mint.receive(mint.encode(have));
    } catch (e) {
      throw new EcashError("mint", e?.message || "The mint did not answer.", e?.definitive === true);
    }
    this._setProofs(url, fresh);
    this._save();
    return { sats: sum(fresh) };
  }

  // Find the ecash that belongs to this wallet's recovery phrase at each mint (a device that took the person's phrase: nostr/cashuMint.js
  // restoreWallet). The coins the mint still calls UNSPENT are kept at once, the counters move past the numbers already used, then the
  // coins are swapped for fresh ones under the same phrase, so a copy on a lost phone is spent. Deposits sent to an on-chain address of
  // this phrase are collected afterwards by claimAll. Returns [{ mint, found, added, rotated, error }] per mint.
  restore(urls) {
    return this._exclusive(async () => {
      const rows = [];
      for (const url of [...new Set(urls)]) {
        const row = { mint: url, found: 0, added: 0, rotated: false, error: "" };
        rows.push(row);
        try {
          let { proofs, next } = await this.mintFor(url).restore();
          row.found = sum(proofs);
          const inFlight = new Set(this.state.pending.flatMap((p) => p.proofs.map((x) => x.secret)));
          const mine = new Set(this._proofs(url).map((p) => p.secret));
          const take = proofs.filter((p) => !inFlight.has(p.secret) && !mine.has(p.secret));
          for (const [id, n] of Object.entries(next || {})) await this.counterSource().advanceToAtLeast(id, n);
          this._setProofs(url, [...this._proofs(url), ...take]);
          this._save();
          row.added = sum(take);
          try { await this._rotate(url); row.rotated = true; } catch { /* the coins are kept; rotating can be tried again */ }
        } catch (e) {
          row.error = e?.message || "The mint did not answer.";
        }
      }
      return rows;
    });
  }

  // Coins made before the wallet had a recovery phrase (random secrets) are swapped, once, for coins under the phrase.
  // `state.legacy` lists the mints that still hold old coins. Safe to call again: a mint that fails stays listed.
  async migrate() {
    for (const url of [...(this.state.legacy || [])]) {
      try {
        await this.rotate(url);
        this.state.legacy = this.state.legacy.filter((u) => u !== url);
        this._save();
      } catch { /* the mint is down: try again next time */ }
    }
  }

  // Everything, as tokens, to keep a backup (one token per mint).
  exportTokens() {
    return Object.keys(this.state.mints)
      .filter((u) => this.balance(u) > 0)
      .map((u) => ({ mint: u, sats: this.balance(u), token: this.mintFor(u).encode(this._proofs(u)) }));
  }
}
