// Privacy: coarse public places, sealed exact trip (rider + accepted driver only), sealed plates.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const P = await import(`${R}/lib/privacy.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);
const rider = generateKeypair(), driver = generateKeypair(), stranger = generateKeypair();
const pub = (kind, content, tags, who) => { const e = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk); relay._store(e); return e; };

const pickup = { name: "12 Elm St", area: "Chevy Chase, Lexington", lat: 38.031234, lng: -84.498765 };
const dropoff = { name: "Airport", area: "Lexington", lat: 38.04, lng: -84.61 };
const pp = P.publicPlace(pickup);
assert.deepEqual(pp, { name: "Chevy Chase, Lexington", lat: 38.03, lng: -84.5, approx: true });
const req = pub(K.RIDE_REQUEST, { pickup: pp, dropoff: P.publicPlace(dropoff), status: "requested",
  sealed: P.seal(rider.sk, rider.publicKey, { pickup, dropoff }) }, [["d", "ride-9"]], rider);
assert.ok(!req.content.includes("Elm"), "exact address not in public content");

assert.equal(P.exactTrip(req, rider).pickup.name, "12 Elm St", "rider reads own exact trip");
assert.equal(P.exactTrip(req, driver), null, "driver can't read before accept");
const trip = P.exactTrip(req, rider);
pub(K.RIDE_ACCEPT, { offerId: "o", requestId: req.id, sealed: P.seal(rider.sk, driver.publicKey, trip) },
  [["e", "o"], ["e", req.id], ["p", driver.publicKey], ["d", "accept-" + req.id]], rider);
const inProg = pub(K.RIDE_REQUEST, { ...JSON.parse(req.content), status: "in_progress", driverPubkey: driver.publicKey }, [["d", "ride-9"], ["p", driver.publicKey]], rider);
assert.equal(P.exactTrip(inProg, driver).pickup.lat, 38.031234, "accepted driver reads exact trip");
assert.equal(P.exactTrip(inProg, stranger), null, "stranger can't");
// A fake accept from a stranger is ignored (wrong author).
pub(K.RIDE_ACCEPT, { sealed: P.seal(stranger.sk, driver.publicKey, { pickup: dropoff, dropoff }) }, [["e", req.id], ["p", driver.publicKey]], stranger);
assert.equal(P.exactTrip(inProg, driver).pickup.name, "12 Elm St");

// Plate: sealed in profile, opened by owner; sent sealed in offer.
const veh = P.sealVehicle({ make: "VW", model: "Golf", year: "2020", plateState: "KY", plateNumber: "ABC123" }, driver.sk, driver.publicKey);
assert.ok(!JSON.stringify(veh).includes("ABC123") && veh.make === "VW");
pub(K.METADATA, { name: "D", vehicle: veh }, [], driver);
assert.equal(P.myVehicle(driver.publicKey, driver.sk).plateNumber, "ABC123");
assert.equal(P.myVehicle(driver.publicKey, stranger.sk).plateNumber, "", "others can't open it");
const offer = pub(K.RIDE_OFFER, { priceSats: 10, plate: P.seal(driver.sk, rider.publicKey, { plateState: "KY", plateNumber: "ABC123" }) }, [["e", req.id]], driver);
assert.deepEqual(P.offerPlate(offer, rider), { plateState: "KY", plateNumber: "ABC123" });
assert.equal(P.offerPlate(offer, stranger), null);
console.log("privacy checks passed");
process.exit(0);
