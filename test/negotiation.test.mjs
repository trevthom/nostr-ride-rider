// Price offers and counter-offers, driver gender ordering, driver profile gaps, license privacy.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const F = await import(`${R}/lib/fare.js`);
const T = await import(`${R}/lib/trips.js`);
const P = await import(`${R}/lib/privacy.js`);
const Prof = await import(`${R}/lib/profile.js`);
const { getProfile } = await import(`${R}/nostr/profiles.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const pub = (kind, content, tags, who) => {
  const e = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk);
  relay._store(e);
  return e;
};
const now = () => Math.floor(Date.now() / 1000);
const rider = generateKeypair(), d1 = generateKeypair(), d2 = generateKeypair(), d3 = generateKeypair();

// ── Offer limits and steps ──
assert.deepEqual(F.offerLimits(10), { min: 3, max: 30 });
assert.deepEqual(F.offerLimits(1), { min: 3, max: 3 }, "tiny trips still have a valid range");
assert.equal(F.stepOffer(10, 1, 10), 11);
assert.equal(F.stepOffer(10, -1, 10), 9);
assert.equal(F.stepOffer(3, -1, 10), 3, "never below the minimum");
assert.equal(F.stepOffer(30, 1, 10), 30, "never above 3x the suggestion");
assert.equal(F.clampOffer("abc", 12), 12, "not a number -> the suggestion");
assert.equal(F.clampOffer("500", 12), 36, "a typo cannot cost real money");
assert.equal(F.clampOffer("1", 12), 3);
assert.equal(F.offerLevel(8, 10), "low");
assert.equal(F.offerLevel(10, 10), "fair");
assert.equal(F.offerLevel(12, 10), "high");
assert.equal(F.replyKind(8000, 8000), "same");
assert.equal(F.replyKind(9000, 8000), "counter");
assert.equal(F.replyKind(7000, 8000), "lower");
assert.equal(F.replyKind(7000, undefined), "same", "old requests without an offer");

// ── A counter-offer is an ordinary offer at a higher price; the deposit follows its price ──
const req = pub(K.RIDE_REQUEST, { pickup: { name: "P", lat: 1, lng: 1 }, dropoff: { name: "D", lat: 2, lng: 2 }, status: "requested", time: "ASAP", fareSats: 8000, suggestedSats: 10000 }, [["d", "ride-n1"]], rider);
const offer = (who, priceSats, eta, gender) =>
  pub(K.RIDE_OFFER, { priceSats, upfrontSats: F.depositSats(priceSats, 20), etaMinutes: eta, gender }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]], who);
const o1 = offer(d1, 8000, 9, "male");
const o2 = offer(d2, 11000, 4, "female");
const o3 = offer(d3, 8000, 6, "");
assert.equal(JSON.parse(o2.content).upfrontSats, 2200, "deposit is 20% of the counter price");
const all = T.offersForRide(req);
assert.deepEqual(all.map((o) => o.pubkey), [d2.publicKey, d3.publicKey, d1.publicKey], "no preference: soonest first");

// ── Gender preference only orders the list ──
assert.equal(T.offerGender(o2), "female");
assert.equal(T.offerGender(o3), "", "no gender set");
assert.deepEqual(T.rankOffers(all, "male").map((o) => o.pubkey), [d1.publicKey, d2.publicKey, d3.publicKey], "male first, the rest keep their order");
assert.deepEqual(T.rankOffers(all, "female").map((o) => o.pubkey), [d2.publicKey, d3.publicKey, d1.publicKey]);
assert.equal(T.rankOffers(all, "female").length, all.length, "nobody is hidden");
assert.equal(T.rankOffers(all, "").map((o) => o.id).join(), all.map((o) => o.id).join(), "no preference: unchanged");
assert.equal(T.rankOffers(all, "other").map((o) => o.id).join(), all.map((o) => o.id).join(), "unknown value: unchanged");

// The gender falls back to the driver's profile; only "male" / "female" are accepted there.
pub(K.METADATA, { name: "D3", gender: "female" }, [], d3);
assert.equal(T.offerGender(o3), "female", "profile fallback");
pub(K.METADATA, { name: "D1", gender: "<script>" }, [], d1);
assert.equal(getProfile(d1.publicKey).gender, "", "junk gender ignored");

// ── A raised offer is a new version of the same request; earlier offers stay valid ──
const raised = pub(K.RIDE_REQUEST, { ...JSON.parse(req.content), fareSats: 9500 }, [["d", "ride-n1"]], rider);
assert.equal(T.offersForRide(raised).length, 3, "offers made at the old price still count");

// ── What a driver still has to finish ──
const none = Prof.driveGaps({});
assert.deepEqual(none.map((g) => g.id), ["photo", "vehicle", "vehiclePhoto", "plate", "license", "lightning"]);
const partial = Prof.driveGaps({ picture: "p", lud16: "a@b.c", vehicle: { make: "Ford", plateNumber: "ABC", year: "", model: "" } });
assert.deepEqual(partial.map((g) => [g.id, g.missing]), [["vehicle", ["year", "model"]], ["vehiclePhoto", []], ["plate", ["state"]], ["license", []]]);
assert.equal(Prof.gapsText(partial), "Vehicle (year, model), Vehicle photo, License plate (state) and Driver's license photo");
assert.equal(Prof.gapsText([{ title: "Vehicle photo", missing: [] }]), "Vehicle photo");
const full = { picture: "p", lud16: "a@b.c", license: "data:image/jpeg;base64,AA", vehicle: { picture: "v", plateState: "KY", plateNumber: "ABC", year: "2020", make: "Ford", model: "Focus" } };
assert.equal(Prof.isDriveReady(full), true);
assert.equal(Prof.isDriveReady({ ...full, license: "" }), false, "the license photo is required");
assert.equal(Prof.isDriveReady({ ...full, vehicle: { ...full.vehicle, picture: "" } }), false, "the vehicle photo is required");
assert.equal(Prof.isDriveReady({ ...full, gender: "" }), true, "gender is optional");

// ── License photo: ciphertext on the relay, readable only by its owner ──
const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
const lic = pub(K.DRIVER_LICENSE, P.sealLicense(photo, d1.sk, d1.publicKey), [["d", "license"]], d1);
assert.ok(!lic.content.includes("4AAQ"), "photo is not in clear");
assert.equal(P.myLicense(d1.publicKey, d1.sk), photo, "owner reads it");
assert.equal(P.myLicense(d1.publicKey, d2.sk), "", "another key cannot open it");
assert.equal(P.myLicense(d2.publicKey, d2.sk), "", "no record -> empty");
// Removing the photo replaces the record with an empty one.
pub(K.DRIVER_LICENSE, P.sealLicense("", d1.sk, d1.publicKey), [["d", "license"]], d1);
assert.equal(P.myLicense(d1.publicKey, d1.sk), "", "removed");
// Only image data URLs are accepted from the sealed record.
pub(K.DRIVER_LICENSE, { sealed: P.seal(d2.sk, d2.publicKey, { picture: "javascript:alert(1)" }) }, [["d", "license"]], d2);
assert.equal(P.myLicense(d2.publicKey, d2.sk), "", "non-image value rejected");

console.log("negotiation ok");
