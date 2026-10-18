// The trip card during a ride: the low-balance warning, the fare-change estimate for a stop / new destination, the seconds on the trip clock.
import assert from "node:assert/strict";

const R = new URL("../src", import.meta.url).pathname;
const F = await import(`${R}/lib/fare.js`);
const M = await import(`${R}/lib/meter.js`);
const E = await import(`${R}/lib/useFareEstimate.js`);
const { LOW_BALANCE_USD } = await import(`${R}/config/settings.js`);

// ── The rider's ecash turns red at $5.00 or less (US dollars at the live price) ──
assert.equal(LOW_BALANCE_USD, 5);
assert.equal(F.lowBalanceSats(100000), 5000, "$5 at $100,000 per bitcoin");
assert.equal(F.isLowBalance(5000, 100000), true, "exactly $5.00 is low");
assert.equal(F.isLowBalance(4999, 100000), true);
assert.equal(F.isLowBalance(5001, 100000), false, "a cent more is not");
assert.equal(F.isLowBalance(0, 100000), true, "an empty wallet is low");
assert.equal(F.isLowBalance(20000, 50000), false, "$10 at $50,000 per bitcoin");
assert.equal(F.isLowBalance(10000, 50000), true, "$5 at $50,000 per bitcoin");
assert.equal(F.isLowBalance(4000, null), true, "no live price: the app's fallback price decides");
assert.equal(F.isLowBalance(NaN, 100000), false, "an unknown balance is never called low");
assert.equal(F.isLowBalance(null, 100000), false);

// ── The estimated change in the fare: per mile × Δmiles + per minute × Δminutes (the base rate does not change) ──
const rates = { base: 2, perMile: 1.1, perMinute: 0.25, currency: "USD" };
const PRICE = 100000; // $1 = 1,000 sats
assert.equal(F.fareChangeSats(rates, { miles: 5, minutes: 15 }, { miles: 7, minutes: 19 }, PRICE), 2 * 1100 + 4 * 250, "2 more miles and 4 more minutes: $3.20");
assert.equal(F.fareChangeSats(rates, { miles: 5, minutes: 15 }, { miles: 4, minutes: 12 }, PRICE), -(1100 + 3 * 250), "a shorter way is a lower fare (negative)");
assert.equal(F.fareChangeSats(rates, { miles: 5, minutes: 15 }, { miles: 5, minutes: 15 }, PRICE), 0);
assert.equal(F.fareChangeSats(rates, { miles: 5, minutes: 15 }, { miles: 7, minutes: 19 }, null), null, "no price: no number");
assert.equal(F.fareChangeSats(null, { miles: 5, minutes: 15 }, { miles: 7, minutes: 19 }, PRICE), null, "no rates: no number");
assert.equal(F.fareChangeSats({ base: 1, perMile: 999, perMinute: 1 }, { miles: 1, minutes: 1 }, { miles: 2, minutes: 2 }, PRICE), null, "junk rates are refused");
assert.equal(F.fareChangeSats(rates, null, { miles: 1, minutes: 1 }, PRICE), null);
// Another currency: the rates are in euros, the price is euros per bitcoin.
assert.equal(F.fareChangeSats({ base: 1, perMile: 1, perMinute: 0.5, currency: "EUR" }, { miles: 1, minutes: 2 }, { miles: 3, minutes: 6 }, 50000), Math.round(((2 * 1 + 4 * 0.5) / 50000) * 1e8), "EUR at 50,000 per bitcoin");

// ── Which routes are priced for a change ──
const A = { lat: 1, lng: 1 }, S1 = { lat: 2, lng: 2 }, D = { lat: 3, lng: 3 }, N = { lat: 4, lng: 4 };
let c = E.changeRoutes({ from: A, ahead: [D], mode: "stop", place: N });
assert.deepEqual(c.before, [A, D], "now: the car, then the destination");
assert.deepEqual(c.after, [A, N, D], "a new stop comes before the destination");
c = E.changeRoutes({ from: A, ahead: [S1, D], mode: "stop", place: N });
assert.deepEqual(c.after, [A, S1, N, D], "after the stops still ahead");
c = E.changeRoutes({ from: A, ahead: [S1, D], mode: "destination", place: N });
assert.deepEqual(c.before, [A, S1, D]);
assert.deepEqual(c.after, [A, S1, N], "a new destination replaces the old one; the stops ahead stay");
assert.equal(E.estimatePrice("USD", null), 100000, "dollars may use the app's fallback price for an ESTIMATE");
assert.equal(E.estimatePrice("EUR", null), null, "another currency is never guessed");
assert.equal(E.estimatePrice("EUR", 90000), 90000);

// ── The trip clock counts the seconds ──
assert.equal(M.fmtDurationSec(0), "0 s");
assert.equal(M.fmtDurationSec(45000), "45 s");
assert.equal(M.fmtDurationSec(59999), "59 s");
assert.equal(M.fmtDurationSec(60000), "1 min 00 s");
assert.equal(M.fmtDurationSec(5 * 60000 + 3000), "5 min 03 s");
assert.equal(M.fmtDurationSec(59 * 60000 + 59000), "59 min 59 s");
assert.equal(M.fmtDurationSec(3600000 + 5 * 60000 + 3000), "1 h 05 min 03 s");
assert.equal(M.fmtDurationSec(-1), "–");
assert.equal(M.fmtDurationSec(NaN), "–");
assert.equal(M.fmtDuration(5 * 60000 + 3000), "5 min", "the other clocks (the drive to the pickup) keep whole minutes");

console.log("tripcard ok");

// ── Miles or kilometers: only the display changes ──
{
  const U = await import(`${new URL("../src", import.meta.url).pathname}/lib/units.js`);
  assert.equal(U.getUnits(), "mi", "miles until changed");
  assert.equal(U.formatDistance(7.3), "7.3 mi");
  assert.equal(U.formatDistance(10, { unit: "km" }), "16.1 km");
  assert.equal(U.formatDistance(10, { digits: 0, unit: "km" }), "16 km");
  assert.ok(Math.abs(U.ratePerUnit(1.1, "km") - 0.6835) < 0.001, "$1.10 per mile is about $0.68 per kilometer");
  assert.ok(Math.abs(U.milesFrom(U.distanceIn(3.7, "km"), "km") - 3.7) < 1e-9, "the round trip is exact");
  assert.equal(U.distanceIn(5, "mi"), 5);
}
