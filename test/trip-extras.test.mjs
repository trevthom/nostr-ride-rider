// Tips, pickup changes, the trip meter (odometer + reference distance), stage times.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const P = await import(`${R}/lib/privacy.js`);
const Pk = await import(`${R}/lib/pickup.js`);
const Ev = await import(`${R}/lib/evidence.js`);
const Ea = await import(`${R}/lib/earnings.js`);
const Rd = await import(`${R}/lib/rides.js`);
const Od = await import(`${R}/lib/odometer.js`);
const Mt = await import(`${R}/lib/meter.js`);
const { latestVersions } = await import(`${R}/nostr/replaceable.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const pub = (kind, content, tags, who, at) => {
  const e = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk);
  if (at) { e.created_at = at; } // only for the cache: the signature is not checked there
  relay._store(e);
  return e;
};
const now = () => Math.floor(Date.now() / 1000);
const rider = generateKeypair(), driver = generateKeypair(), other = generateKeypair(), attacker = generateKeypair();

// ── Odometer ──
const lat0 = 38, lng0 = -84.5;
const T0 = 1_700_000_000_000;
const walk = (n, stepDeg, t0 = T0, dt = 5000, acc = 5) => Array.from({ length: n }, (_, i) => ({ lat: lat0 + i * stepDeg, lng: lng0, accuracy: acc, t: t0 + i * dt }));
const run = (fixes, odo = Od.newOdo()) => fixes.reduce((state, fix) => Od.stepOdo(state, fix), odo);
let o = run(walk(11, 0.001)); // 10 steps of ~111 m
assert.ok(Math.abs(o.miles - 10 * 0.0690) < 0.02, "10 x 111 m is about 0.69 mi: " + o.miles);
const wobble = Array.from({ length: 60 }, (_, i) => ({ lat: lat0 + (i % 2) * 0.00002, lng: lng0 + ((i >> 1) % 2) * 0.00002, accuracy: 5, t: T0 + i * 1000 }));
assert.equal(run(wobble).miles, 0, "standing still (2 m wobble) adds nothing");
assert.ok(run(walk(400, 0.00002, T0, 1000)).miles > 0.3, "a slow real drift still adds up (about 0.5 mi)");
assert.ok(Math.abs(run(walk(30, 0.00002)).miles - 0.04) < 0.01, "a 64 m drift counts");
assert.equal(run(walk(11, 0.001, T0, 5000, 80)).miles, 0, "fixes with poor accuracy are skipped");
// A glitch (a fix 100 km away one second later) is skipped, and the next good fix counts normally.
let g = run(walk(3, 0.001));
const before = g.miles;
g = Od.stepOdo(g, { lat: lat0 + 1, lng: lng0, accuracy: 5, t: T0 + 11000 });
assert.equal(g.miles, before, "a 100 km jump in a second is ignored");
g = Od.stepOdo(g, { lat: lat0 + 3 * 0.001, lng: lng0, accuracy: 5, t: T0 + 15000 });
assert.ok(g.miles > before, "the next fix near the old track counts");
// Five glitches in a row: the start point was wrong, so it moves.
let h = run(walk(1, 0));
for (let i = 1; i <= 5; i++) h = Od.stepOdo(h, { lat: lat0 + 2, lng: lng0 + i * 1e-5, accuracy: 5, t: T0 + i * 1000 });
assert.ok(Math.abs(h.last.lat - (lat0 + 2)) < 1e-9, "after 5 rejects the anchor moves");
const m0 = h.miles;
h = Od.stepOdo(h, { lat: lat0 + 2.001, lng: lng0, accuracy: 5, t: T0 + 20000 });
assert.ok(h.miles > m0, "and movement counts again");
assert.equal(Od.stepOdo(o, { lat: lat0, lng: lng0, accuracy: 5, t: T0 }).miles, o.miles, "a fix from the past is ignored");
assert.equal(Od.stepOdo(o, null), o); assert.equal(Od.stepOdo(o, { lat: NaN, lng: 1, t: 1 }), o);

// ── The reference distance: the driver's, unless the rider's differs by more than 5% ──
const ref = Mt.referenceMiles;
assert.equal(ref(10, 9.6), 10, "within 5%: the driver's");
assert.equal(ref(10, 9.5), 10, "exactly 5%: the driver's");
assert.equal(ref(10, 9.49), 9.49, "more than 5% lower: the rider's");
assert.equal(ref(10, 10.6), 10.6, "more than 5% higher: the rider's too");
assert.equal(ref(0.2, 0.15), 0.2, "near zero a 0.05 mi gap is within");
assert.equal(ref(0.3, 0.2), 0.2, "but 0.1 mi on 0.3 is not");
assert.equal(ref(7, null), 7, "no rider number: the driver's");
assert.equal(ref(null, 4), 4, "no driver number: the rider's");
assert.equal(ref(null, null), null);
assert.equal(ref(NaN, "x"), null, "junk is ignored");
assert.equal(ref(-3, 2), 2, "a negative distance is not a distance");
assert.equal(Mt.fmtMiles(3.449), "3.4 mi"); assert.equal(Mt.fmtMiles(null), "–");
assert.equal(Mt.fmtDuration(0), "<1 min"); assert.equal(Mt.fmtDuration(12 * 60000 + 5000), "12 min"); assert.equal(Mt.fmtDuration(65 * 60000), "1 h 05 min"); assert.equal(Mt.fmtDuration(-1), "–");
assert.equal(Mt.fmtClock(125000), "2:05"); assert.equal(Mt.fmtClock(NaN), "0:00");
const mv = Mt.meterView({ stage: "riding", times: { confirmedAt: 1000, arrivedAt: 301000, startedAt: 421000 }, pickupMiles: 1.234, tripMiles: 3.4, nowMs: 1021000 });
assert.deepEqual([mv.pickup.ms, mv.trip.ms, mv.waitMs, mv.trip.miles], [300000, 600000, 120000, 3.4], "pickup leg ends at arrival; the wait is arrival to start");
const mw = Mt.meterView({ stage: "arrived", times: { confirmedAt: 0, arrivedAt: 100000 }, pickupMiles: 2, nowMs: 160000 });
assert.deepEqual([mw.pickup.ms, mw.waitMs, mw.trip], [100000, 60000, null]);
assert.equal(Mt.meterView({ stage: "enroute", times: { confirmedAt: 1000 }, nowMs: 61000 }).pickup.ms, 60000, "on the way: the clock runs");

// ── A ride, its stage times, tips, and a pickup change ──
const trip = { pickup: { name: "12 Elm St", lat: 38.03, lng: -84.5 }, dropoff: { name: "Airport", lat: 38.04, lng: -84.61 } };
const t0 = now() - 3600;
const d = "ride-x1";
const req = pub(K.RIDE_REQUEST, { pickup: P.publicPlace({ ...trip.pickup, area: "Chevy Chase" }), dropoff: P.publicPlace({ ...trip.dropoff, area: "Lexington" }), status: "requested", time: "ASAP", fareSats: 8000, sealed: P.seal(rider.sk, rider.publicKey, trip) }, [["d", d]], rider, t0);
const inprog = pub(K.RIDE_REQUEST, { ...JSON.parse(req.content), status: "in_progress", driverPubkey: driver.publicKey }, [["d", d], ["p", driver.publicKey]], rider, t0 + 60);
pub(K.RIDE_ACCEPT, { requestId: inprog.id, sealed: P.seal(rider.sk, driver.publicKey, trip) }, [["e", req.id], ["e", inprog.id], ["p", driver.publicKey], ["d", "accept-" + d]], rider, t0 + 60);
const stage = (stage, extra, at) => pub(K.RIDE_STAGE, { stage, ...extra }, [["e", inprog.id], ["p", rider.publicKey], ["d", "stage-" + Rd.rideKey(inprog)]], driver, at);
let all = latestVersions(relay.query({ kinds: [K.RIDE_REQUEST] }));
let live = all.find((r) => r.id === inprog.id);
assert.equal(Rd.rideTimes(live).confirmedAt, (t0 + 60) * 1000, "confirmed when the rider accepted");
assert.equal(Rd.rideTimes(live).arrivedAt, null);
stage("arrived", { at: (t0 + 600) * 1000 }, t0 + 600);
live = latestVersions(relay.query({ kinds: [K.RIDE_REQUEST] })).find((r) => r.id === inprog.id); // new object => fresh memo
assert.equal(Rd.rideTimes(live).arrivedAt, (t0 + 600) * 1000);
// The "riding" marker replaces "arrived" on a relay, so it carries the arrival time.
const only = pub(K.RIDE_REQUEST, { ...JSON.parse(req.content), status: "in_progress", driverPubkey: driver.publicKey, n: 2 }, [["d", d], ["p", driver.publicKey]], rider, t0 + 61);
pub(K.RIDE_CONFIRM, { phase: "code", ok: true }, [["e", inprog.id], ["p", driver.publicKey], ["d", "confirm-" + Rd.rideKey(inprog) + "-code"]], rider, t0 + 880);
stage("riding", { at: (t0 + 900) * 1000, arrivedAt: (t0 + 600) * 1000 }, t0 + 900);
const times = Rd.rideTimes(only);
assert.deepEqual([times.arrivedAt, times.startedAt], [(t0 + 600) * 1000, (t0 + 900) * 1000]);
// A false claim (an "at" a day away from the event) is not believed.
const liar = pub(K.RIDE_REQUEST, { ...JSON.parse(req.content), status: "in_progress", driverPubkey: driver.publicKey, n: 3 }, [["d", d], ["p", driver.publicKey]], rider, t0 + 62);
stage("riding", { at: (t0 - 86400) * 1000, arrivedAt: (t0 - 86400) * 1000 }, t0 + 905);
assert.equal(Rd.rideTimes(liar).startedAt, (t0 + 900) * 1000, "the earliest believable time stays");
assert.equal(Rd.rideTimes(liar).arrivedAt, (t0 + 600) * 1000);

// Changing the pickup: nothing happens until the driver accepts; only the rider proposes, only the driver answers.
const newPlace = { name: "Rupp Arena", lat: 38.0453, lng: -84.4976 };
const propose = (who, changeId, place, at) => pub(K.RIDE_PICKUP_CHANGE, { changeId, sealedDriver: P.seal(who.sk, driver.publicKey, { pickup: place }), sealedSelf: P.seal(who.sk, who.publicKey, { pickup: place }) }, [["e", inprog.id], ["p", driver.publicKey], ["d", `pickup-${d}-${changeId}`]], who, at);
const reply = (who, changeId, accepted, at) => pub(K.RIDE_PICKUP_REPLY, { changeId, accepted }, [["e", inprog.id], ["p", rider.publicKey], ["d", `pickup-reply-${changeId}`]], who, at);
const view = () => latestVersions(relay.query({ kinds: [K.RIDE_REQUEST] })).find((r) => r.id === only.id || r.id === liar.id || r.id === inprog.id);
const rideNow = () => relay.query({ kinds: [K.RIDE_REQUEST] }).filter((r) => r.pubkey === rider.publicKey).sort((a, b) => b.created_at - a.created_at)[0];
const RU = { publicKey: rider.publicKey, sk: rider.sk }, DU = { publicKey: driver.publicKey, sk: driver.sk }, OU = { publicKey: other.publicKey, sk: other.sk };
assert.equal(Pk.pickupChange(rideNow()), null, "no change yet");
propose(rider, "1000", newPlace, t0 + 1000);
assert.equal(Pk.pickupChange(rideNow()).status, "pending");
assert.equal(P.exactTrip(rideNow(), RU).pickup.name, "12 Elm St", "pending: the first pickup stays (rider)");
assert.equal(P.exactTrip(rideNow(), DU).pickup.name, "12 Elm St", "pending: the first pickup stays (driver)");
assert.equal(P.readPickup(Pk.pickupChange(rideNow()).proposal, rideNow(), RU).name, "Rupp Arena", "the rider can read it");
assert.equal(P.readPickup(Pk.pickupChange(rideNow()).proposal, rideNow(), DU).name, "Rupp Arena", "the driver can read it");
assert.equal(P.readPickup(Pk.pickupChange(rideNow()).proposal, rideNow(), OU), null, "nobody else can");
// Someone else signing a "proposal" or an "accept" changes nothing.
propose(attacker, "1500", { name: "Evil St", lat: 1, lng: 1 }, t0 + 1100);
reply(attacker, "1000", true, t0 + 1100);
assert.equal(Pk.pickupChange(rideNow()).id, "1000", "an outsider's proposal is ignored");
assert.equal(Pk.pickupChange(rideNow()).status, "pending", "an outsider's accept is ignored");
assert.equal(P.exactTrip(rideNow(), RU).pickup.name, "12 Elm St");
reply(driver, "1000", true, t0 + 1200);
assert.equal(Pk.pickupChange(rideNow()).status, "accepted");
assert.equal(P.exactTrip(rideNow(), RU).pickup.name, "Rupp Arena", "accepted: the rider's trip has the new pickup");
assert.equal(P.exactTrip(rideNow(), DU).pickup.name, "Rupp Arena", "accepted: so has the driver's");
assert.equal(P.exactTrip(rideNow(), RU).dropoff.name, "Airport", "the dropoff is untouched");
// A second change that the driver declines leaves the accepted one in force.
propose(rider, "2000", { name: "Library", lat: 38.05, lng: -84.49 }, t0 + 1300);
assert.equal(Pk.pickupChange(rideNow()).status, "pending");
assert.equal(P.exactTrip(rideNow(), DU).pickup.name, "Rupp Arena", "a pending second change changes nothing");
reply(driver, "2000", false, t0 + 1400);
assert.equal(Pk.pickupChange(rideNow()).status, "declined");
assert.equal(P.exactTrip(rideNow(), DU).pickup.name, "Rupp Arena", "declined: the earlier accepted pickup stays");
propose(rider, "3000", { name: "Mall", lat: 38.0, lng: -84.53 }, t0 + 1500);
reply(driver, "3000", true, t0 + 1600);
assert.equal(P.exactTrip(rideNow(), RU).pickup.name, "Mall", "the newest accepted change wins");
assert.ok(Pk.PICKUP_CHANGE_NOTE.includes("miles or minutes already counted"), "both people are told charges stay");

// Tips: any time after the ride is completed, any number of them, only from the ride's rider.
const tip = (who, sats, at) => pub(K.RIDE_PAYMENT, { phase: "tip", amountSats: sats, level: "wallet" }, [["e", inprog.id], ["p", driver.publicKey], ["d", `pay-${Rd.rideKey(inprog)}-tip-${at}`]], who, at);
assert.deepEqual(Ev.tipsOf(rideNow()), [], "no tips on a ride that is not completed");
pub(K.RIDE_COMPLETE, { requestId: inprog.id }, [["e", inprog.id], ["p", rider.publicKey], ["d", "complete-" + d]], driver, t0 + 2000);
assert.deepEqual(Ev.tipsOf(rideNow()), []);
tip(rider, 1000, t0 + 3000);
tip(rider, 2500, t0 + 90000); // a day later is fine
tip(attacker, 99999, t0 + 3100); // not the rider
tip(rider, -5, t0 + 3200); tip(rider, 0, t0 + 3300); tip(rider, 1e12, t0 + 3400); // junk amounts
assert.deepEqual(Ev.tipsOf(rideNow()).map((t) => t.sats), [1000, 2500], "only the rider's real tips, oldest first");
assert.ok(Ev.paymentRecords(rideNow(), RU).some((r) => r.phase === "tip"), "payment records include tips");
const drives = Ea.completedDrives([rideNow()], driver.publicKey);
assert.equal(drives.length, 1);
assert.equal(drives[0].tipSats, 3500, "the drive carries its tips");
const nowMs = (t0 + 100000) * 1000;
const sum = Ea.summarizeEarnings(drives, nowMs);
assert.equal(sum.all.tips, 3500); assert.equal(sum.all.sats, 8000 + 3500, "fare plus tips");

console.log("trip extras ok");
