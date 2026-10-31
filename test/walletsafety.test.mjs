// Money that must never move by accident: a token whose text is on screen is not taken back by the wallet, a coin the mint
// calls spent is set aside and asked about again (never silently deleted), a deposit address that can still be paid is kept,
// and a mint's answer that the browser would not save is retried at once.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { EcashWallet, SUSPECT_SETTLE_MS } = await import(`${R}/nostr/ecash.js`);
const { FakeMint, MINT, newNet, tokenInfo, memStore, build, topUp } = await import("./helpers/fakemint.mjs");

// ── A token shown on screen is not recovered while it is shown ──
{
  const net = newNet();
  const w = build(net);
  await topUp(w, net, 1000);
  const shown = await w.pay(MINT, 200, { hold: true });
  assert.equal(w.pendingList().length, 1);
  await w.recoverPending(0);
  assert.equal(w.pendingList().length, 1, "the token is still on screen: the coins stay out of the wallet (or it could be spent twice)");
  w.holdOff(shown.id); // the dialog closed: nothing shows the token any more
  await w.recoverPending(0);
  assert.equal(w.pendingList().length, 0, "unspent, so it comes back");
  assert.equal(w.balance(MINT), 1000);
  // The dialog's Done settles it: the token is the other person's business now.
  const given = await w.pay(MINT, 100, { hold: true });
  w.settle(given.id);
  assert.equal(w.pendingList().length, 0);
  assert.equal(await w.reclaim(given.id), "unknown", "a token this wallet no longer holds is never reported as taken");
}

// ── A coin the mint calls spent is set aside, not silently deleted ──
{
  const net = newNet();
  const w = build(net);
  await topUp(w, net, 1000);
  const secret = w.state.mints[MINT].proofs[0].secret;
  net[MINT].spent.add(secret); // another device restored the wallet and swapped every coin
  const first = await w.syncSpent();
  assert.deepEqual({ q: first.quarantined, d: first.dropped }, { q: 1000, d: 0 }, "set aside: the app can say what happened");
  assert.equal(w.balance(MINT), 0, "not counted as money any more");
  assert.equal(w.state.suspect.length, 1, "but still known, so another answer can bring it back");
  // A second answer straight away is not enough: a mint can be wrong, or lie.
  const second = await w.syncSpent();
  assert.equal(second.dropped, 0);
  assert.equal(w.state.suspect.length, 1);
  // A second answer a while later is believed.
  w.state.suspect[0].at = Date.now() - SUSPECT_SETTLE_MS - 1000;
  const third = await w.syncSpent();
  assert.equal(third.dropped, 1000, "believed only when the mint says so twice, a while apart");
  assert.equal(w.state.suspect.length, 0);
}
{
  // A mint that says spent and then unspent gives the money back (nothing is thrown away on one answer).
  const net = newNet();
  const w = build(net);
  await topUp(w, net, 500);
  const secret = w.state.mints[MINT].proofs[0].secret;
  net[MINT].spent.add(secret);
  await w.syncSpent();
  assert.equal(w.balance(MINT), 0);
  net[MINT].spent.delete(secret);
  const r = await w.syncSpent();
  assert.equal(r.restored, 500);
  assert.equal(w.balance(MINT), 500, "the coins are back in the wallet");
}
{
  // The mint cannot be asked: nothing is decided (no answer is not an answer).
  const net = newNet();
  const w = build(net);
  await topUp(w, net, 700);
  net[MINT].statesDown = true;
  const r = await w.syncSpent();
  assert.deepEqual(r, { quarantined: 0, dropped: 0, restored: 0 });
  assert.equal(w.balance(MINT), 700);
}

// ── A deposit address that can still be paid is never dropped ──
{
  let saves = 0;
  const store = { ...memStore(), save: (s) => { saves++; return true; } };
  const makeAdapter = (url, expiry) => {
    let n = 0;
    return {
      async onchainSupported() { return true; },
      onchainPubkey: (i) => "02" + String(i).padStart(64, "a"),
      async quoteOnchain(i) { return { id: url + "#" + (++n), address: "bcrt1q" + i, expiry, pubkey: "02" + String(i).padStart(64, "a") }; },
      async onchainState() { return { paid: 0, issued: 0 }; },
      async mintOnchain() { return []; },
    };
  };
  const keep = makeAdapter("https://keep.test", Date.now() / 1000 + 86400);
  const w = new EcashWallet({ store, mintFor: (u) => (u === "https://keep.test" ? keep : makeAdapter(u, Date.now() / 1000 - 60)), tokenInfo });
  const first = await w.onchainStart("https://keep.test");
  for (let i = 0; i < 25; i++) await w.onchainStart("https://m" + i + ".test"); // each one expired
  assert.ok(w.onchainList().some((q) => q.id === first.id), "an address that has not expired stays claimable");
  assert.ok(w.state.onchain.length <= 21, "only recent expired addresses are forgotten: " + w.state.onchain.length);
  assert.ok(saves > 0);
}

// ── A mint's answer that the browser will not save is retried at once, and the wallet says so ──
{
  let full = false, saved = null;
  const store = { load: () => saved && JSON.parse(saved), save: (s) => { if (full) return false; saved = JSON.stringify(s); return true; }, erase: () => { saved = null; } };
  const net = newNet();
  const w = build(net, store);
  await topUp(w, net, 100);
  full = true;
  assert.equal(w._saveMoney(), false);
  assert.equal(w.saveOk, false);
  assert.equal(w.saveCritical, true, "the app can tell the person that money moved and only this page knows it");
  full = false;
  assert.equal(w.retrySave(), true);
  assert.equal(w.saveCritical, false);
  assert.ok(saved && JSON.parse(saved).mints, "the coins are on disk");
}
console.log("wallet safety tests ok");
