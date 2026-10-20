// The ecash wallet's bookkeeping, against a fake mint (no network): funding, paying a token,
// redeeming it, crash recovery, cash out, and the encrypted save.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { EcashWallet, EcashError, makeStore, proofsTotal } = await import(`${R}/nostr/ecash.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);

const { FakeMint, MINT, newNet, tokenInfo, memStore, build } = await import("./helpers/fakemint.mjs");

const net = newNet();
const rider = build(net), driver = build(net);

// ── Funding: an invoice, paid elsewhere, then claimed (once) ──
const q = await rider.fundStart(MINT, 5000);
assert.match(q.invoice, /^lnbc5000n/);
assert.deepEqual(await rider.claim(q.id), { state: "UNPAID", sats: 0 }, "not paid yet: nothing is minted");
assert.equal(rider.balance(MINT), 0);
net[MINT].quotes[q.id].state = "PAID"; // the rider pays the invoice (any Lightning wallet)
assert.deepEqual(await rider.claim(q.id), { state: "ISSUED", sats: 5000 });
assert.equal(rider.balance(MINT), 5000);
assert.deepEqual(await rider.claim(q.id), { state: "ISSUED", sats: 0 }, "claiming twice adds nothing");
assert.equal(rider.balance(MINT), 5000);
await assert.rejects(() => rider.fundStart(MINT, 0), (e) => e instanceof EcashError && e.code === "amount");

// A paid invoice is remembered over a restart, and claimAll() collects it.
const q2 = await rider.fundStart(MINT, 700);
net[MINT].quotes[q2.id].state = "PAID";
const store = memStore();
const reloaded = build(net, store);
assert.equal(reloaded.balance(MINT), 0);
const early = build(net); // a wallet that never saw q2 has nothing to claim
assert.equal(await early.claimAll(), 0);
assert.equal(await rider.claimAll(), 700, "claimAll collects what was paid while the app was closed");
assert.equal(rider.balance(MINT), 5700);

// ── Paying a tick: a token for exactly the amount; the fee comes on top ──
const pay1 = await rider.pay(MINT, 1000);
assert.equal(pay1.sats, 1000);
assert.equal(rider.balance(MINT), 5700 - 1001, "1,000 sats sent + 1 sat of mint fee");
assert.equal(rider.pendingList().length, 1, "the token waits in pending until its event is published");
rider.settle(pay1.id);
assert.equal(rider.pendingList().length, 0);
await assert.rejects(() => rider.pay(MINT, 99999), (e) => e instanceof EcashError && e.code === "funds");
await assert.rejects(() => rider.pay("https://other.mint", 10), (e) => e.code === "funds", "no ecash at that mint");
await assert.rejects(() => rider.pay(MINT, 0), (e) => e.code === "amount");

// ── The driver redeems it: money in, once ──
const got = await driver.redeem(pay1.token, { only: [MINT] });
assert.equal(got.mint, MINT);
assert.equal(driver.balance(MINT), got.sats);
assert.ok(got.sats >= 1000 - 1, "the driver gets the tick (less at most the mint's fee)");
await assert.rejects(() => driver.redeem(pay1.token), (e) => e.code === "used", "the same token is not counted twice");
await assert.rejects(() => driver.redeem(pay1.token + "x"), (e) => e instanceof EcashError, "a damaged token fails");
await assert.rejects(() => driver.redeem("not a token"), (e) => e.code === "token");
// A token is remembered with what it paid for: the SAME payment seen again is recognised, the same token in ANOTHER payment is a replay.
const tagged = await rider.pay(MINT, 40);
const first = await driver.redeem(tagged.token, { ref: "tick-1" });
await assert.rejects(() => driver.redeem(tagged.token, { ref: "tick-1" }), (e) => e.code === "used" && e.ref === "tick-1" && e.sats === first.sats, "the same payment again: recognised, with what it paid");
await assert.rejects(() => driver.redeem(tagged.token, { ref: "tick-2" }), (e) => e.code === "used" && e.ref === "tick-1", "another payment with the same token: a replay");
const walletNow = driver.balance(MINT);
assert.equal(driver.balance(MINT), walletNow, "nothing was added twice");
rider.settle(tagged.id);
const stranger = await rider.pay(MINT, 50);
await assert.rejects(() => driver.redeem(stranger.token, { only: ["https://elsewhere"] }), (e) => e.code === "mint", "only the driver's mint is accepted");
assert.equal(driver.balance(MINT), walletNow, "a refused token adds nothing");
rider.unreserve(stranger.id);
assert.equal(rider.balance(MINT), 5700 - 1001 - 41, "an unsent token goes back into the wallet");

