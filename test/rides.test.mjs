// Trust rules: who may cancel, complete, and rate a ride; versions keyed by author + d-tag.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const { rideStatus, rideEnding, reputation, rideVersions } = await import(`${R}/lib/rides.js`);
const { getProfile, getMetadata } = await import(`${R}/nostr/profiles.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

let n = 0, t = 1000;
const ev = (kind, pubkey, content, tags) => {
  const e = { id: "id" + ++n, pubkey, kind, created_at: ++t, tags: [...tags, ["t", "nostrride"]], content: JSON.stringify(content) };
  relay._store(e); return e;
};
const rider = "a".repeat(64), driver = "b".repeat(64), attacker = "c".repeat(64);
const trip = { pickup: { name: "P", lat: 1, lng: 1 }, dropoff: { name: "D", lat: 2, lng: 2 } };

// Open request: attacker cancel / complete must NOT count.
const r1 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "requested" }, [["d", "ride-1"]]);
ev(K.RIDE_CANCEL, attacker, {}, [["e", r1.id]]);
ev(K.RIDE_COMPLETE, attacker, {}, [["e", r1.id]]);
assert.equal(rideStatus(r1), "requested", "attacker cancel/complete ignored");

// Attacker reuses the victim's d-tag with a newer version → not a version of r1.
const fake = ev(K.RIDE_REQUEST, attacker, { ...trip, status: "completed", driverPubkey: attacker }, [["d", "ride-1"]]);
ev(K.RIDE_CANCEL, attacker, {}, [["e", fake.id]]);
assert.equal(rideVersions(r1).length, 1, "versions keyed by author+d");
assert.equal(rideStatus(r1), "requested", "d-tag hijack ignored");

// Rider accepts driver → in_progress; driver completes → completed.
const r1b = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "ride-1"]]);
assert.equal(rideVersions(r1)[0].id, r1b.id, "newest version first");
assert.equal(rideStatus(r1b), "in_progress");
const done = ev(K.RIDE_COMPLETE, driver, {}, [["e", r1b.id]]);
assert.equal(rideStatus(r1b), "completed", "assigned driver can complete");
assert.deepEqual(rideEnding(r1b), { type: "completed", by: driver, at: done.created_at });

// Rider can cancel their own ride; driver can cancel an assigned ride.
const r2 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "requested" }, [["d", "ride-2"]]);
ev(K.RIDE_CANCEL, rider, {}, [["e", r2.id]]);
assert.equal(rideStatus(r2), "cancelled", "rider cancel counts");
const r3 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "ride-3"]]);
ev(K.RIDE_CANCEL, driver, {}, [["e", r3.id]]);
assert.equal(rideStatus(r3), "cancelled", "assigned driver cancel counts");

// Ratings: only the counterparty counts; one per rater per ride (newest).
ev(K.RATING, attacker, { rating: 1 }, [["p", driver], ["e", r1b.id]]);
ev(K.RATING, rider, { rating: 3 }, [["p", driver], ["e", r1b.id]]);
ev(K.RATING, rider, { rating: 5 }, [["p", driver], ["e", r1.id], ["d", "rating-x"]]);
ev(K.RATING, driver, { rating: 4 }, [["p", rider], ["e", r1b.id]]);
ev(K.RATING, driver, { rating: 9 }, [["p", rider], ["e", r1b.id]]);
const dr = reputation(driver), rr = reputation(rider);
assert.equal(dr.drives, 1); assert.equal(dr.driverReviews.count, 1); assert.equal(dr.driverReviews.avg, 5);
assert.equal(rr.rides, 1); assert.equal(rr.riderReviews.count, 1); assert.equal(rr.riderReviews.avg, 4);
assert.equal(reputation(attacker).drives, 0, "fake request does not count");

// Profiles: newest kind-0 wins; hostile field types are coerced.
ev(K.METADATA, driver, { name: "Old" }, []);
ev(K.METADATA, driver, { name: 42, communication: "x", vehicle: { plateState: { a: 1 }, make: "VW" }, lud16: "d@x.io" }, []);
const p = getProfile(driver);
assert.equal(p.name, "42"); assert.deepEqual(p.comm, []); assert.equal(p.vehicle.plateState, ""); assert.equal(p.vehicle.make, "VW");
assert.equal(getMetadata(driver).lud16, "d@x.io", "foreign fields kept for merge");
console.log("all checks passed");
process.exit(0);
