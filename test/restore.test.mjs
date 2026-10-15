// Getting the ecash back on a new device from the recovery phrase, with the REAL Cashu client and a local mint that does the real
// maths and remembers what it signed (NUT-09):
//   • every coin the wallet makes is under the phrase; after "the phone was lost", the phrase on a new device brings the balance back
//   • a token already SENT to someone is not brought back (it uses random secrets), and the driver can still redeem it
//   • after a restore every coin is swapped for a fresh one, so a copy on the lost phone is worth nothing
//   • a crash between "the mint signed" and "the wallet saved" loses nothing
//   • counters are saved BEFORE the mint is asked; a counter is never used twice
//   • a wallet that already holds ecash takes in another phrase's coins and keeps its own phrase
//   • old coins (random secrets) are moved under the phrase once it is written down
//   • the phrase and the seed never travel to the mint
// Run with: npm test
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
// Everything the app sends to a mint, so we can check that no secret leaves the device.
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => { sent.push(String(url) + " " + (init?.body ? String(init.body) : "")); return realFetch(url, init); };

const R = new URL("../src", import.meta.url).pathname;
const { cashuMint, tokenInfo } = await import(`${R}/nostr/cashuMint.js`);
const { EcashWallet, EcashError } = await import(`${R}/nostr/ecash.js`);
const { makeRecovery } = await import(`${R}/nostr/ecashRecovery.js`);
const { seedOf } = await import(`${R}/lib/recovery.js`);
const { startLocalMint } = await import("./helpers/localmint.mjs");
const { memStore } = await import("./helpers/fakemint.mjs");

const memBox = (rec = null) => { let saved = rec; return { load: () => saved && { ...saved }, save: (r) => { saved = { ...r }; }, erase: () => { saved = null; } }; };
// One "device": a store, a phrase box, a recovery controller and a wallet. `phrase` = a device that already has that phrase.
function device({ phrase = null, store = memStore(), adapter = cashuMint } = {}) {
  const box = memBox(phrase ? { v: 1, phrase, backedUp: true, at: 1 } : null);
  const recovery = makeRecovery({ box, newAdapter: adapter });
  const wallet = new EcashWallet({ store, mintFor: recovery.mintFor, tokenInfo });
  recovery.attach(wallet);
  return { wallet, recovery, store, box };
}
const fund = async (d, url, sats) => { const q = await d.wallet.fundStart(url, sats); mint.payQuote(q.id); return d.wallet.claim(q.id); };

