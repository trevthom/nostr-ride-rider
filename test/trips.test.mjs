// Ride stages, fares, active ride/drive derivation, offers, earnings.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const { rideStage, rideDriver } = await import(`${R}/lib/rides.js`);
const T = await import(`${R}/lib/trips.js`);
const F = await import(`${R}/lib/fare.js`);
const E = await import(`${R}/lib/earnings.js`);
const { latestVersions } = await import(`${R}/nostr/replaceable.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

let n = 0, t = 1_700_000_000;
const ev = (kind, pubkey, content, tags, at) => {
  const e = { id: "t" + ++n, pubkey, kind, created_at: at ?? ++t, tags: [...tags, ["t", "nostrride"]], content: JSON.stringify(content) };
  relay._store(e); return e;
};
const rider = "a".repeat(64), driver = "b".repeat(64), other = "c".repeat(64), attacker = "d".repeat(64);
const trip = { pickup: { name: "P", lat: 1, lng: 1 }, dropoff: { name: "D", lat: 2, lng: 2 } };
const now = () => Math.floor(Date.now() / 1000);

// ── Fare ──
assert.equal(F.fareAmount(0.5, 2), 2.45, "no minimum fare: base + per mile + per minute exactly"); // 1.50 + 0.55 + 0.40 (the app's default rates)
assert.equal(F.fareAmount(10, 20), 16.5); // 1.50 + 11 + 4
const q = F.quoteFare({ miles: 10, minutes: 20 }, 100000);
assert.equal(q.usd, 16.5); assert.equal(q.sats, 16500); assert.equal(q.live, true);
assert.equal(F.quoteFare({ miles: 10, minutes: 20 }, null).live, false, "fallback price flagged");

// ── Stages: only the assigned driver, only forward ──
const r1 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver, fareSats: 9000 }, [["d", "ride-1"]], now());
assert.equal(rideDriver(r1), driver);
assert.equal(rideStage(r1), "enroute", "default stage");
ev(K.RIDE_STAGE, attacker, { stage: "riding" }, [["e", r1.id]]);
ev(K.RIDE_STAGE, rider, { stage: "riding" }, [["e", r1.id]]);
assert.equal(rideStage(r1), "enroute", "only the assigned driver can set a stage");
ev(K.RIDE_STAGE, driver, { stage: "arrived" }, [["e", r1.id], ["d", "stage-1"]]);
assert.equal(rideStage(r1), "arrived");
ev(K.RIDE_STAGE, driver, { stage: "bogus" }, [["e", r1.id], ["d", "stage-2"]]);
assert.equal(rideStage(r1), "arrived", "unknown stage ignored");
const r1b = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "ride-1"]], now() + 1);
ev(K.RIDE_CONFIRM, rider, { phase: "code", ok: true }, [["e", r1b.id], ["d", "confirm-1-code"]]);
ev(K.RIDE_STAGE, driver, { stage: "riding" }, [["e", r1b.id], ["d", "stage-3"]]);
assert.equal(rideStage(r1b), "riding", "marker on any version of the ride counts");
ev(K.RIDE_STAGE, driver, { stage: "arrived" }, [["e", r1b.id], ["d", "stage-4"]]);
assert.equal(rideStage(r1b), "riding", "stages never move backward");

// ── Active ride / drive ──
const open = ev(K.RIDE_REQUEST, other, { ...trip, status: "requested", time: "ASAP" }, [["d", "ride-2"]], now());
const stale = ev(K.RIDE_REQUEST, other, { ...trip, status: "requested", time: "ASAP" }, [["d", "ride-3"]], now() - 7200);
const reqs = latestVersions(relay.query({ kinds: [K.RIDE_REQUEST] }));
assert.equal(T.activeRideFor(reqs, other).id, open.id, "open request is active; expired one is not");
assert.equal(T.activeRideFor(reqs, rider).id, r1b.id, "running ride is active for the rider");
assert.equal(T.activeDriveFor(reqs, driver), null, "a request that only NAMES a driver is not a drive: no offer, no accept");
const ph = ev(K.RIDE_REQUEST, "e".repeat(64), { ...trip, status: "in_progress", driverPubkey: driver }, [["d", "phantom"]], now());
ev(K.RIDE_OFFER, driver, { priceSats: 7000, etaMinutes: 3 }, [["e", r1.id], ["p", rider], ["d", "offer-" + r1.id]], now());
assert.equal(T.activeDriveFor(latestVersions(relay.query({ kinds: [K.RIDE_REQUEST] })), driver), null, "an offer alone is not enough: the rider must accept it");
ev(K.RIDE_ACCEPT, rider, { offerId: "o1", requestId: r1.id }, [["e", "o1"], ["e", r1.id], ["p", driver], ["d", "accept-r1"]], now());
const reqs2 = latestVersions(relay.query({ kinds: [K.RIDE_REQUEST] }));
assert.equal(T.activeDriveFor(reqs2, driver).id, r1b.id, "offer + the rider's accept: the assigned driver is on the ride");
assert.notEqual(T.activeDriveFor(reqs2, driver).id, ph.id, "the made-up ride never counts");
assert.equal(T.activeDriveFor(reqs, rider), null);
assert.equal(T.activeRideFor(reqs, attacker), null);
ev(K.RIDE_FINISH, other, {}, [["e", open.id]]); // other is the rider on this ride
assert.equal(T.activeRideFor(reqs, other), null, "a finished ride is no longer active");

// Reservations far in the future wait under "Upcoming" and don't take over home.
const later = ev(K.RIDE_REQUEST, attacker, { ...trip, status: "requested", time: new Date(Date.now() + 5 * 3600000).toISOString() }, [["d", "ride-sched"]], now());
const soonRide = ev(K.RIDE_REQUEST, attacker, { ...trip, status: "requested", time: new Date(Date.now() + 10 * 60000).toISOString() }, [["d", "ride-soon"]], now() + 1);
let all = latestVersions(relay.query({ kinds: [K.RIDE_REQUEST] }));
assert.equal(T.activeRideFor(all, attacker).id, soonRide.id, "a ride within 30 min is active");
assert.deepEqual(T.upcomingRidesFor(all, attacker).map((r) => r.id), [later.id], "a far-off ride is upcoming");
ev(K.RIDE_FINISH, attacker, {}, [["e", soonRide.id]]);
all = latestVersions(relay.query({ kinds: [K.RIDE_REQUEST] }));
assert.equal(T.activeRideFor(all, attacker), null, "a reservation alone leaves home idle");
assert.equal(T.isOpenRide(later), true);

// ── Offers: valid only, newest per driver, soonest ETA first ──
const q1 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "requested", time: "ASAP", fareSats: 8000 }, [["d", "ride-4"]], now());
ev(K.RIDE_OFFER, driver, { priceSats: 8000, etaMinutes: 9 }, [["e", q1.id], ["p", rider], ["d", "offer-" + q1.id]], now());
ev(K.RIDE_OFFER, driver, { priceSats: 8000, etaMinutes: 4 }, [["e", q1.id], ["p", rider], ["d", "offer-again"]], now() + 5);
ev(K.RIDE_OFFER, other, { priceSats: 8000, etaMinutes: 6 }, [["e", q1.id], ["p", rider], ["d", "offer-" + q1.id]], now());
ev(K.RIDE_OFFER, attacker, { priceSats: 0, etaMinutes: 1 }, [["e", q1.id], ["d", "x"]], now()); // a price of nothing is not an offer
ev(K.RIDE_OFFER, rider, { priceSats: 5, etaMinutes: 1 }, [["e", q1.id], ["d", "y"]], now()); // the rider's own
const offers = T.offersForRide(q1);
assert.deepEqual(offers.map((o) => [o.pubkey, JSON.parse(o.content).etaMinutes]), [[driver, 4], [other, 6]]);
assert.equal(T.offerFrom(q1, driver).pubkey, driver); assert.equal(T.offerFrom(q1, attacker), null);

// An offer older than its time to live is no longer shown; a pending offer needs an open ride.
const q2 = ev(K.RIDE_REQUEST, rider, { ...trip, status: "requested", time: "ASAP" }, [["d", "ride-5"]], now());
const gone = ev(K.RIDE_OFFER, driver, { priceSats: 100, etaMinutes: 3 }, [["e", q2.id], ["d", "offer-old"]], now() - 400);
assert.deepEqual(T.offersForRide(q2), [], "stale offer ignored");
assert.equal(T.offerFrom(q2, driver).id, gone.id, "but the chosen driver's old offer still gives the fare and plate");
assert.equal(T.pendingOfferFor(driver).request.id, q1.id, "newest live offer is pending");
ev(K.RIDE_FINISH, rider, {}, [["e", q1.id]]);
assert.equal(T.pendingOfferFor(driver), null, "no pending offer once the ride is finished");

// The accept the rider sent to a driver is found by that driver only.
const acc = ev(K.RIDE_ACCEPT, rider, { paidSats: 5 }, [["e", "x"], ["e", r1.id], ["p", driver], ["d", "accept-1"]], now() + 50);
assert.equal(T.acceptFor(r1b, driver).id, acc.id); assert.equal(T.acceptFor(r1b, other), null);

// ── Earnings ──
const day = 86400;
const base = Math.floor(new Date("2030-06-15T15:00:00").getTime() / 1000);
const mk = (d, fare, doneAt, offerFare) => {
  const req = ev(K.RIDE_REQUEST, rider, { ...trip, status: "in_progress", driverPubkey: driver, fareSats: fare }, [["d", d]], doneAt - 600);
  if (offerFare) ev(K.RIDE_OFFER, driver, { priceSats: offerFare, upfrontSats: 0, etaMinutes: 3 }, [["e", req.id], ["d", "offer-" + req.id]], doneAt - 900);
  ev(K.RIDE_COMPLETE, driver, {}, [["e", req.id]], doneAt);
  return req;
};
mk("e-today", 7000, base, 7200);          // offer price wins over the request's fare
mk("e-week", 5000, base - 3 * day);       // falls back to the request's fare
mk("e-old", 4000, base - 30 * day, 4000);
const drives = E.completedDrives(latestVersions(relay.query({ kinds: [K.RIDE_REQUEST] })), driver)
  .filter((d) => d.at > base - 40 * day && d.at <= base);
assert.deepEqual(drives.map((d) => d.fareSats), [7200, 5000, 4000], "newest first, offer price used");
const sum = E.summarizeEarnings(drives, base * 1000 + 3600_000);
assert.deepEqual(sum.today, { sats: 7200, trips: 1, tips: 0 });
assert.deepEqual(sum.week, { sats: 12200, trips: 2, tips: 0 });
assert.deepEqual(sum.all, { sats: 16200, trips: 3, tips: 0 });

console.log("trips checks passed");
process.exit(0);
