// Price offers and counter-offers, driver gender ordering, driver profile gaps.
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

// ── Prices in sats and dollars ──
assert.equal(F.satsFromUsd(6.37, 100000), 6370, "$6.37 at $100k/BTC is exactly 6,370 sats");
assert.equal(F.usdFromSats(6370, 100000), 6.37, "and shows back as $6.37");
assert.equal(F.usdFromSats(F.satsFromUsd(12.34, 83000), 83000), 12.34, "round trip at another price");
assert.equal(F.satsFromUsd(5, 0), F.satsFromUsd(5, 100000), "no live price -> the fallback price");

// ── Each driver's own rates ──
assert.deepEqual(F.normalizeRates({ base: 2.5, perMile: 1.25, perMinute: 0.3 }), { base: 2.5, perMile: 1.25, perMinute: 0.3, currency: "USD" });
assert.deepEqual(F.normalizeRates({ base: "3", perMile: "1.5", perMinute: "0.2" }), { base: 3, perMile: 1.5, perMinute: 0.2, currency: "USD" }, "numeric strings are accepted");
assert.deepEqual(F.normalizeRates({ base: 1.239, perMile: 1, perMinute: 0 }), { base: 1.24, perMile: 1, perMinute: 0, currency: "USD" }, "cents at most");
for (const bad of [null, undefined, "x", {}, { base: 1, perMile: 1 }, { base: -1, perMile: 1, perMinute: 1 }, { base: 1, perMile: 999, perMinute: 1 }, { base: NaN, perMile: 1, perMinute: 1 }, { base: "", perMile: 1, perMinute: 1 }, { base: {}, perMile: 1, perMinute: 1 }]) {
  assert.equal(F.normalizeRates(bad), null, "rejected: " + JSON.stringify(bad));
}
// base + per mile * miles + per minute * minutes, exactly (there is no minimum fare)
assert.equal(F.typicalFare({ base: 3, perMile: 2, perMinute: 0.5 }, 10, 20), 33);
assert.equal(F.typicalFare({ base: 1, perMile: 0.5, perMinute: 0.1 }, 1, 2), 1.7, "no minimum fare");
assert.equal(F.typicalFare(null, 10, 20), F.fareAmount(10, 20), "no rates -> the app's rates");
assert.equal(F.typicalFare({ base: 1, perMile: 999, perMinute: 1 }, 10, 20), F.fareAmount(10, 20), "junk rates are ignored");
// Rates carry their currency (dollars when missing); the sanity limits scale with the currency.
assert.deepEqual(F.normalizeRates({ base: 300, perMile: 150, perMinute: 40, currency: "JPY" }), { base: 300, perMile: 150, perMinute: 40, currency: "JPY" });
assert.equal(F.normalizeRates({ base: 300, perMile: 150, perMinute: 40 }), null, "300 dollars as a base fare is a typo");
assert.equal(F.normalizeRates({ base: 1, perMile: 1, perMinute: 1, currency: "XXX" }), null, "unknown currency");
assert.equal(F.typicalSats({ base: 1, perMile: 1, perMinute: 1, currency: "EUR" }, 2, 3, { EUR: 50000 }), 12000, "$6 equivalent: 6 EUR at 50,000 = 12,000 sats");
assert.equal(F.typicalSats({ base: 1, perMile: 1, perMinute: 1, currency: "EUR" }, 2, 3, {}), null, "no price for that currency: not guessed");
assert.equal(F.typicalSats(null, 10, 20, {}), 16500, "the app's rates are in dollars: the fallback price applies when none is known");
assert.equal(F.median([7, 3, 5]), 5);
assert.equal(F.median([2, 4, 6, 10]), 5);
assert.equal(F.median([]), null);
assert.equal(F.median([NaN, 4]), 4);

assert.equal(F.offerLimitsSats, undefined, "the rider's own price (and the counter-offer) is gone");