// ── A crash between paying and publishing ──
const lost = await rider.pay(MINT, 300);
const before = rider.balance(MINT);
const crashed = build(net, rider.store); // a restart: the token is still pending
assert.equal(crashed.pendingList().length, 1);
await crashed.recoverPending(0);
assert.equal(crashed.balance(MINT), before + lost.sats + 1, "never delivered: the mint says it is unspent, so it comes back");
const delivered = await crashed.pay(MINT, 200);
await driver.redeem(delivered.token); // delivered and redeemed
const crashed2 = build(net, crashed.store);
await crashed2.recoverPending(0);
assert.equal(crashed2.pendingList().length, 0, "a delivered token is dropped, not paid back");
assert.equal(crashed2.balance(MINT), crashed.balance(MINT), "and the money is not counted twice");
assert.equal(await (async () => { await crashed2.recoverPending(); return crashed2.pendingList().length; })(), 0);

// ── Two taps at once cannot spend the same proofs ──
const racer = build(net);
const f = await racer.fundStart(MINT, 100);
net[MINT].quotes[f.id].state = "PAID";
await racer.claim(f.id);
const results = await Promise.allSettled([racer.pay(MINT, 60), racer.pay(MINT, 60)]);
assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "100 sats cannot pay 60 twice");
assert.equal(results.filter((r) => r.status === "rejected")[0].reason.code, "funds");

// ── Cash out to a Lightning invoice ──
const ask = [];
const out = await driver.cashOut(MINT, async (sats) => { ask.push(sats); return "lnbc" + sats + "n1driver"; });
assert.equal(out.paidSats, ask[ask.length - 1], "the invoice was for the amount paid");
assert.ok(driver.balance(MINT) < 10, "almost everything went out; only fee dust is left: " + driver.balance(MINT));
assert.deepEqual(net[MINT].paidInvoices, [out.paidSats]);
const poor = build(net);
const pf = await poor.fundStart(MINT, 3); net[MINT].quotes[pf.id].state = "PAID"; await poor.claim(pf.id);
await assert.rejects(() => poor.cashOut(MINT, async (s) => "lnbc" + s + "n1x"), (e) => e instanceof EcashError, "too small to cover the mint's fee");
// A failed Lightning payment keeps the ecash.
const keep = build(net);
const kf = await keep.fundStart(MINT, 1000); net[MINT].quotes[kf.id].state = "PAID"; await keep.claim(kf.id);
net[MINT].failMelt = true;
await assert.rejects(() => keep.cashOut(MINT, async (s) => "lnbc" + s + "n1x"), (e) => /still here/.test(e.message));
assert.equal(keep.balance(MINT), 1000, "a failed payment loses nothing");
net[MINT].failMelt = false;

