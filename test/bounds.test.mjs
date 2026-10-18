// What the rider's app will pay: a distance claimed by the OTHER person is held to what this phone can believe, each ride has a
// spending cap, and a price far from the last good one waits for confirmation.
// Run with: npm test
import assert from "node:assert/strict";
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const M = await import(`${R}/lib/meter.js`);
const Rm = await import(`${R}/lib/ridemoney.js`);
const Tm = await import(`${R}/lib/terms.js`);
const Sc = await import(`${R}/lib/spendcap.js`);
const Pay = await import(`${R}/lib/payments.js`);
const Cur = await import(`${R}/lib/currency.js`);
const { payDue } = await import(`${R}/features/payments/rideTicks.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);
const { MINT, newNet, build, topUp } = await import("./helpers/fakemint.mjs");

const H = 3600000, MIN = 60000, PRICE = 100000; // 1,000 sats per dollar

// ── boundedMiles ──
assert.equal(M.boundedMiles(5000, { own: 0.2, ownAt: H, startedAt: 0, atMs: H }), 0.25, "a claim of 5,000 miles is held to our own 0.2 mi (+ the 0.05 mi floor)");
assert.equal(M.boundedMiles(4.9, { own: 5, ownAt: H, startedAt: 0, atMs: H }), 4.9, "within 5% of our own: believed");
assert.equal(M.boundedMiles(0, { own: 10, ownAt: H, startedAt: 0, atMs: H }), 9.5, "a claim far BELOW our own is raised to our own less 5%");
assert.equal(M.boundedMiles(5000, { startedAt: 0, atMs: 0.5 * H }), 35, "with no measure of our own, the clock allows 70 mph on average: 35 miles in half an hour");
assert.equal(M.boundedMiles(5000, { startedAt: 0, atMs: 5 * H, quotedMiles: 4 }), 11, "and never more than twice the quoted route plus 3 miles");
assert.equal(M.boundedMiles(7, { startedAt: 0, atMs: 5 * H, quotedMiles: 4 }), 7, "a believable claim is left alone");
assert.equal(M.boundedMiles(30, { own: 2, ownAt: 0, startedAt: 0, atMs: 0.5 * H }), 30, "an old measure leaves room for the miles a car could have driven since (35 miles in half an hour)");
assert.equal(M.boundedMiles(40, { own: 2, ownAt: 0, startedAt: 0, atMs: 0.5 * H }), 35, "but not more than that");
assert.equal(M.boundedMiles(NaN, { own: 3, ownAt: H, startedAt: 0, atMs: H }), 3, "no claim: our own");
assert.equal(M.boundedMiles(undefined, { startedAt: 0, atMs: H }), 0);

// ── A driver ends the ride claiming 5,000 miles ──
const rider = generateKeypair(), driver = generateKeypair();
const T0 = Date.now() - 20 * MIN;
const sec = (ms) => Math.floor(ms / 1000);
const signAs = (who, kind, content, tags, atMs) => {
  const ev = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk);
  if (atMs) ev.created_at = sec(atMs);
  relay._store(ev);
  return ev;
};
function newRide(name, extra = {}) {
  const d = "ride-" + name;
  const trip = { pickup: { name: "P", lat: 38, lng: -84.5 }, dropoff: { name: "D", lat: 38.1, lng: -84.5 }, distanceMiles: 3, durationMin: 8, ...extra };
  const req = signAs(rider, K.RIDE_REQUEST, { ...trip, status: "requested", time: "ASAP" }, [["d", d]], T0 - 5 * MIN);
  const offer = signAs(driver, K.RIDE_OFFER, { priceSats: 5000, mode: "metered", rates: { base: 1.5, perMile: 1.1, perMinute: 0.2, currency: "USD" }, mint: MINT }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]], T0 - 4 * MIN);
  signAs(rider, K.RIDE_ACCEPT, { offerId: offer.id, requestId: req.id }, [["e", offer.id], ["e", req.id], ["p", driver.publicKey], ["d", "accept-" + req.id]], T0 - 3 * MIN);
  const live = signAs(rider, K.RIDE_REQUEST, { ...trip, status: "in_progress", driverPubkey: driver.publicKey }, [["d", d], ["p", driver.publicKey]], T0 - 2 * MIN);
  signAs(rider, K.RIDE_CONFIRM, { phase: "code", ok: true }, [["e", live.id], ["p", driver.publicKey], ["d", "confirm-" + d + "-code"]], T0 - 30000);
  signAs(driver, K.RIDE_STAGE, { stage: "riding", at: T0 }, [["e", live.id], ["p", rider.publicKey], ["d", "stage-" + d]], T0);
  return live;
}
{
  const ride = newRide("a");
  const now = T0 + 5 * MIN;
  signAs(driver, K.RIDE_FINISH, { requestId: ride.id, reason: "driver", role: "driver", at: now, miles: 5000, minutes: 5 }, [["e", ride.id], ["p", rider.publicKey], ["d", "finish-" + ride.id]], now);
  const led = Rm.currentLedger(ride, { terms: Tm.rideTerms(ride), price: PRICE, nowMs: now + 1000, miles: 0.2, role: "rider" });
  const sum = Rm.ledgerSummary(ride, led);
  assert.ok(led.units.filter((u) => u.kind === "mile").length === 0, "no mile ticks: the rider's own meter saw 0.2 mi");
  assert.ok(sum.owed < 3000, "the rider owes the base and 5 minutes, about $2.5, not thousands of dollars: " + sum.owed);
}
{
  // The rider's app was closed (no live meter): the saved ledger's last miles, plus what the clock allows, decide.
  const ride = newRide("b");
  const now = T0 + 6 * MIN;
  Rm.currentLedger(ride, { terms: Tm.rideTerms(ride), price: PRICE, nowMs: T0 + 2 * MIN, miles: 0.8, role: "rider" }); // the app saw 0.8 mi, then was closed
  signAs(driver, K.RIDE_FINISH, { requestId: ride.id, reason: "driver", role: "driver", at: now, miles: 5000, minutes: 6 }, [["e", ride.id], ["p", rider.publicKey], ["d", "finish-" + ride.id]], now);
  const led = Rm.currentLedger(ride, { terms: Tm.rideTerms(ride), price: PRICE, nowMs: now + 1000, miles: null, role: "rider" });
  assert.ok(led.final.miles <= 0.8 + 0.05 + (4 / 60) * 70 + 1e-6, "claim held to the last measure plus 4 minutes at 70 mph: " + led.final.miles);
  assert.ok(led.final.miles < 7, "not 5,000");
}
{
  // A driver reports 900 miles on a 3-mile trip while the clock says 4 minutes: live miles are held to the clock.
  const ride = newRide("c");
  const led = Rm.currentLedger(ride, { terms: Tm.rideTerms(ride), price: PRICE, nowMs: T0 + 4 * MIN, miles: 900, role: "rider" });
  assert.ok(led.units.filter((u) => u.kind === "mile").length <= 5, "at most the miles 4 minutes allow: " + led.units.filter((u) => u.kind === "mile").length);
}

// ── The spending cap ──
{
  const ride = newRide("d");
  const terms = Tm.rideTerms(ride);
  const cap = Sc.rideSpendCap(ride, { terms, price: PRICE, usdPrice: PRICE });
  const quoted = Math.round(((1.5 + 1.1 * 3 + 0.2 * 8) / PRICE) * 1e8); // $6.40 at the quoted 3 mi, 8 min
  assert.equal(cap, Math.max(quoted * 3, 10000), "3 times the quoted fare, never less than 10 dollars");
  assert.equal(Sc.rideSpendCap(ride, { terms, price: PRICE * 100, usdPrice: PRICE * 100 }), cap, "fixed for the ride: a price jump cannot raise it");
  Sc.allowMoreSpend(ride);
  assert.equal(Sc.rideSpendCap(ride, { terms, price: PRICE, usdPrice: PRICE }), cap * 2, "allow more: one more cap's worth");
}
{
  const net = newNet(), riderW = build(net);
  await topUp(riderW, net, 50000);
  const ride = newRide("e");
  const publishAs = (who) => async (kind, content, tags) => { signAs(who, kind, content, tags); return true; };
  const ctx = (nowMs, miles, capSats) => ({ request: ride, user: rider, ecash: riderW, publish: publishAs(rider), terms: Tm.rideTerms(ride), mint: Tm.rideMint(ride), price: PRICE, nowMs, miles, capSats });
  // 10 minutes in: base + 10 minutes = 3,500 sats are due; the cap is 3,000.
  let r = await payDue(ctx(T0 + 10 * MIN, 0, 3000));
  assert.equal(Pay.sentSats(ride) <= 3000, true, "never past the cap: " + Pay.sentSats(ride));
  r = await payDue(ctx(T0 + 10 * MIN + 1000, 0, 3000));
  assert.equal(r.status, "capped", "at the cap the app stops");
  assert.ok(r.held > 0, "and says how much is held back");
  const sentAtCap = Pay.sentSats(ride);
  r = await payDue(ctx(T0 + 10 * MIN + 2000, 0, 3000));
  assert.equal(Pay.sentSats(ride), sentAtCap, "nothing more is paid while capped");
  r = await payDue(ctx(T0 + 10 * MIN + 3000, 0, 6000));
  assert.ok(r.status === "paid" && Pay.sentSats(ride) > sentAtCap, "after the rider allows more, the held payment is made");
}

// ── A price far from the last good one waits for confirmation ──
{
  let r = Cur.acceptPrices({ USD: 100000, EUR: 90000 }, { USD: 101000, EUR: 91000 });
  assert.deepEqual(r.prices, { USD: 101000, EUR: 91000 }, "a small move is taken");
  r = Cur.acceptPrices({ USD: 100000 }, { USD: 1 }, {});
  assert.equal(r.prices.USD, 100000, "a price of 1 is not taken");
  assert.deepEqual(r.suspects, { USD: { value: 1, n: 1 } });
  r = Cur.acceptPrices(r.prices, { USD: 1 }, r.suspects);
  r = Cur.acceptPrices(r.prices, { USD: 100000 }, r.suspects);
  assert.equal(r.prices.USD, 100000, "back to normal: the suspect is forgotten");
  assert.deepEqual(r.suspects, {});
  let s = {}, p = { USD: 100000 };
  for (let i = 0; i < 3; i++) ({ prices: p, suspects: s } = Cur.acceptPrices(p, { USD: 60000 }, s));
  assert.equal(p.USD, 60000, "a real crash is taken on the third fetch in a row");
  assert.equal(Cur.acceptPrices({}, { USD: 5 }).prices.USD, 5, "with no earlier price there is nothing to compare with");
  assert.equal(Cur.acceptPrices({ USD: 100000 }, { USD: -4, EUR: NaN }).prices.USD, 100000, "junk is ignored");
}
console.log("bounds checks passed");
process.exit(0);
