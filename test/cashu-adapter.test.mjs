// The REAL Cashu client library (@cashu/cashu-ts) and our adapter (src/nostr/cashuMint.js), against a local mint
// that does the real blind-signature maths (test/helpers/localmint.mjs): fund, pay a token with the mint's fee
// included, redeem it in another wallet, refuse a spent token, check proofs, cash out by a Lightning invoice.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { cashuMint, tokenInfo } = await import(`${R}/nostr/cashuMint.js`);
const { EcashWallet } = await import(`${R}/nostr/ecash.js`);
const { startLocalMint, invoiceFor } = await import("./helpers/localmint.mjs");
const { memStore } = await import("./helpers/fakemint.mjs");

const mint = await startLocalMint({ feePpk: 100 }); // the mint takes 0.1 sat per input proof
const mintFor = (() => { const m = new Map(); return (url) => { if (!m.has(url)) m.set(url, cashuMint(url)); return m.get(url); }; })();
const wallet = () => new EcashWallet({ store: memStore(), mintFor, tokenInfo });
const rider = wallet(), driver = wallet();
try {
  // ── Funding: a mint quote, paid, then claimed ──
  const q = await rider.fundStart(mint.url, 5000);
  assert.match(q.invoice, /^lnbc50000n1/, "5,000 sats = 50,000 nBTC");
  assert.deepEqual(await rider.claim(q.id), { state: "UNPAID", sats: 0 });
  mint.payQuote(q.id);
  assert.deepEqual(await rider.claim(q.id), { state: "ISSUED", sats: 5000 });
  assert.equal(rider.balance(mint.url), 5000);
  assert.deepEqual(await rider.claim(q.id), { state: "ISSUED", sats: 0 }, "claimed once");

  // ── Paying a tick: the token carries exactly the amount; the mint's fee is added on the sender's side ──
  const pay = await rider.pay(mint.url, 1234);
  assert.ok(pay.token.startsWith("cashuB"), "a modern cashuB token");
  assert.deepEqual(tokenInfo(pay.token), { mint: mint.url, sats: tokenInfo(pay.token).sats }, "the token names its mint");
  assert.ok(tokenInfo(pay.token).sats >= 1234, "it holds at least the tick (plus the fee for redeeming it)");
  assert.ok(rider.balance(mint.url) <= 5000 - 1234 && rider.balance(mint.url) >= 5000 - 1234 - 3, "the wallet paid 1,234 sats and a sat or two of fees: " + rider.balance(mint.url));
  rider.settle(pay.id);

  // ── The driver redeems it: they receive the full tick, and only once ──
  const got = await driver.redeem(pay.token, { only: [mint.url] });
  assert.equal(got.sats, 1234, "the driver receives exactly the tick: the sender paid the redeeming fee");
  assert.equal(driver.balance(mint.url), 1234);
  await assert.rejects(() => driver.redeem(pay.token), (e) => e.code === "used");
  // A second wallet trying the same token meets the mint's own refusal, and it is a FINAL answer.
  const thief = wallet();
  await assert.rejects(() => thief.redeem(pay.token), (e) => e.code === "mint" && e.definitive === true, "the mint says the token is spent: definitive");
  assert.equal(thief.balance(mint.url), 0);

  // ── The mint takes a fee for spending ecash, so a wallet cannot send back every sat it holds ──
  await assert.rejects(() => driver.pay(mint.url, 1234), (e) => e.code === "funds", "the whole balance does not fit with the fee");
  const back = await driver.payUpTo(mint.url, 1234);
  assert.ok(back.sats < 1234 && back.sats >= 1225, "payUpTo sent the most the balance allows: " + back.sats);
  driver.unreserve(back.id);
  assert.equal(driver.balance(mint.url), 1234, "an unsent token goes back into the wallet");

  // ── The mint is unreachable: not definitive, so the driver tries again later ──
  const down = await startLocalMint();
  const downWallet = wallet();
  const dq = await downWallet.fundStart(down.url, 100);
  down.payQuote(dq.id);
  await downWallet.claim(dq.id);
  const tick = await downWallet.pay(down.url, 50);
  await down.close();
  await assert.rejects(() => wallet().redeem(tick.token), (e) => e.code === "mint" && !e.definitive, "a mint that does not answer is not a refusal");

  // ── Proof states ──
  const another = await rider.pay(mint.url, 100);
  const states = await mintFor(mint.url).states(rider.pendingList().find((p) => p.id === another.id).proofs);
  assert.ok(states.every((s) => s === "UNSPENT"), "an unsent token is unspent");
  rider.unreserve(another.id);

  // ── Cashing out: a Lightning invoice paid from ecash, change comes back ──
  const before = driver.balance(mint.url);
  await driver.fundStart(mint.url, 1).then((qq) => { mint.payQuote(qq.id); return driver.claim(qq.id); });
  await (async () => { const f = await driver.fundStart(mint.url, 2000); mint.payQuote(f.id); await driver.claim(f.id); })();
  const total = driver.balance(mint.url);
  assert.equal(total, before + 2001);
  const out = await driver.cashOut(mint.url, async (sats) => invoiceFor(sats, "driver"));
  assert.deepEqual(mint.stats.melted, [out.paidSats], "the mint paid exactly one invoice");
  assert.ok(out.paidSats > total - 40 && out.paidSats < total, `almost the whole balance went out: paid ${out.paidSats} of ${total}`);
  assert.ok(driver.balance(mint.url) < 40, "only a small change is left: " + driver.balance(mint.url));
  assert.equal(driver.total(), driver.balance(mint.url));
  assert.equal(driver.pendingList().length, 0, "nothing is stuck pending");
} finally {
  await mint.close();
}
console.log("cashu adapter tests ok");
process.exit(0);