// ── Sending to another wallet: pay a Lightning invoice from the balance ──
const sender = build(net);
const sf = await sender.fundStart(MINT, 2000); net[MINT].quotes[sf.id].state = "PAID"; await sender.claim(sf.id);
const paidBefore = net[MINT].paidInvoices.length;
const sent = await sender.payInvoice(MINT, "lnbc500n1someoneelse");
assert.equal(sent.paidSats, 500, "the invoice was paid for exactly its amount");
assert.equal(net[MINT].paidInvoices.length, paidBefore + 1);
assert.ok(sender.balance(MINT) >= 2000 - 500 - 2 - 3 && sender.balance(MINT) < 1500, "the amount and the fee left the balance; the change came back: " + sender.balance(MINT));
assert.equal(sender.pendingList().length, 0, "nothing is left waiting");
await assert.rejects(() => sender.payInvoice(MINT, "lnbc99999n1toobig"), (e) => e instanceof EcashError && e.code === "funds", "more than the balance is refused before anything is spent");
const unlucky = build(net); // (the fake mint spends the coins of a failed payment, so this wallet is not used again)
const uf = await unlucky.fundStart(MINT, 1000); net[MINT].quotes[uf.id].state = "PAID"; await unlucky.claim(uf.id);
net[MINT].failMelt = true;
await assert.rejects(() => unlucky.payInvoice(MINT, "lnbc100n1fails"), (e) => /still here/.test(e.message));
assert.equal(unlucky.balance(MINT), 1000, "a failed Lightning payment loses nothing");
assert.equal(unlucky.pendingList().length, 0);
net[MINT].failMelt = false;

// ── A Lightning payment whose outcome is NOT clear: the app asks the mint before it decides ──
const fund = async (sats) => { const w = build(net); const f = await w.fundStart(MINT, sats); net[MINT].quotes[f.id].state = "PAID"; await w.claim(f.id); return w; };
{
  // The mint is still sending it (PENDING): the coins are held, the balance does not count them, nothing is called "failed".
  const w = await fund(1000);
  net[MINT].meltMode = "pending";
  await assert.rejects(() => w.payInvoice(MINT, "lnbc200n1slow"), (e) => e instanceof EcashError && e.code === "pending" && !/failed/i.test(e.message));
  assert.equal(w.pendingList().length, 1, "the coins wait in pending");
  assert.ok(w.balance(MINT) < 800, "and are not in the balance: " + w.balance(MINT));
  await w.recoverPending(0);
  assert.equal(w.pendingList().length, 1, "still pending at the mint: nothing moves");
  // The payment goes through.
  for (const p of w.pendingList()[0].proofs) { net[MINT].pending.delete(p.secret); net[MINT].spent.add(p.secret); }
  await w.recoverPending(0);
  assert.equal(w.pendingList().length, 0, "it went out: the coins are forgotten");
  assert.ok(w.balance(MINT) < 800);
  // A second one fails at the end: the coins come back.
  const v = await fund(1000);
  await assert.rejects(() => v.payInvoice(MINT, "lnbc200n1slow"), (e) => e.code === "pending");
  for (const p of v.pendingList()[0].proofs) net[MINT].pending.delete(p.secret);
  await v.recoverPending(0);
  assert.equal(v.pendingList().length, 0);
  assert.equal(v.balance(MINT), 1000, "the mint released the coins: they are back");
  net[MINT].meltMode = null;
}
{
  // The payment went out but the answer was lost: the mint says the coins are spent, so it is paid. No second try is invited.
  const w = await fund(1000);
  net[MINT].meltMode = "lost";
  const paidBefore = net[MINT].paidInvoices.length;
  const r = await w.payInvoice(MINT, "lnbc300n1lost");
  assert.equal(r.paidSats, 300);
  assert.equal(net[MINT].paidInvoices.length, paidBefore + 1);
  assert.equal(w.pendingList().length, 0);
  assert.ok(w.balance(MINT) <= 1000 - 300 - 2, "the coins are gone: " + w.balance(MINT));
  // The request never reached the mint: the coins are unspent and come back, with a plain message.
  const v = await fund(1000);
  net[MINT].meltMode = "dropped";
  await assert.rejects(() => v.payInvoice(MINT, "lnbc300n1dropped"), (e) => /still here/.test(e.message));
  assert.equal(v.balance(MINT), 1000);
  assert.equal(v.pendingList().length, 0);
  // The mint cannot be asked afterwards: nothing is guessed, the coins stay pending.
  const u = await fund(1000);
  net[MINT].meltMode = "lost";
  net[MINT].statesDown = true;
  await assert.rejects(() => u.payInvoice(MINT, "lnbc300n1unknown"), (e) => e.code === "pending");
  assert.equal(u.pendingList().length, 1);
  net[MINT].statesDown = false;
  await u.recoverPending(0);
  assert.equal(u.pendingList().length, 0, "a minute later the mint says spent: forgotten");
  net[MINT].meltMode = null;
}

