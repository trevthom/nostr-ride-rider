// Browsing drivers: a request sent to chosen drivers only, the driver's decline, "Female only" / "Male only", the nearest driver,
// and the warning when a driver's rates change before the rider accepts.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const T = await import(`${R}/lib/trips.js`);
const G = await import(`${R}/lib/gender.js`);
const A = await import(`${R}/lib/audience.js`);
const RC = await import(`${R}/lib/ratechange.js`);
const { SEALED_KINDS, recipientsOf } = await import(`${R}/nostr/sealing.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const pub = (kind, content, tags, who) => {
  const e = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk);
  relay._store(e);
  return e;
};
const rider = generateKeypair(), d1 = generateKeypair(), d2 = generateKeypair(), stranger = generateKeypair();

// ── A request the rider sent to chosen drivers carries `directed` ──
const place = { name: "P", lat: 1, lng: 1 };
const sent = pub(K.RIDE_REQUEST, { pickup: place, dropoff: { name: "D", lat: 2, lng: 2 }, status: "requested", time: "ASAP", directed: true }, [["d", "ride-b1"]], rider);
const open = pub(K.RIDE_REQUEST, { pickup: place, dropoff: { name: "D", lat: 2, lng: 2 }, status: "requested", time: "ASAP" }, [["d", "ride-b2"]], rider);
assert.equal(T.isDirected(sent), true);
assert.equal(T.isDirected(open), false, "a request for every driver is not directed");

// ── A driver says no: the rider's app can tell who ──
assert.equal(T.driverDeclines(sent).size, 0);
const ev = T.driverDeclineEvent(sent);
assert.equal(ev.kind, K.RIDE_DRIVER_DECLINE);
assert.ok(SEALED_KINDS.has(K.RIDE_DRIVER_DECLINE), "the decline travels in a gift wrap, like every job event");
assert.ok(recipientsOf({ pubkey: d1.publicKey, tags: ev.tags }).includes(rider.publicKey), "and it is addressed to the rider");
pub(ev.kind, ev.content, ev.tags, d1);
assert.deepEqual([...T.driverDeclines(sent)], [d1.publicKey], "driver 1 declined");
assert.equal(T.driverDeclines(sent).has(d2.publicKey), false, "driver 2 did not");
// It counts for the signer only; the rider cannot decline on a driver's behalf, and it reaches later versions of the request.
pub(ev.kind, ev.content, ev.tags, rider);
assert.equal(T.driverDeclines(sent).has(rider.publicKey), false, "the rider's own signature never counts as a driver's decline");
const later = pub(K.RIDE_REQUEST, { pickup: place, dropoff: { name: "D", lat: 2, lng: 2 }, status: "requested", time: "ASAP", directed: true, hide: [] }, [["d", "ride-b1"]], rider);
assert.deepEqual([...T.driverDeclines(later)], [d1.publicKey], "a newer version of the same request keeps the decline");

// ── Female only / Male only ──
const people = [
  { pubkey: d1.publicKey, gender: "female" },
  { pubkey: d2.publicKey, gender: "male" },
  { pubkey: stranger.publicKey }, // never declared
];
assert.deepEqual(G.onlyPreferred(people, "female").map((p) => p.pubkey), [d1.publicKey]);
assert.deepEqual(G.onlyPreferred(people, "male").map((p) => p.pubkey), [d2.publicKey]);
assert.equal(G.onlyPreferred(people, "").length, 3, "no preference: everyone");
assert.equal(G.matchesGender("female", ""), false, "a driver with no declared gender is not shown to a rider who asked");
// A driver's profile can say it when the presence does not (an older app).
pub(K.METADATA, { name: "Stranger", gender: "male" }, [], stranger);
assert.equal(G.genderOfDriver({ pubkey: stranger.publicKey }), "male");
assert.deepEqual(G.onlyPreferred(people, "male").map((p) => p.pubkey).sort(), [d2.publicKey, stranger.publicKey].sort());

// ── The nearest driver ──
const near = A.nearestDriver([{ pubkey: "a", lat: 10, lng: 10 }, { pubkey: "b", lat: 1.001, lng: 1.001 }, { pubkey: "c", lat: 5, lng: 5 }], place);
assert.equal(near.pubkey, "b");
assert.equal(A.nearestDriver([], place), null);
assert.equal(A.nearestDriver([{ pubkey: "a", lat: 1, lng: 1 }], null), null);

// ── The rider is told when a driver's rates change before the rider accepts ──
const before = { base: 1.5, perMile: 1.1, perMinute: 0.2 };
RC.rememberRates("ride-b1", d1.publicKey, before);
assert.equal(RC.ratesChanged(RC.seenRates("ride-b1", d1.publicKey), { ...before }), false, "the same rates: nothing to say");
assert.equal(RC.ratesChanged(RC.seenRates("ride-b1", d1.publicKey), { ...before, base: 2.5 }), true, "a higher base");
assert.equal(RC.ratesChanged(RC.seenRates("ride-b1", d1.publicKey), { ...before, perMinute: 0.1 }), true, "a lower rate is also shown");
assert.equal(RC.ratesChanged(RC.seenRates("ride-b1", d1.publicKey), { ...before, currency: "EUR" }), true, "another currency");
assert.equal(RC.ratesChanged(null, before), false, "nothing was seen before: no popup");
assert.equal(RC.seenRates("ride-b1", d2.publicKey), null, "rates are remembered per driver and per request");
assert.equal(RC.seenRates("ride-zz", d1.publicKey), null);
assert.equal(RC.rateDirection(before, { ...before, base: 2.5 }, 5, 15), "higher");
assert.equal(RC.rateDirection(before, { ...before, base: 1 }, 5, 15), "lower");
assert.equal(RC.rateDirection(before, { ...before, currency: "EUR" }, 5, 15), "different", "two currencies cannot be compared without a price");

console.log("browse tests ok");
process.exit(0);