const note = (t) => console.log("  " + t);
const mint = await startLocalMint({ feePpk: 0 });
const feeMint = await startLocalMint({ feePpk: 100 });
try {
  // ── A phone: a phrase is made before any coin exists; the wallet is filled and pays a tick ──
  note("A phone: a phrase is made before any coin exists; the wallet is filled");
  const A = device();
  const phrase = A.recovery.phrase();
  assert.equal(phrase.split(" ").length, 12);
  assert.equal(A.recovery.backedUp(), false, "not written down yet");
  await fund(A, mint.url, 5000);
  const tick = await A.wallet.pay(mint.url, 1234); // a token for a driver
  A.wallet.settle(tick.id); // its event was published: the token is in the driver's hands
  assert.equal(A.wallet.balance(mint.url), 5000 - 1234);
  assert.ok(Object.values(A.wallet.state.counters).every((n) => n > 0), "counters moved and are saved with the wallet: " + JSON.stringify(A.wallet.state.counters));

  // ── The phone is lost. A new device takes the phrase and finds the money ──
  note("The phone is lost. A new device takes the phrase and finds the money");
  const B = device(); // a brand-new device: its own new phrase, an empty wallet
  assert.notEqual(B.recovery.phrase(), phrase);
  const rows = await B.recovery.restore(phrase, [mint.url]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].error, "");
  assert.equal(rows[0].found, 5000 - 1234, "the mint gave back exactly what is unspent: the token already sent is NOT in it");
  assert.equal(rows[0].rotated, true);
  assert.equal(B.wallet.balance(mint.url), 5000 - 1234);
  assert.equal(B.recovery.phrase(), phrase, "an empty wallet takes the person's phrase as its own");
  assert.equal(B.recovery.backedUp(), true, "they typed it, so they have it");

  // The driver still gets the token that was sent before the phone was lost.
  const D = device();
  assert.equal((await D.wallet.redeem(tick.token)).sats, 1234, "the token in the driver's hands was not touched by the restore");

  // The lost phone is worthless: every coin on it was swapped for a fresh one during the restore.
  const stale = A.wallet.state.mints[mint.url].proofs;
  assert.ok(stale.length > 0);
  assert.ok((await cashuMint(mint.url).states(stale)).every((s) => s === "SPENT"), "a thief holding the old phone's coins finds them spent");
  await assert.rejects(() => A.wallet.pay(mint.url, 10), "the old phone cannot pay with them");
  // The new device keeps working: it can fund more and pay.
  await fund(B, mint.url, 600);
  assert.equal(B.wallet.balance(mint.url), 5000 - 1234 + 600);
  const t2 = await B.wallet.pay(mint.url, 300);
  B.wallet.settle(t2.id);
  assert.equal((await device().wallet.redeem(t2.token)).sats, 300);

  // ── A crash after the mint signed but before the wallet saved: nothing is lost ──
  note("A crash after the mint signed but before the wallet saved: nothing is ");
  const crashing = (url, o) => { const a = cashuMint(url, o); return { ...a, async mint(sats, id) { await a.mint(sats, id); throw new Error("the app died"); } }; };
  const C = device({ adapter: crashing });
  const q = await C.wallet.fundStart(mint.url, 700);
  mint.payQuote(q.id);
  const before = Object.values(C.wallet.state.counters).reduce((s, n) => s + n, 0);
  await assert.rejects(() => C.wallet.claim(q.id), /app died/);
  assert.equal(C.wallet.balance(mint.url), 0, "the wallet never saw the coins");
  assert.ok(Object.values(C.wallet.state.counters).reduce((s, n) => s + n, 0) > before, "but the counters were saved before the mint was asked");
  assert.ok(Object.values(C.store.load().counters).reduce((s, n) => s + n, 0) > before, "and are on disk");
  const C2 = device();
  await C2.recovery.restore(C.recovery.phrase(), [mint.url]);
  assert.equal(C2.wallet.balance(mint.url), 700, "the mint remembered what it signed, so restore finds it");

  // ── A counter is never used twice: a wallet reopened from its own store carries on ──
  note("A counter is never used twice");
  const lost2 = device({ phrase: C.recovery.phrase() }); // the SAME phrase on a second device whose counters are at zero
  const A2 = device({ phrase: C.recovery.phrase(), store: lost2.store });
  const q4 = await lost2.wallet.fundStart(mint.url, 40);
  mint.payQuote(q4.id);
  // The numbers it would use were signed before (the crash test above and the restore). The mint refuses them; the wallet looks
  // where the mint's records end, moves its counters past them, and goes on. It does NOT take the other device's coins.
  assert.equal((await lost2.wallet.claim(q4.id)).sats, 40, "it recovers by itself");
  assert.equal(lost2.wallet.balance(mint.url), 40, "and holds only its own coin");
  assert.ok(Object.values(lost2.wallet.state.counters)[0] > 5, "the counters moved past the numbers that were used elsewhere");
  const q5 = await A2.wallet.fundStart(mint.url, 50);
  mint.payQuote(q5.id);
  assert.equal((await A2.wallet.claim(q5.id)).sats, 50, "a wallet reopened from its saved store carries on from its saved counters");
  await lost2.recovery.restore(C.recovery.phrase(), [mint.url]); // an explicit Restore merges the other coins (and swaps them)
  assert.equal(lost2.wallet.balance(mint.url), 40 + 700 + 50, "after Restore it holds everything the phrase owns: " + lost2.wallet.balance(mint.url));

  // ── A wallet that already holds ecash takes in another phrase's coins and keeps its own phrase ──
  note("A wallet that already holds ecash takes in another phrase's coins and ");
  const E = device();
  await fund(E, mint.url, 1000);
  const ownPhrase = E.recovery.phrase();
  const now = B.wallet.balance(mint.url); // B holds what was restored (under `phrase`)
  const rows2 = await E.recovery.restore(phrase, [mint.url]);
  assert.equal(rows2[0].error, "");
  assert.equal(rows2[0].added, now, "the other phrase's coins were swapped into this wallet");
  assert.equal(E.wallet.balance(mint.url), 1000 + now);
  assert.equal(E.recovery.phrase(), ownPhrase, "its own phrase is unchanged");
  assert.equal(B.wallet.balance(mint.url), now, "B's bookkeeping is stale, but the mint says its coins are spent:");
  await assert.rejects(() => B.wallet.pay(mint.url, 10));

  // ── "I lost my phone" from another device: swap every coin ──
  note("\"I lost my phone\" from another device: swap every coin");
  const F = device();
  await fund(F, mint.url, 800);
  const copy = F.wallet.state.mints[mint.url].proofs.map((x) => ({ ...x }));
  const swapped = await F.recovery.rotateAll();
  assert.equal(swapped[0].error, "");
  assert.equal(F.wallet.balance(mint.url), 800);
  assert.ok((await cashuMint(mint.url).states(copy)).every((s) => s === "SPENT"), "the copy is spent");

  // ── Old coins (random secrets) are moved under the phrase once it is written down ──
  note("Old coins (random secrets) are moved under the phrase once it is writt");
  const oldStore = memStore();
  const oldWallet = new EcashWallet({ store: oldStore, mintFor: (u) => cashuMint(u), tokenInfo }); // the wallet as it was before recovery existed
  { const qq = await oldWallet.fundStart(mint.url, 3000); mint.payQuote(qq.id); await oldWallet.claim(qq.id); }
  const G = device({ store: oldStore }); // the same device after the update: no phrase yet
  assert.deepEqual(G.wallet.state.legacy, [mint.url], "the mint with old coins is listed");
  assert.equal(G.recovery.backedUp(), false);
  await G.recovery.confirmBackup();
  assert.deepEqual(G.wallet.state.legacy, [], "the old coins were swapped for coins under the phrase");
  assert.equal(G.wallet.balance(mint.url), 3000);
  const G2 = device();
  await G2.recovery.restore(G.recovery.phrase(), [mint.url]);
  assert.equal(G2.wallet.balance(mint.url), 3000, "and now they come back from the phrase alone");

  // ── With a fee at the mint, a restore costs the fee of swapping and nothing else ──
  note("With a fee at the mint, a restore costs the fee of swapping and nothin");
  const H = device();
  { const qq = await H.wallet.fundStart(feeMint.url, 4000); feeMint.payQuote(qq.id); await H.wallet.claim(qq.id); }
  const H2 = device();
  const hr = await H2.recovery.restore(H.recovery.phrase(), [feeMint.url]);
  assert.equal(hr[0].found, 4000);
  assert.ok(H2.wallet.balance(feeMint.url) >= 4000 - 20 && H2.wallet.balance(feeMint.url) <= 4000, "only the swap fee was paid: " + H2.wallet.balance(feeMint.url));

  // ── Mistakes are reported, not guessed around ──
  note("Mistakes are reported, not guessed around");
  await assert.rejects(() => device().recovery.restore("hello world", [mint.url]), (e) => e instanceof EcashError && e.code === "phrase");
  await assert.rejects(() => device().recovery.restore(phrase, []), (e) => e.code === "mint");
  const down = await device().recovery.restore(phrase, ["http://127.0.0.1:1"]);
  assert.ok(down[0].error, "a mint that does not answer is reported for that mint");
  const fresh = device();
  const slip = device().recovery.phrase(); // a valid phrase that never held anything (a slip that passes the checksum, or someone else's words)
  const empty = await fresh.recovery.restore(slip, [mint.url]);
  assert.equal(empty[0].found, 0, "a phrase that never held anything finds nothing, and that is not an error");
  assert.notEqual(fresh.recovery.phrase(), slip, "and the wallet keeps its OWN phrase");
  assert.equal(fresh.recovery.backedUp(), false, "it is not marked as written down");

  // ── The counter source obeys the Cashu client's rules ──
  note("The counter source obeys the Cashu client's rules");
  const cs = device().wallet.counterSource();
  assert.deepEqual(await cs.reserve("ks", 0), { start: 0, count: 0 }, "reserving zero changes nothing");
  assert.deepEqual(await cs.reserve("ks", 3), { start: 0, count: 3 });
  assert.deepEqual(await cs.reserve("ks", 2), { start: 3, count: 2 });
  await assert.rejects(() => cs.reserveAt("ks", 2, 1), "a range below the cursor was already used");
  assert.deepEqual(await cs.reserveAt("ks", 10, 2), { start: 10, count: 2 });
  await cs.advanceToAtLeast("ks", 4);
  assert.deepEqual((await cs.snapshot()).ks, 12, "advanceToAtLeast never moves back");

  // ── The phrase and the seed never travel to the mint ──
  note("The phrase and the seed never travel to the mint");
  const seedHex = Buffer.from(seedOf(phrase)).toString("hex");
  const firstWords = phrase.split(" ").slice(0, 3).join(" ");
  assert.ok(sent.length > 50, "the check looked at real traffic: " + sent.length + " requests");
  assert.ok(!sent.some((m) => m.includes(phrase) || m.includes(firstWords) || m.includes(seedHex.slice(0, 32))), "no request to a mint holds the phrase or the seed");
  assert.ok(![...mem.values()].some((v) => v.includes(firstWords)), "and the phrase is not in the saved text either");
} finally {
  await mint.close();
  await feeMint.close();
}
console.log("restore: ok");
process.exit(0);