// ── A browser that will not keep the wallet: no money moves ──
{
  let full = false, saves = 0;
  let saved = null;
  const store = { load: () => saved && JSON.parse(saved), save: (s) => { saves++; if (full) return false; saved = JSON.stringify(s); return true; }, erase: () => { saved = null; } };
  const w = build(net, store);
  const f = await w.fundStart(MINT, 500); net[MINT].quotes[f.id].state = "PAID"; await w.claim(f.id);
  const bal = w.balance(MINT);
  full = true;
  await assert.rejects(() => w.pay(MINT, 100), (e) => e.code === "storage" && e.definitive === false);
  await assert.rejects(() => w.fundStart(MINT, 100), (e) => e.code === "storage");
  await assert.rejects(() => w.redeem("cashuBfakeAAAA"), (e) => e.code === "storage");
  assert.equal(w.balance(MINT), bal, "nothing was moved");
  assert.equal(w.saveOk, false, "the wallet knows it is not saved");
  assert.equal(w.retrySave(), false);
  full = false;
  assert.equal(w.retrySave(), true);
  const ok = await w.pay(MINT, 100);
  assert.equal(ok.sats, 100, "money moves again once the browser keeps the wallet");
  assert.equal(w.saveOk, true);
}
await assert.rejects(() => build(net).payInvoice(MINT, "lnbc10n1empty"), (e) => e.code === "funds", "an empty wallet cannot pay");

// ── Sending to another wallet: a token to hand over, and taking it back ──
const hand = await sender.pay(MINT, 300);
const afterPay = sender.balance(MINT);
assert.equal(await sender.reclaim(hand.id), "back", "nobody took the token: the coins return");
assert.equal(sender.balance(MINT), afterPay + hand.sats + 1, "the amount and the mint's fee are back");
assert.equal(sender.pendingList().length, 0);
const gift = await sender.pay(MINT, 300);
const friend = build(net);
await friend.redeem(gift.token);
assert.equal(await sender.reclaim(gift.id), "taken", "the friend took it: it is forgotten, never returned");
assert.equal(sender.pendingList().length, 0);
assert.equal(await sender.reclaim("no-such-token"), "taken");

// ── Saved encrypted, in pieces, per user ──
const alice = generateKeypair(), mallory = generateKeypair();
const user = { sk: alice.sk, publicKey: alice.publicKey };
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
const real = makeStore(user);
const big = { v: 1, mints: { [MINT]: { proofs: Array.from({ length: 900 }, (_, i) => ({ id: "00fake", amount: 1, secret: "secret-number-" + i + "-" + "x".repeat(40), C: "02" + "ab".repeat(32) })) } }, pending: [], quotes: [], redeemed: [] };
real.save(big);
const stored = Object.values(mem).join("");
assert.ok(!stored.includes("secret-number"), "nothing readable is saved");
assert.ok(JSON.parse(Object.values(mem)[0]).length > 1, "a large wallet is saved in several pieces (NIP-44 holds 64 KB)");
assert.equal(proofsTotal(real.load().mints[MINT].proofs), 900, "and loads back whole");
assert.equal(makeStore({ sk: mallory.sk, publicKey: alice.publicKey }).load(), null, "another key cannot open it");
real.erase();
assert.equal(real.load(), null);
console.log("ecash tests ok");
