// Trust rules: who may finish, complete, and rate a ride; versions keyed by author + d-tag.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const { rideStatus, rideEnding, tripCounts, rideVersions, rideStage, rideTimes } = await import(`${R}/lib/rides.js`);
const { getProfile, getMetadata } = await import(`${R}/nostr/profiles.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

let n = 0, t = 1000;
const ev = (kind, pubkey, content, tags, at) => {
  const e = { id: "id" + ++n, pubkey, kind, created_at: at ?? ++t, tags: [...tags, ["t", "nostrride"]], content: JSON.stringify(content) };
  relay._store(e); return e;
};
const rider = "a".repeat(64), driver = "b".repeat(64), attacker = "c".repeat(64);
const trip = { pickup: { name: "P", lat: 1, lng: 1 }, dropoff: { name: "D", lat: 2, lng: 2 } };

// Open request: an attacker's finish / complete must NOT count.
const r1 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "requested" }, [["d", "ride-1"]]);
ev(K.RIDE_FINISH, attacker, {}, [["e", r1.id]]);
ev(K.RIDE_COMPLETE, attacker, {}, [["e", r1.id]]);
assert.equal(rideStatus(r1), "requested", "attacker finish/complete ignored");

// Attacker reuses the victim's d-tag with a newer version → not a version of r1.
const fake = ev(K.RIDE_REQUEST, attacker, { ...trip, status: "completed", driverPubkey: attacker }, [["d", "ride-1"]]);
ev(K.RIDE_FINISH, attacker, {}, [["e", fake.id]]);
assert.equal(rideVersions(r1).length, 1, "versions keyed by author+d");
assert.equal(rideStatus(r1), "requested", "d-tag hijack ignored");

// Rider accepts driver → in_progress; driver completes → completed.
const r1b = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "ride-1"]]);
assert.equal(rideVersions(r1)[0].id, r1b.id, "newest version first");
assert.equal(rideStatus(r1b), "in_progress");
const done = ev(K.RIDE_COMPLETE, driver, {}, [["e", r1b.id]]);
assert.equal(rideStatus(r1b), "completed", "assigned driver can complete");
const ending = rideEnding(r1b);
assert.equal(ending.type, "completed"); assert.equal(ending.by, driver); assert.equal(ending.at, done.created_at);
assert.equal(ending.fin.atDestination, true, "the driver's completion means: finished at the destination");

// There are no cancellations: either person finishes the ride. Before the ride starts nothing is owed, so the
// ride is just "closed"; after it started it is "completed" (and the rider owes what it earned, lib/ticks.js).
const r2 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "requested" }, [["d", "ride-2"]]);
ev(K.RIDE_FINISH, rider, { reason: "rider" }, [["e", r2.id]]);
assert.equal(rideStatus(r2), "closed", "the rider finishing before a driver is chosen closes the request");
const r3 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "ride-3"]]);
ev(K.RIDE_FINISH, driver, { reason: "driver" }, [["e", r3.id]]);
assert.equal(rideStatus(r3), "closed", "the driver finishing before the ride started: nothing owed");
const r4 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "ride-4"]]);
ev(K.RIDE_CONFIRM, rider, { phase: "code", ok: true }, [["e", r4.id], ["d", "confirm-r4-code"]]);
ev(K.RIDE_STAGE, driver, { stage: "riding" }, [["e", r4.id]]);
const fin4 = ev(K.RIDE_FINISH, rider, { reason: "rider", role: "rider", at: 5000, miles: 1.2, minutes: 7 }, [["e", r4.id]]);
assert.equal(rideStatus(r4), "completed", "the rider finishing during the ride: it started, so it is completed");
assert.equal(rideEnding(r4).by, rider);
assert.deepEqual([rideEnding(r4).fin.miles, rideEnding(r4).fin.minutes, rideEnding(r4).fin.reason], [1.2, 7, "rider"]);
// Old data: a request marked "cancelled" reads as closed.
const old = ev(K.RIDE_REQUEST, rider, { ...trip, status: "cancelled" }, [["d", "ride-old"]]);
assert.equal(rideStatus(old), "closed");
// Both people finish at once: the earliest counts; within 10 s, the one that costs the rider less.
const r5 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "ride-5"]]);
ev(K.RIDE_CONFIRM, rider, { phase: "code", ok: true }, [["e", r5.id], ["d", "confirm-r5-code"]]);
ev(K.RIDE_STAGE, driver, { stage: "riding" }, [["e", r5.id]]);
const slow = ev(K.RIDE_FINISH, driver, { reason: "driver", role: "driver", miles: 3.0, minutes: 9 }, [["e", r5.id]], 1000);
const quick = ev(K.RIDE_FINISH, rider, { reason: "rider", role: "rider", miles: 2.8, minutes: 9 }, [["e", r5.id]], 1004);
assert.equal(rideEnding(r5).by, rider, "within 10 s the cheaper finish (fewer miles) wins");
const r6 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "ride-6"]]);
ev(K.RIDE_CONFIRM, rider, { phase: "code", ok: true }, [["e", r6.id], ["d", "confirm-r6-code"]]);
ev(K.RIDE_STAGE, driver, { stage: "riding" }, [["e", r6.id]]);
ev(K.RIDE_FINISH, driver, { reason: "driver", role: "driver", miles: 1, minutes: 2 }, [["e", r6.id]], 2000);
ev(K.RIDE_FINISH, rider, { reason: "rider", role: "rider", miles: 0.5, minutes: 1 }, [["e", r6.id]], 2060);
assert.equal(rideEnding(r6).by, driver, "more than 10 s apart: the earliest signed finish counts");

// The driver alone cannot start a ride: a "riding" marker counts only after the RIDER typed the start code.
const r7 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "ride-7"]]);
ev(K.RIDE_STAGE, driver, { stage: "arrived", at: 5000 }, [["e", r7.id], ["d", "stage-r7-a"]]);
ev(K.RIDE_STAGE, driver, { stage: "riding", at: 6000 }, [["e", r7.id], ["d", "stage-r7"]]);
assert.equal(rideStage(r7), "arrived", "a riding marker without the rider's start code is ignored");
assert.equal(rideTimes(r7).startedAt, null, "nothing starts the meter");
ev(K.RIDE_FINISH, rider, { reason: "rider", role: "rider" }, [["e", r7.id]]);
assert.equal(rideStatus(r7), "closed", "so the ride never started and nothing is owed");
const r8 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "ride-8"]]);
ev(K.RIDE_CONFIRM, attacker, { phase: "code", ok: true }, [["e", r8.id], ["d", "confirm-r8-code"]]);
ev(K.RIDE_STAGE, driver, { stage: "riding", at: 6000 }, [["e", r8.id], ["d", "stage-r8"]]);
assert.equal(rideStage(r8), "arrived", "only the rider's own confirmation counts");
ev(K.RIDE_CONFIRM, rider, { phase: "code", ok: true }, [["e", r8.id], ["d", "confirm-r8-code"]]);
assert.equal(rideStage(r8), "riding", "with the rider's code the marker counts");

// Star ratings are gone (too easy to fake): an old rating event left on a relay changes no number. Trips are plain counts.
ev(K.RATING, rider, { rating: 5 }, [["p", driver], ["e", r1b.id]]);
ev(K.RATING, driver, { rating: 1 }, [["p", rider], ["e", r1b.id]]);
const dr = tripCounts(driver), rr = tripCounts(rider);
assert.equal(dr.drives, 4, "r1b, r4, r5 and r6 started and ended: a ride finished after it started counts");
assert.equal(rr.rides, 4);
assert.deepEqual(Object.keys(dr).sort(), ["drives", "rides"], "no rating or review figures are kept");
assert.equal(tripCounts(attacker).drives, 0, "fake request does not count");

// Profiles: newest kind-0 wins; hostile field types are coerced.
ev(K.METADATA, driver, { name: "Old" }, []);
ev(K.METADATA, driver, { name: 42, communication: "x", vehicle: { plateState: { a: 1 }, make: "VW" }, lud16: "d@x.io" }, []);
const p = getProfile(driver);
assert.equal(p.name, "42"); assert.deepEqual(p.comm, []); assert.equal(p.vehicle.plateState, ""); assert.equal(p.vehicle.make, "VW");
assert.equal(getMetadata(driver).lud16, "d@x.io", "foreign fields kept for merge");
console.log("all checks passed");
process.exit(0);
