// Requests left behind, blocking both ways, and "not this driver".
//   • a reservation nobody takes closes 2 hours after its pick-up time (an ASAP request: 1 hour after it was made)
//   • a block hides people from each other (hide tokens), without naming anyone
//   • the rider can turn down ONE driver's offer; the request stays open for everyone else
// Run with: npm test
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const Rides = await import(`${R}/lib/rides.js`);
const T = await import(`${R}/lib/trips.js`);
const B = await import(`${R}/lib/blocks.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const pub = (kind, content, tags, who) => {
  const e = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk);
  relay._store(e);
  return e;
};
const MIN = 60000;
const rider = generateKeypair(), d1 = generateKeypair(), d2 = generateKeypair(), stranger = generateKeypair();
const place = (n) => ({ name: n, lat: 38, lng: -84 });
const request = (time, d) => pub(K.RIDE_REQUEST, { pickup: place("P"), dropoff: place("D"), status: "requested", time, fareSats: 5000 }, [["d", d]], rider);

// ── A reservation is good until 2 hours AFTER its pick-up time ──
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
assert.equal(Rides.RESERVATION_TTL_MS, 2 * 60 * MIN);
const c = (t) => ({ time: t });
assert.equal(Rides.isRideExpired(c(iso(-90 * MIN)), 0), false, "pick-up was 90 minutes ago: still open");
assert.equal(Rides.isRideExpired(c(iso(-150 * MIN)), 0), true, "pick-up was 150 minutes ago: closed");
assert.equal(Rides.isRideExpired(c(iso(24 * 60 * MIN)), 0), false, "a reservation for tomorrow is open");
const t0 = Math.floor(Date.now() / 1000);
assert.equal(Rides.isRideExpired(c("ASAP"), t0 - 30 * 60), false, "an ASAP request waits an hour");
assert.equal(Rides.isRideExpired(c("ASAP"), t0 - 90 * 60), true);
// ...and it leaves the rider's screens by itself
const late = request(iso(-150 * MIN), "ride-late");
const soonish = request(iso(-90 * MIN), "ride-soonish");
assert.equal(T.isOpenRide(late), false, "an old unmatched reservation is not open any more");
assert.equal(T.isOpenRide(soonish), true);
assert.equal(T.upcomingRidesFor([late], rider.publicKey).length, 0, "and not listed under Upcoming");

// ── Blocking works both ways: hide tokens ──
// A token comes from the secret the blocker and the blocked person SHARE: the blocker makes it with their own key, the blocked
// person's app makes the same with theirs, and nobody else can.
const tok = B.hideToken(rider.sk, d1.publicKey);
assert.match(tok, /^[0-9a-f]{16}$/);
assert.equal(B.hideToken(rider.sk, d1.publicKey), tok, "stable");
assert.equal(B.hideToken(d1.sk, rider.publicKey), tok, "both sides work out the same token");
assert.notEqual(B.hideToken(rider.sk, d2.publicKey), tok, "one per person");
const list = B.hideList(rider.sk, [{ pubkey: d1.publicKey }]);
assert.deepEqual(list, [tok]);
assert.ok(!JSON.stringify(list).includes(d1.publicKey.slice(0, 16)), "the list does not name the person");
assert.equal(B.hidesMe(list, rider.publicKey, d1.sk), true, "the blocked driver's app hides the rider's request");
assert.equal(B.hidesMe(list, rider.publicKey, d2.sk), false, "other drivers still see it");
assert.equal(B.hidesMe(list, rider.publicKey, rider.sk), false);
// A stranger who knows both public keys cannot work the token out: the old token was a plain hash of the two keys.
assert.notEqual(B.hideToken(stranger.sk, d1.publicKey), tok, "a third person's guess is a different token");
assert.notEqual(bytesToHex(sha256(utf8ToBytes(`nostrride-hide:${rider.publicKey}:${d1.publicKey}`))).slice(0, 16), tok, "and so is the old public hash");
for (const junk of [undefined, null, "x", 5, {}, [null]]) assert.equal(B.hidesMe(junk, rider.publicKey, d1.sk), false, "junk hides nobody");
assert.deepEqual(B.hideList(rider.sk, [{ pubkey: "not-a-key" }]), [], "a bad key makes no token");
assert.equal(B.hideList(rider.sk, Array.from({ length: 150 }, () => ({ pubkey: generateKeypair().publicKey }))).length, 100, "capped at 100");
// a driver's blocked riders work the same way, from the driver's side
assert.equal(B.hidesMe(B.hideList(d1.sk, [{ pubkey: rider.publicKey }]), d1.publicKey, rider.sk), true, "a blocked rider does not see the driver's car");

// ── "Not this driver": the request stays open, the offer is gone ──
const req = request("ASAP", "ride-decline");
const offer = (who, price, eta) => pub(K.RIDE_OFFER, { priceSats: price, etaMinutes: eta }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]], who);
const o1 = offer(d1, 5000, 4), o2 = offer(d2, 5200, 6);
assert.deepEqual(T.offersForRide(req).map((o) => o.pubkey), [d1.publicKey, d2.publicKey]);
assert.equal(T.pendingOfferFor(d1.publicKey)?.offer.id, o1.id, "driver 1 is waiting on the rider");
const decline = T.declineEvent(req, o1);
assert.equal(decline.kind, K.RIDE_OFFER_DECLINE);
assert.ok(decline.tags.some((t) => t[0] === "p" && t[1] === d1.publicKey) && decline.tags.some((t) => t[0] === "e" && t[1] === req.id));
// a decline from somebody else counts for nothing
pub(decline.kind, decline.content, decline.tags, stranger);
assert.equal(T.declinedDrivers(req).has(d1.publicKey), false, "only the ride's rider can decline");
assert.equal(T.offersForRide(req).length, 2);
// the rider's decline
pub(decline.kind, decline.content, decline.tags, rider);
assert.deepEqual([...T.declinedDrivers(req)], [d1.publicKey]);
assert.deepEqual(T.offersForRide(req).map((o) => o.pubkey), [d2.publicKey], "driver 1's offer is off the list");
assert.equal(T.offerFrom(req, d1.publicKey), null, "and cannot be chosen");
assert.equal(T.pendingOfferFor(d1.publicKey), null, "driver 1 stops waiting");
assert.equal(T.pendingOfferFor(d2.publicKey)?.offer.id, o2.id, "driver 2 is still waiting");
// the driver cannot come back with a new offer
offer(d1, 4000, 2);
assert.deepEqual(T.offersForRide(req).map((o) => o.pubkey), [d2.publicKey], "a declined driver stays declined");
// the request itself is still open for any other driver
assert.equal(T.isOpenRide(req), true);
// a decline survives a raised price (a new version of the same request)
const raised = pub(K.RIDE_REQUEST, { pickup: place("P"), dropoff: place("D"), status: "requested", time: "ASAP", fareSats: 6000 }, [["d", "ride-decline"]], rider);
assert.equal(T.declinedDrivers(raised).has(d1.publicKey), true, "the decline holds for later versions");

console.log("requests tests ok");
process.exit(0);
