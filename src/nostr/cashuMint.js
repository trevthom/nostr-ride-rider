// ════════════════════════════════════════════════════════════
//  CASHU MINT — The real "mint adapter" for nostr/ecash.js, built on the
//  @cashu/cashu-ts client. It is the only file that imports that library;
//  the apps load it on demand (loadEcash), so the code is fetched only when
//  a person uses ecash.
//
//  Recovery: with a `seed` (from the person's recovery phrase, lib/recovery.js) every coin the wallet MAKES for itself gets its
//  secret from the recipe seed + keyset + counter (NUT-13); the counters come from `counters` (the wallet's own, saved before each
//  request: ecash.js counterSource). Coins that are SENT to someone else use random secrets, so a restore never brings back a
//  token that was already handed over. restore() finds the coins again at the mint (NUT-09) after a lost device.
//
//  On-chain funding (NUT-30, experimental in the Cashu client): the mint gives a bitcoin address for a quote that is locked to a key
//  (NUT-20). The key is made from the recovery seed and the quote's number, so the 12 words are enough to claim a deposit later. Only
//  mints that list the "onchain" method in NUT-04 can do this (`onchainSupported`).
//
//  Unit: always "sat". Amounts leave this file as plain numbers.
//  Proofs leave it as plain JSON objects (so they can be saved and sealed).
//  Fees: split() includes the mint's input fee in what it sends, so the
//  person who receives a tick gets the full amount.
// ════════════════════════════════════════════════════════════

