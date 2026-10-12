// Pay-as-you-ride ticks, finishing a ride, start codes, the 50 m arrival rule, silence, GPS gaps, currency.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const Tk = await import(`${R}/lib/ticks.js`);
const Fin = await import(`${R}/lib/finish.js`);
const Sc = await import(`${R}/lib/startcode.js`);
const Ar = await import(`${R}/lib/arrival.js`);
const Cur = await import(`${R}/lib/currency.js`);
const Od = await import(`${R}/lib/odometer.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);

const T0 = 1_700_000_000_000;
const MIN = 60000;
const PRICE = 100000; // $100,000 per BTC: 1 cent = 10 sats, $1 = 1,000 sats
const metered = Tk.normalizeTerms({ mode: "metered", currency: "USD", base: 2, perMile: 1.1, perMinute: 0.25 });
const flat = Tk.normalizeTerms({ mode: "flat", currency: "USD", base: 2, perMile: 1.1, perMinute: 0.25, flatSats: 10000, tripMiles: 5, tripMinutes: 15 });

// ── Terms are checked ──
assert.equal(Tk.normalizeTerms(null), null);
assert.equal(Tk.normalizeTerms({ base: 1, perMile: 1 }), null, "a missing rate is junk");
assert.equal(Tk.normalizeTerms({ base: -1, perMile: 1, perMinute: 1 }), null);
assert.equal(Tk.normalizeTerms({ mode: "flat", base: 1, perMile: 1, perMinute: 1 }), null, "a flat ride needs a price");
assert.deepEqual(Tk.unitSats(metered, PRICE), { base: 2000, mile: 1100, minute: 250 });
assert.equal(Tk.unitSats(metered, null), null, "no price: no guess");

// ── Base at the start, a tick per minute, a tick per mile ──
let led = Tk.newLedger(T0);
led = Tk.advanceLedger(led, { terms: metered, nowMs: T0, miles: 0, price: PRICE });
assert.deepEqual(led.units.map((u) => u.id), ["base"], "the base rate is due when the ride starts");
assert.equal(Tk.owedSats(led), 2000);
led = Tk.advanceLedger(led, { terms: metered, nowMs: T0 + 59000, miles: 0.4, price: PRICE });
assert.equal(led.units.length, 1, "nothing before a full minute or mile");
led = Tk.advanceLedger(led, { terms: metered, nowMs: T0 + 3 * MIN + 5000, miles: 2.3, price: PRICE });
assert.deepEqual(led.units.map((u) => u.id), ["base", "min-1", "min-2", "min-3", "mile-1", "mile-2"]);
assert.equal(Tk.owedSats(led), 2000 + 3 * 250 + 2 * 1100);
const same = Tk.advanceLedger(led, { terms: metered, nowMs: T0 + 3 * MIN + 6000, miles: 2.3, price: PRICE });
assert.equal(same.units.length, led.units.length, "a tick is added once");
// The sats of a tick are fixed when it falls due: a later price change does not rewrite old ticks.
const later = Tk.advanceLedger(led, { terms: metered, nowMs: T0 + 4 * MIN, miles: 2.3, price: 50000 });
assert.equal(later.units.find((u) => u.id === "min-3").sats, 250);
assert.equal(later.units.find((u) => u.id === "min-4").sats, 500, "a new tick uses the new price ($0.25 at $50,000)");
// With no price the ticks wait (and are added when a price is known).
const waiting = Tk.advanceLedger(Tk.newLedger(T0), { terms: metered, nowMs: T0 + MIN, miles: 0, price: null });
assert.equal(waiting.units.length, 0);

// ── Paying, due, and MISSED payments ──
assert.equal(Tk.dueSats(led, 0), 4950);
assert.equal(Tk.dueSats(led, 4950), 0);
assert.equal(Tk.dueSats(led, 99999), 0, "overpaying leaves nothing due");
const now = T0 + 3 * MIN + 5000;
assert.equal(Tk.missedTicks(led, 4950, now), 0, "all paid");
assert.equal(Tk.missedTicks(led, 0, T0 + 10000), 0, "inside the grace time nothing is missed");
assert.equal(Tk.missedTicks(led, 0, now), 3, "base, minute 1 and minute 2 are overdue; minute 3 and the miles are under 30 s old");
assert.equal(Tk.missedTicks(led, 0, now + 40000), 6, "40 s later everything is overdue");
assert.equal(Tk.missedTicks(led, 2000, now + 40000), 5, "paying the base clears one");
assert.equal(Tk.missedTicks(led, 4950, now + 40000), 0, "one catch-up payment clears them all");
assert.equal(Tk.missedTicks(led, 6190, now + 40000), 0, "a few sats of price drift are not a miss");
assert.ok(Tk.MISSED_LIMIT === 2, "the driver may finish after two missed ticks");

// ── Finishing: the part of a mile and of a minute that is not paid yet ──
const fin = Tk.settle(led, { terms: metered, atMs: T0 + 3 * MIN + 30000, miles: 2.5, price: PRICE });
// 0.5 mile * 1100 + 0.5 minute * 250 = 675
assert.equal(fin.final.sats, 675);
assert.equal(Tk.owedSats(fin), 4950 + 675);
assert.equal(Tk.settle(fin, { terms: metered, atMs: T0 + 4 * MIN, miles: 3, price: PRICE }), fin, "a finished ride stays finished");
assert.equal(Tk.settle(led, { terms: metered, atMs: T0 + 4 * MIN, miles: 3, price: null }), null, "no price: the final tick waits");
const right = Tk.settle(Tk.advanceLedger(Tk.newLedger(T0), { terms: metered, nowMs: T0, miles: 0, price: PRICE }), { terms: metered, atMs: T0 + 1000, miles: 0, price: PRICE });
assert.equal(Tk.owedSats(right), 2000 + 4, "finishing right after the start owes the base and a few seconds");

// ── A flat price: same ticks, scaled so the trip adds up to the price, never above it ──
const per = Tk.unitSats(flat, null);
// estimate = 2 + 1.1*5 + 0.25*15 = 11.25 -> shares of 10,000 sats
assert.deepEqual(per, { base: 1777, mile: 977, minute: 222 });
let fl = Tk.advanceLedger(Tk.newLedger(T0, "flat"), { terms: flat, nowMs: T0 + 15 * MIN, miles: 5, price: null });
assert.ok(Tk.owedSats(fl) <= 10000, "never above the flat price");
assert.ok(Tk.owedSats(fl) >= 9900, "a trip as long as priced pays about the whole price: " + Tk.owedSats(fl));
const traffic = Tk.advanceLedger(Tk.newLedger(T0, "flat"), { terms: flat, nowMs: T0 + 90 * MIN, miles: 40, price: null });
assert.equal(Tk.owedSats(traffic), 10000, "traffic and detours add nothing past the flat price");
const early = Tk.settle(Tk.advanceLedger(Tk.newLedger(T0, "flat"), { terms: flat, nowMs: T0 + 3 * MIN, miles: 1, price: null }), { terms: flat, atMs: T0 + 3 * MIN + 30000, miles: 1.5, price: null });
assert.equal(Tk.owedSats(early), 1777 + 3 * 222 + 977 + 600, "finished early: base + 3 minutes + 1 mile + half a mile and half a minute");
const arrived = Tk.settle(Tk.advanceLedger(Tk.newLedger(T0, "flat"), { terms: flat, nowMs: T0 + 8 * MIN, miles: 4, price: null }), { terms: flat, atMs: T0 + 8 * MIN, miles: 4, price: null, atDestination: true });
assert.equal(Tk.owedSats(arrived), 10000, "the driver finishing at the destination is owed the whole flat price");

// ── An extra stop turns a flat ride into the driver's normal fare, counted from the start ──
const conv = Tk.convertToMetered(traffic, { terms: flat, nowMs: T0 + 90 * MIN, miles: 40, price: PRICE });
assert.equal(conv.mode, "metered");
assert.equal(conv.units.filter((u) => u.kind === "minute").length, 90);
assert.equal(Tk.owedSats(conv), 2000 + 90 * 250 + 40 * 1100, "base + minutes + miles from the initial start");
assert.equal(Tk.dueSats(conv, 10000), Tk.owedSats(conv) - 10000, "what the rider already paid stays paid");
assert.equal(Tk.convertToMetered(conv, { terms: flat, nowMs: T0, miles: 0, price: PRICE }), conv, "already metered: unchanged");

// ── Miles at a time (charge up to the last signal) ──
let sm = Tk.newLedger(T0);
for (let i = 0; i <= 8; i++) sm = Tk.advanceLedger(sm, { terms: metered, nowMs: T0 + i * 15000, miles: i * 0.1, price: PRICE });
assert.ok(Math.abs(Tk.milesAt(sm, T0 + 30000) - 0.2) < 1e-9);
assert.ok(Math.abs(Tk.milesAt(sm, T0 + 37500) - 0.25) < 1e-9, "between two samples: a straight line");
assert.equal(Tk.milesAt(sm, T0 - 5000), 0);
assert.ok(Math.abs(Tk.milesAt(sm, T0 + 9e6) - 0.8) < 1e-9, "after the last sample: the last");
assert.equal(Tk.milesAt(Tk.newLedger(T0), T0 + 1000), 0);

// ── Finish rules ──
assert.equal(Fin.quietMs(1000, 5000), 4000);
assert.equal(Fin.quietMs(1000, 5000, 3000), 1000, "relay downtime is not counted");
assert.equal(Fin.quietMs(1000, 5000, 99999), 0);
assert.equal(Fin.quietMs(null, 5000), Infinity);
assert.equal(Fin.bothQuiet({ riderAt: T0, driverAt: T0 + MIN, nowMs: T0 + 5 * MIN }).finish, false);
const quiet = Fin.bothQuiet({ riderAt: T0, driverAt: T0 + MIN, nowMs: T0 + 12 * MIN });
assert.equal(quiet.finish, true, "10 minutes of silence from both");
assert.equal(quiet.lastAt, T0 + MIN, "the last signal of either person");
assert.equal(Fin.bothQuiet({ riderAt: T0, driverAt: T0 + MIN, nowMs: T0 + 12 * MIN, downMs: 5 * MIN }).finish, false, "a relay outage pauses the clock");
assert.equal(Fin.bothQuiet({ riderAt: null, driverAt: null, nowMs: T0 }).finish, false, "no signal yet: nothing to measure");
assert.equal(Fin.finishCutoff("silence", { nowMs: T0 + 12 * MIN, lastSignalAt: T0 + MIN }), T0 + MIN, "after a silence the charge runs to the last signal");
assert.equal(Fin.finishCutoff("rider", { nowMs: T0 + 12 * MIN, lastSignalAt: T0 + MIN }), T0 + 12 * MIN);
assert.equal(Fin.finishCutoff("silence", { nowMs: T0, lastSignalAt: T0 + MIN }), T0, "never in the future");
assert.deepEqual(Fin.waiverSplit({ outstandingSats: 500, paidSats: 3000, waiveSats: 300 }), { forgiven: 300, refund: 0 }, "unpaid money is waived first");
assert.deepEqual(Fin.waiverSplit({ outstandingSats: 500, paidSats: 3000, waiveSats: 1500 }), { forgiven: 500, refund: 1000 }, "the rest is refunded");
assert.deepEqual(Fin.waiverSplit({ outstandingSats: 0, paidSats: 100, waiveSats: 9999 }), { forgiven: 0, refund: 100 }, "never more than the fare");
assert.deepEqual(Fin.waiverSplit({ outstandingSats: 5, paidSats: 5, waiveSats: -3 }), { forgiven: 0, refund: 0 });
assert.equal(Fin.readFinish({ reason: "<script>", at: -5, miles: "x" }).reason, "", "junk is dropped");
assert.equal(Fin.readFinish({ reason: "silence", at: T0, miles: 3.2, minutes: 11, role: "driver", atDestination: true }).atDestination, true);
assert.equal(Fin.readFinish("x"), null);

// ── The start code: each person has their own, both phones can work it out, nobody else can ──
const rider = generateKeypair(), driver = generateKeypair();
const key = rider.publicKey + ":ride-1";
const riderCode = Sc.startCode(rider.sk, driver.publicKey, key, "rider");
const driverCode = Sc.startCode(rider.sk, driver.publicKey, key, "driver");
assert.match(riderCode, /^\d\d$/);
assert.equal(Sc.startCode(driver.sk, rider.publicKey, key, "rider"), riderCode, "the driver's phone works out the same code");
assert.equal(Sc.startCode(driver.sk, rider.publicKey, key, "driver"), driverCode);
const codes = new Set(Array.from({ length: 40 }, (_, i) => Sc.startCode(rider.sk, driver.publicKey, key + i, "rider")));
assert.ok(codes.size > 15, "different for every ride");
assert.ok(Sc.checkCode(riderCode, riderCode));
assert.ok(Sc.checkCode(" " + riderCode + " ", riderCode), "spaces are fine");
assert.ok(!Sc.checkCode("7", "07"), "two digits are required");
assert.ok(!Sc.checkCode("", "07"));
let gate = null;
for (let i = 0; i < 2; i++) gate = Sc.recordAttempt(gate, false, T0);
assert.ok(Sc.attemptGate(gate, T0).open, "2 wrong tries are allowed");
gate = Sc.recordAttempt(gate, false, T0);
assert.ok(!Sc.attemptGate(gate, T0 + 1000).open, "the 3rd wrong try locks typing for 30 s");
assert.ok(Sc.attemptGate(gate, T0 + 31000).open, "and it opens again later");
gate = Sc.recordAttempt(gate, false, T0 + 31000);
assert.ok(!Sc.attemptGate(gate, T0 + 31000 + 40000).open, "the next lock is longer (60 s)");
assert.deepEqual(Sc.recordAttempt(gate, true, T0), { wrong: 0, lockedUntil: 0 }, "a right code clears it");

// ── "I've arrived" only within 50 m of the pickup, on a good fix ──
const pin = { lat: 38, lng: -84.5 };
const at = (m) => ({ lat: pin.lat + m / 111320, lng: pin.lng });
assert.ok(Ar.canMarkArrived({ pos: at(30), status: "good", pickup: pin }).ok, "30 m away");
assert.ok(!Ar.canMarkArrived({ pos: at(80), status: "good", pickup: pin }).ok, "80 m away");
assert.match(Ar.canMarkArrived({ pos: at(80), status: "good", pickup: pin }).reason, /within 50 m/);
assert.ok(!Ar.canMarkArrived({ pos: at(10), status: "weak", pickup: pin }).ok, "a weak fix cannot prove it");
assert.ok(!Ar.canMarkArrived({ pos: at(10), status: "stale", pickup: pin }).ok);
assert.ok(!Ar.canMarkArrived({ pos: null, status: "searching", pickup: pin }).ok);
assert.ok(!Ar.arrivalMismatch(at(120), pin), "the rider's check allows for GPS error");
assert.ok(Ar.arrivalMismatch(at(900), pin), "a claimed arrival 900 m away is flagged");
assert.ok(!Ar.arrivalMismatch(null, pin));

// ── A GPS gap (a tunnel): up to 10 minutes is filled with a straight line, longer is not ──
const fix = (m, t) => ({ lat: 38 + m / 111320, lng: -84.5, accuracy: 5, t });
let o = Od.stepOdo(Od.newOdo(), fix(0, T0));
o = Od.stepOdo(o, fix(10, T0 + 5000));
const beforeGap = o.miles;
const tunnel = Od.stepOdo(o, fix(3000, T0 + 5000 + 5 * MIN)); // 3 km in 5 minutes
assert.ok(Math.abs(tunnel.miles - beforeGap - 3000 / 1609.344) < 0.01, "5 minutes in a tunnel: the straight line between the fixes counts");
const longGap = Od.stepOdo(o, fix(3000, T0 + 5000 + 11 * MIN));
assert.equal(longGap.miles, beforeGap, "after 10 minutes the missing miles are not counted");
assert.equal(longGap.last.lat, fix(3000, 0).lat, "but tracking restarts at the new fix");
const after = Od.stepOdo(longGap, fix(3200, T0 + 5000 + 11 * MIN + 10000));
assert.ok(after.miles > beforeGap, "and counts again");

// ── Currency ──
assert.equal(Cur.toMinor(12.4, "USD"), 1240);
assert.equal(Cur.toMinor(300, "JPY"), 300, "yen has no cents");
assert.equal(Cur.fromMinor(1240, "USD"), 12.4);
assert.equal(Cur.satsFromFiat(1, 100000), 1000);
assert.equal(Cur.satsFromFiat(1, 0), null, "no price: not guessed");
assert.equal(Cur.satsFromFiat(1, NaN), null);
assert.equal(Cur.fiatFromSats(6370, 100000, "USD"), 6.37);
assert.equal(Cur.fiatFromSats(6370, 100000, "JPY"), 6, "yen is rounded to a whole yen");
assert.equal(Cur.formatFiat(12.4, "USD"), "$12.40");
assert.equal(Cur.formatFiat(0.004, "USD"), "<$0.01");
assert.equal(Cur.formatFiat(null, "USD"), "");
assert.ok(Cur.isCurrency("EUR") && !Cur.isCurrency("XXX") && !Cur.isCurrency("toString"));
assert.equal(Cur.getCurrency(), "USD");
Cur.setCurrency("XXX");
assert.equal(Cur.getCurrency(), "USD", "an unknown code is ignored");
console.log("ticks tests ok");