// ── Several drivers offer to take the same ride ──
const req = pub(K.RIDE_REQUEST, { pickup: { name: "P", lat: 1, lng: 1 }, dropoff: { name: "D", lat: 2, lng: 2 }, status: "requested", time: "ASAP", fareSats: 8000, suggestedSats: 10000 }, [["d", "ride-n1"]], rider);
const offer = (who, priceSats, eta, gender) =>
  pub(K.RIDE_OFFER, { priceSats, etaMinutes: eta, gender }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]], who);
const o1 = offer(d1, 8000, 9, "male");
const o2 = offer(d2, 11000, 4, "female");
const o3 = offer(d3, 8000, 6, "");
const all = T.offersForRide(req);
assert.deepEqual(all.map((o) => o.pubkey), [d2.publicKey, d3.publicKey, d1.publicKey], "no preference: soonest first");

// ── Gender preference: "Female only" / "Male only" show only the drivers who declared that gender ──
assert.equal(T.offerGender(o2), "female");
assert.equal(T.offerGender(o3), "", "no gender set");
assert.deepEqual(T.onlyPreferredOffers(all, "male").map((o) => o.pubkey), [d1.publicKey], "Male only: just the drivers who declared male");
assert.deepEqual(T.onlyPreferredOffers(all, "female").map((o) => o.pubkey), [d2.publicKey], "Female only: a driver who declared nothing (d3) is not shown either");
assert.equal(T.onlyPreferredOffers(all, "").map((o) => o.id).join(), all.map((o) => o.id).join(), "no preference: unchanged");
assert.equal(T.onlyPreferredOffers(all, "other").map((o) => o.id).join(), all.map((o) => o.id).join(), "unknown value: unchanged");

// A driver's rates travel in their profile; junk is dropped.
pub(K.METADATA, { name: "D2", rates: { base: 4, perMile: 1.5, perMinute: 0.35 } }, [], d2);
assert.deepEqual(getProfile(d2.publicKey).rates, { base: 4, perMile: 1.5, perMinute: 0.35, currency: "USD" });
pub(K.METADATA, { name: "D2", rates: { base: 4, perMile: "<b>", perMinute: 0.35 } }, [], d2);
assert.equal(getProfile(d2.publicKey).rates, null, "junk rates ignored");
pub(K.METADATA, { name: "D2" }, [], d2);

// The gender falls back to the driver's profile; only "male" / "female" are accepted there.
pub(K.METADATA, { name: "D3", gender: "female" }, [], d3);
assert.equal(T.offerGender(o3), "female", "profile fallback");
pub(K.METADATA, { name: "D1", gender: "<script>" }, [], d1);
assert.equal(getProfile(d1.publicKey).gender, "", "junk gender ignored");

// ── What a driver still has to finish ──
const none = Prof.driveGaps({});
assert.deepEqual(none.map((g) => g.id), ["photo", "vehicle", "vehiclePhoto", "plate"]);
const partial = Prof.driveGaps({ picture: "p", lud16: "a@b.c", vehicle: { make: "Ford", plateNumber: "ABC", year: "", model: "" } });
assert.deepEqual(partial.map((g) => [g.id, g.missing]), [["vehicle", ["year", "model"]], ["vehiclePhoto", []], ["plate", ["state"]]]);
assert.equal(Prof.gapsText(partial), "Vehicle (year, model), Vehicle photo and License plate (state)");
assert.equal(Prof.gapsText([{ title: "Vehicle photo", missing: [] }]), "Vehicle photo");
const full = { picture: "p", lud16: "a@b.c", vehicle: { picture: "v", plateState: "KY", plateNumber: "ABC", year: "2020", make: "Ford", model: "Focus" } };
assert.equal(Prof.isDriveReady(full), true);
assert.equal(Prof.isDriveReady({ ...full, lud16: "" }), true, "a cash out location (Lightning address) is optional");
assert.equal(Prof.isDriveReady({ ...full, license: "" }), true, "a driver's license photo is not required");
assert.equal(Prof.isDriveReady({ ...full, vehicle: { ...full.vehicle, picture: "" } }), false, "the vehicle photo is required");
assert.equal(Prof.isDriveReady({ ...full, gender: "" }), true, "gender is optional");

console.log("negotiation ok");
