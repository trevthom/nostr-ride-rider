// A driver may add up to 3 vehicle photos; one is enough to drive. The main photo stays in `picture` (older apps read only that),
// the others are `morePictures`. The profile event must stay small enough for relays.
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const { getProfile } = await import(`${R}/nostr/profiles.js`);
const Prof = await import(`${R}/lib/profile.js`);
const P = await import(`${R}/lib/privacy.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const img = (n, size = 1000) => "data:image/jpeg;base64," + String(n).repeat(size);
const car = { year: "2020", make: "VW", model: "Golf", plateState: "KY", plateNumber: "ABC123" };
const user = (vehicle) => ({ picture: "face", vehicle: { ...car, ...vehicle } });

// vehiclePhotos: the main one first, at most 3, only real strings
assert.deepEqual(Prof.vehiclePhotos({ picture: "a", morePictures: ["b", "c", "d"] }), ["a", "b", "c"]);
assert.deepEqual(Prof.vehiclePhotos({ picture: "", morePictures: ["b"] }), ["b"], "no main photo: the next one leads");
assert.deepEqual(Prof.vehiclePhotos({ picture: "a", morePictures: "x" }), ["a"]);
assert.deepEqual(Prof.vehiclePhotos({ picture: "a", morePictures: [1, null, "b"] }), ["a", "b"]);
assert.deepEqual(Prof.vehiclePhotos(null), []);
assert.equal(Prof.MAX_VEHICLE_PHOTOS, 3);

// One photo is enough to drive; none is a gap; extra photos are not needed.
assert.equal(Prof.isDriveReady(user({ picture: "p" })), true, "one photo is enough");
assert.equal(Prof.isDriveReady(user({ picture: "p", morePictures: ["q", "r"] })), true);
assert.equal(Prof.isDriveReady(user({ picture: "" })), false);
assert.deepEqual(Prof.driveGaps(user({ picture: "" })).map((g) => g.id), ["vehiclePhoto"]);
assert.equal(Prof.isDriveReady(user({ picture: "", morePictures: ["q"] })), false, "the main photo is what is required (the form always moves the first photo there)");

// A profile from a relay: old profile (one photo) and new profile (three), hostile values dropped.
const driver = generateKeypair(), old = generateKeypair(), hostile = generateKeypair();
const pub = (kind, content, who) => { const e = buildSignedEvent(kind, content, [["t", "nostrride"]], who.sk); relay._store(e); return e; };
pub(K.METADATA, { name: "Old", vehicle: P.sealVehicle({ ...car, picture: img(1) }, old.sk, old.publicKey) }, old);
assert.deepEqual(getProfile(old.publicKey).vehicle.morePictures, [], "an older profile has no extra photos");
assert.deepEqual(Prof.vehiclePhotos(getProfile(old.publicKey).vehicle), [img(1)]);

const three = { ...car, picture: img(1), morePictures: [img(2), img(3)] };
pub(K.METADATA, { name: "New", vehicle: P.sealVehicle(three, driver.sk, driver.publicKey) }, driver);
const mine = P.myVehicle(driver.publicKey, driver.sk);
assert.deepEqual(Prof.vehiclePhotos(mine), [img(1), img(2), img(3)], "all three come back");
assert.equal(mine.plateNumber, "ABC123", "the plate is still sealed and opens for its owner");
assert.ok(!JSON.stringify(P.sealVehicle(three, driver.sk, driver.publicKey)).includes("ABC123"), "and it is not in the clear");

pub(K.METADATA, { name: "Bad", vehicle: { make: "X", picture: "p", morePictures: ["https://tracker.example/a.png", "javascript:alert(1)", img(4, 50000), img(5), img(6), img(7)] } }, hostile);
assert.deepEqual(getProfile(hostile.publicKey).vehicle.morePictures, [img(5), img(6)], "only small embedded images, at most 2 more");
pub(K.METADATA, { name: "Bad2", vehicle: { morePictures: { a: 1 } } }, hostile);
assert.deepEqual(getProfile(hostile.publicKey).vehicle.morePictures, []);

// The profile event stays under 64 KB (many relays refuse more): face photo 20 KB + three vehicle photos of at most 12 KB.
const face = "data:image/jpeg;base64," + "f".repeat(20000 - 23);
const big = (n) => "data:image/jpeg;base64," + String(n).repeat(12000 - 23);
const ev = buildSignedEvent(K.METADATA, { name: "N", about: "NostrRide user", picture: face, vehicle: P.sealVehicle({ ...car, picture: big(1), morePictures: [big(2), big(3)] }, driver.sk, driver.publicKey) }, [["t", "nostrride"]], driver.sk);
assert.ok(JSON.stringify(ev).length < 60000, "the profile event fits: " + JSON.stringify(ev).length);
console.log("vehicle photos ok");
process.exit(0);
