// The agreed terms stay the ones the rider chose, and the price a rider sees comes from the rates, not from the driver's word.
// Run with: npm test
import assert from "node:assert/strict";
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const Tm = await import(`${R}/lib/terms.js`);
const F = await import(`${R}/lib/fare.js`);
const Mm = await import(`${R}/features/ecash/myMint.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const rider = generateKeypair(), driver = generateKeypair();
let t = Math.floor(Date.now() / 1000) - 1000;
const sign = (who, kind, content, tags) => { const e = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk); e.created_at = t++; relay._store(e); return e; };
const trip = { pickup: { name: "P", lat: 38, lng: -84.5 }, dropoff: { name: "D", lat: 38.1, lng: -84.5 }, distanceMiles: 5, durationMin: 15 };
const cheap = { base: 2, perMile: 1.1, perMinute: 0.25, currency: "USD" };
const dear = { base: 50, perMile: 20, perMinute: 5, currency: "USD" };

const req = sign(rider, K.RIDE_REQUEST, { ...trip, status: "requested", time: "ASAP" }, [["d", "r"]]);
const offerA = sign(driver, K.RIDE_OFFER, { priceSats: 11250, mode: "metered", rates: cheap, mint: "https://mint.a.test" }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]]);
sign(rider, K.RIDE_ACCEPT, { offerId: offerA.id, requestId: req.id }, [["e", offerA.id], ["e", req.id], ["p", driver.publicKey], ["d", "accept-" + req.id]]);
const live = sign(rider, K.RIDE_REQUEST, { ...trip, status: "in_progress", driverPubkey: driver.publicKey }, [["d", "r"], ["p", driver.publicKey]]);
assert.equal(Tm.rideTerms(live).perMile, 1.1);
assert.equal(Tm.rideMint(live), "https://mint.a.test");

// The driver replaces the offer after the rider chose it: higher rates, another mint.
sign(driver, K.RIDE_OFFER, { priceSats: 11250, mode: "metered", rates: dear, mint: "https://mint.evil.test" }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]]);
assert.equal(Tm.rideTerms(live).perMile, 1.1, "the chosen offer's rates stay");
assert.equal(Tm.rideMint(live), "https://mint.a.test", "and its mint");

// The offer the accept names is not in hand (not synced after a reload, or replaced on the relays): nothing is agreed yet.
const lost = sign(rider, K.RIDE_REQUEST, { ...trip, status: "in_progress", driverPubkey: driver.publicKey }, [["d", "r2"], ["p", driver.publicKey]]);
sign(rider, K.RIDE_ACCEPT, { offerId: "f".repeat(64), requestId: lost.id }, [["e", "f".repeat(64)], ["e", lost.id], ["p", driver.publicKey], ["d", "accept-" + lost.id]]);
sign(driver, K.RIDE_OFFER, { priceSats: 1, mode: "metered", rates: dear, mint: "https://mint.evil.test" }, [["e", lost.id], ["p", rider.publicKey], ["d", "offer-" + lost.id]]);
assert.equal(Tm.agreedOffer(lost), null, "the driver's newest offer is NOT used instead");
assert.equal(Tm.rideTerms(lost), null);
assert.equal(Tm.rideMint(lost), null);

// An accept that names an offer made for ANOTHER ride does not count.
const other = sign(rider, K.RIDE_REQUEST, { ...trip, status: "requested", time: "ASAP" }, [["d", "r3"]]);
const otherOffer = sign(driver, K.RIDE_OFFER, { priceSats: 5, mode: "metered", rates: dear, mint: "https://mint.evil.test" }, [["e", other.id], ["p", rider.publicKey], ["d", "offer-" + other.id]]);
const mix = sign(rider, K.RIDE_REQUEST, { ...trip, status: "in_progress", driverPubkey: driver.publicKey }, [["d", "r4"], ["p", driver.publicKey]]);
sign(rider, K.RIDE_ACCEPT, { offerId: otherOffer.id, requestId: mix.id }, [["e", otherOffer.id], ["e", mix.id], ["p", driver.publicKey], ["d", "accept-" + mix.id]]);
assert.equal(Tm.agreedOffer(mix), null);

// ── The price shown comes from the rates ──
const prices = { USD: 100000 };
const honest = F.offerEstimate({ priceSats: 99999999, rates: cheap }, trip, prices);
assert.equal(honest, Math.round(((2 + 1.1 * 5 + 0.25 * 15) / 100000) * 1e8), "5 mi and 15 min at the driver's rates, whatever priceSats says");
assert.ok(F.offerEstimate({ priceSats: 1, rates: dear }, trip, prices) > 10 * honest, "a driver who writes a tiny priceSats next to dear rates still shows the dear price");
assert.equal(F.offerEstimate({ priceSats: 1000 }, trip, prices), null, "no rates: no estimate");
assert.equal(F.offerEstimate({ rates: cheap }, trip, {}), null, "no price: no estimate");
assert.equal(F.offerEstimate({ rates: cheap }, { pickup: trip.pickup }, prices), null, "no trip: no estimate");

// ── Mints the rider knows ──
const wallet = { balance: (u) => (u === "https://held.test" ? 10 : 0) };
assert.equal(Mm.isKnownMint("https://mint.evil.test", wallet), false, "a driver's mint nobody has used is not known");
assert.equal(Mm.isKnownMint("https://held.test", wallet), true, "one the rider already holds ecash at is");
Mm.trustMint("https://mint.evil.test");
assert.equal(Mm.isKnownMint("https://mint.evil.test", wallet), true, "or one the rider said yes to");
assert.equal(Mm.isKnownMint(null, wallet), false);
console.log("freeze checks passed");
process.exit(0);