import { Wallet, getEncodedToken, getTokenMetadata, getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { EcashWallet, EcashError, makeStore } from "./ecash.js";
import { makeSeedBox } from "./seedbox.js";
import { makeRecovery } from "./ecashRecovery.js";
import { checkPhrase } from "../lib/recovery.js";

const plain = (proofs) => JSON.parse(JSON.stringify(proofs));

// The key an on-chain quote is locked to: its own HKDF label + the quote's number, from the recovery seed (never from anything else).
const onchainKey = (seed, index) => hkdf(sha256, seed, undefined, new TextEncoder().encode("nostrride/ecash/onchain-quote/v1/" + index), 32);

// An address that is a WEBSITE and not a mint (a typo, a wallet's home page) answers with a web page. The Cashu client puts that page into
// the error message, which would fill the screen with HTML. A short, plain reason takes its place; status, code and `definitive` are kept.
function plainError(e, url) {
  const text = String(e?.message ?? "");
  if (!/<\s*(!doctype|html|head|body)\b/i.test(text) && text.length <= 300) return e;
  let host = url;
  try { host = new URL(url).host; } catch { /* keep the address as typed */ }
  const err = new Error(`${host} is not a Cashu mint: it answered with a web page. Check the mint address.`);
  return Object.assign(err, { status: e?.status, code: e?.code, definitive: e?.definitive });
}

export function cashuMint(url, { seed = null, counters = null } = {}) {
  let wallet = null;
  let loading = null;
  const w = async () => {
    if (wallet) return wallet;
    loading = loading || (async () => {
      const next = new Wallet(url, { unit: "sat", ...(seed ? { bip39seed: seed, secretsPolicy: "deterministic", ...(counters ? { counterSource: counters } : {}) } : {}) });
      await next.loadMint();
      wallet = next;
      return next;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  };
  // Another device with the same phrase may have used the numbers we are about to use: the mint then says "Blinded message is
  // already signed" (code 10002). Look where the mint's records end, move our counters past them (the coins found are NOT taken:
  // they belong to the other device until the person runs Restore), and try once more.
  const skipAhead = async () => {
    const wl = await w();
    const now = (await counters.snapshot?.()) || {};
    for (const ks of wl.keyChain.getKeysets()) {
      try {
        const r = await wl.batchRestore(100, 100, now[ks.id] || 0, ks.id);
        if (r.lastCounterWithSignature != null) await counters.advanceToAtLeast(ks.id, r.lastCounterWithSignature + 1);
      } catch { /* this keyset cannot be read: leave its counter */ }
    }
  };
  const again = async (fn) => {
    try { return await fn(); }
    catch (e) {
      if (!(seed && counters && e?.code === 10002)) throw e;
      await skipAhead();
      return fn();
    }
  };
  const adapter = {
    url,
    // Is this address a working mint? Resolves { name } or throws a short, plain error.
    async info() {
      const wl = await w();
      let name = "";
      try { name = String(wl.getMintInfo()?.name || ""); } catch { /* the name is only for show */ }
      return { name };
    },
    async quoteMint(sats) {
      const q = await (await w()).createMintQuoteBolt11(sats);
      return { id: q.quote, invoice: q.request, expiry: q.expiry ?? null };
    },
    async quoteState(id) {
      return (await (await w()).checkMintQuoteBolt11(id)).state;
    },
    async mint(sats, id) {
      return plain(await again(async () => (await w()).mintProofsBolt11(sats, id)));
    },
    // ── On-chain funding (NUT-30) ──
    async onchainSupported() {
      const wl = await w();
      try { return wl.getMintInfo().supportsMintMeltMethod("mint", "onchain", "sat") === true; } catch { return false; }
    },
    // The public key quote number `index` is locked to (no network). Only this recovery phrase can sign for it.
    onchainPubkey(index) {
      return seed ? bytesToHex(getPubKeyFromPrivKey(onchainKey(seed, index))) : null;
    },
    // A deposit address for quote number `index`. Resolves { id, address, expiry, pubkey }.
    async quoteOnchain(index) {
      if (!seed) throw new Error("There is no recovery phrase to lock the deposit to.");
      const pubkey = adapter.onchainPubkey(index);
      const q = await (await w()).createMintQuoteOnchain(pubkey);
      return { id: q.quote, address: q.request, expiry: q.expiry ?? null, pubkey };
    },
    // What the mint has seen paid to the address, and how much ecash it has already issued for it. { paid, issued, expiry } in sats.
    async onchainState(id) {
      const q = await (await w()).checkMintQuoteOnchain(id);
      return { paid: q.amount_paid.toNumber(), issued: q.amount_issued.toNumber(), expiry: q.expiry ?? null };
    },
    // Turn `sats` of a paid deposit into ecash. `random`: the coins get random secrets (the restore path swaps them into a wallet at once).
    async mintOnchain(id, index, sats, { random = false } = {}) {
      if (!seed) throw new Error("There is no recovery phrase to sign with.");
      const wl = await w();
      const q = await wl.checkMintQuoteOnchain(id);
      const key = bytesToHex(onchainKey(seed, index));
      return plain(await again(async () => wl.mintProofsOnchain(sats, q, key, undefined, random ? { type: "random" } : undefined)));
    },
    async split(proofs, sats) {
      // With a recovery phrase: what we keep is deterministic (restorable); what we send away is random, and a swap is always
      // made (so a coin we already hold is never handed over as it is).
      const out = seed ? { send: { type: "random" }, keep: { type: "deterministic", counter: 0 } } : undefined;
      const r = await again(async () => (await w()).send(sats, proofs, { includeFees: true }, out));
      return { keep: plain(r.keep), send: plain(r.send) };
    },
    async receive(token) {
      try {
        return plain(await again(async () => (await w()).receive(token)));
      } catch (e) {
        // The mint answered "no" (a 4xx): spent, unknown or malformed. Trying again will not help.
        const status = e?.status ?? e?.response?.status;
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) e.definitive = true;
        throw e;
      }
    },
    async quoteMelt(invoice) {
      const q = await (await w()).createMeltQuoteBolt11(invoice);
      return { id: q.quote, sats: q.amount.toNumber(), fee: q.fee_reserve.toNumber(), raw: q };
    },
    async melt(quote, proofs) {
      const r = await again(async () => (await w()).meltProofsBolt11(quote.raw, proofs));
      return { paid: r.quote.state === "PAID", change: plain(r.change || []), preimage: r.quote.payment_preimage || null };
    },
    async states(proofs) {
      return (await (await w()).checkProofsStates(proofs)).map((s) => s.state);
    },
    // Find the coins the mint signed for this phrase (NUT-09) and keep those it still calls unspent. Every keyset of the mint is
    // scanned, active or not. `next[keysetId]` = the first counter that was never used.
    async restore({ gapLimit = 100, batchSize = 100 } = {}) {
      if (!seed) throw new Error("There is no recovery phrase to restore from.");
      const wl = await w();
      let supported = true;
      try { supported = wl.getMintInfo().isSupported(9).supported !== false; } catch { /* unknown: try */ }
      if (!supported) throw new Error("This mint cannot restore ecash.");
      const found = [], next = {};
      for (const ks of wl.keyChain.getKeysets()) {
        const r = await wl.batchRestore(gapLimit, batchSize, 0, ks.id);
        found.push(...r.proofs);
        if (r.lastCounterWithSignature != null) next[ks.id] = r.lastCounterWithSignature + 1;
      }
      if (!found.length) return { proofs: [], next };
      const states = await wl.checkProofsStates(found);
      return { proofs: plain(found.filter((_, i) => states[i]?.state === "UNSPENT")), next };
    },
    encode(proofs) {
      return getEncodedToken({ mint: url, proofs, unit: "sat" });
    },
  };
  // Every call that talks to the mint reports a short, plain error (see plainError).
  for (const [name, fn] of Object.entries(adapter)) {
    if (typeof fn === "function" && name !== "encode" && name !== "onchainPubkey") adapter[name] = async (...args) => { try { return await fn(...args); } catch (e) { throw plainError(e, url); } };
  }
  return adapter;
}

// A token's mint and amount, with no network: { mint, sats } (null if it is not a sat token).
export function tokenInfo(token) {
  try {
    const m = getTokenMetadata(String(token).trim());
    return m.unit === "sat" ? { mint: m.mint, sats: m.amount.toNumber() } : null;
  } catch { return null; }
}

// The wallet of the logged-in user, with real mints. One per user key.
const wallets = new WeakMap();
// After the wallet was disconnected from this device (or a restore found nothing): the next userWallet(user) starts again.
export function forgetWallet(user) { wallets.delete(user.sk); }
export function userWallet(user) {
  let ec = wallets.get(user.sk);
  if (!ec) {
    const recovery = makeRecovery({ box: makeSeedBox(user), newAdapter: cashuMint });
    ec = new EcashWallet({ store: makeStore(user), mintFor: recovery.mintFor, tokenInfo });
    recovery.attach(ec);
    wallets.set(user.sk, ec);
  }
  return ec;
}

// Restore: the typed 12 words BECOME this device's wallet phrase (nothing is swept into another phrase). Allowed only on a device with no
// wallet. The words are saved first, the mints are asked for the coins that were signed for them (NUT-09), and every coin found is swapped
// for a fresh one under the same phrase (so a copy on a lost phone is spent). The words are marked as written down: the person has them.
// If no mint knows any coin for these words (a typo that still passes the check, the wrong mint, mints that did not answer), everything is
// undone, so the device stays without a wallet and the person can try again. Returns { rows, kept }.
export async function restoreWallet(user, text, urls) {
  const c = checkPhrase(text);
  if (c.error) throw new EcashError("phrase", c.error, true);
  const list = [...new Set((urls || []).filter(Boolean))];
  if (!list.length) throw new EcashError("mint", "Add the address of at least one mint to look in.", true);
  const box = makeSeedBox(user);
  if (box.load() || wallets.has(user.sk)) throw new EcashError("wallet", "This device already has an ecash wallet. Disconnect it first to restore another one.", true);
  box.save({ v: 1, phrase: c.phrase, backedUp: true, at: Date.now() });
  const undo = () => {
    try { wallets.get(user.sk)?.wipe(); } catch { /* nothing to wipe */ }
    box.erase();
    forgetWallet(user);
  };
  let rows;
  try {
    rows = await userWallet(user).restore(list);
  } catch (e) {
    undo();
    throw e;
  }
  if (!rows.some((r) => r.found > 0)) { undo(); return { rows, kept: false }; }
  return { rows, kept: true };
}
