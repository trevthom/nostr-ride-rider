// ════════════════════════════════════════════════════════════
//  CASHU MINT — The real "mint adapter" for nostr/ecash.js, built on the
//  @cashu/cashu-ts client. It is the only file that imports that library;
//  the apps load it on demand (loadEcash), so the code is fetched only when
//  a person uses ecash.
//
//  Unit: always "sat". Amounts leave this file as plain numbers.
//  Proofs leave it as plain JSON objects (so they can be saved and sealed).
//  Fees: split() includes the mint's input fee in what it sends, so the
//  person who receives a tick gets the full amount.
// ════════════════════════════════════════════════════════════

import { Wallet, getEncodedToken, getTokenMetadata } from "@cashu/cashu-ts";
import { EcashWallet, makeStore } from "./ecash.js";

const plain = (proofs) => JSON.parse(JSON.stringify(proofs));

export function cashuMint(url) {
  let wallet = null;
  let loading = null;
  const w = async () => {
    if (wallet) return wallet;
    loading = loading || (async () => {
      const next = new Wallet(url, { unit: "sat" });
      await next.loadMint();
      wallet = next;
      return next;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  };
  return {
    url,
    async quoteMint(sats) {
      const q = await (await w()).createMintQuoteBolt11(sats);
      return { id: q.quote, invoice: q.request, expiry: q.expiry ?? null };
    },
    async quoteState(id) {
      return (await (await w()).checkMintQuoteBolt11(id)).state;
    },
    async mint(sats, id) {
      return plain(await (await w()).mintProofsBolt11(sats, id));
    },
    async split(proofs, sats) {
      const r = await (await w()).send(sats, proofs, { includeFees: true });
      return { keep: plain(r.keep), send: plain(r.send) };
    },
    async receive(token) {
      try {
        return plain(await (await w()).receive(token));
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
      const r = await (await w()).meltProofsBolt11(quote.raw, proofs);
      return { paid: r.quote.state === "PAID", change: plain(r.change || []) };
    },
    async states(proofs) {
      return (await (await w()).checkProofsStates(proofs)).map((s) => s.state);
    },
    encode(proofs) {
      return getEncodedToken({ mint: url, proofs, unit: "sat" });
    },
  };
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
export function userWallet(user) {
  let ec = wallets.get(user.sk);
  if (!ec) {
    const mints = new Map();
    const mintFor = (url) => { if (!mints.has(url)) mints.set(url, cashuMint(url)); return mints.get(url); };
    ec = new EcashWallet({ store: makeStore(user), mintFor, tokenInfo });
    wallets.set(user.sk, ec);
  }
  return ec;
}
