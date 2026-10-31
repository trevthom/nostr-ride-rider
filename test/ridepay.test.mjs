// The signed trail of pay-as-you-ride: ticks, replies, waivers, signs of life, stops, and the frozen terms.
// Run with: npm test
import assert from "node:assert/strict";
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const Pay = await import(`${R}/lib/payments.js`);
const St = await import(`${R}/lib/stops.js`);
const Tm = await import(`${R}/lib/terms.js`);
const Mn = await import(`${R}/lib/mints.js`);
const Rd = await import(`${R}/lib/rides.js`);
const Tk = await import(`${R}/lib/ticks.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const sign = (who, e, at) => {
  const ev = buildSignedEvent(e.kind, e.content, [...e.tags, ["t", "nostrride"]], who.sk);
  if (at) ev.created_at = at;
  relay._store(ev);
  return ev;
};
const pub = (kind, content, tags, who, at) => sign(who, { kind, content, tags }, at);
const rider = generateKeypair(), driver = generateKeypair(), attacker = generateKeypair();
const MINT = "https://mint.test";
const NOW = Math.floor(Date.now() / 1000);

const req = pub(K.RIDE_REQUEST, { pickup: { name: "P", lat: 38, lng: -84.5 }, dropoff: { name: "D", lat: 38.1, lng: -84.5 }, status: "requested", time: "ASAP", fareSats: 9000, distanceMiles: 5, durationMin: 15 }, [["d", "ride-p1"]], rider);
const offer = pub(K.RIDE_OFFER, { priceSats: 11250, etaMinutes: 4, mode: "metered", rates: { base: 2, perMile: 1.1, perMinute: 0.25, currency: "USD" }, mint: MINT, tripMiles: 5, tripMinutes: 15 }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]], driver);
pub(K.RIDE_ACCEPT, { offerId: offer.id, requestId: req.id }, [["e", offer.id], ["e", req.id], ["p", driver.publicKey], ["d", "accept-" + req.id]], rider);
const live = pub(K.RIDE_REQUEST, { pickup: { name: "P", lat: 38, lng: -84.5 }, dropoff: { name: "D", lat: 38.1, lng: -84.5 }, status: "in_progress", driverPubkey: driver.publicKey, distanceMiles: 5, durationMin: 15 }, [["d", "ride-p1"], ["p", driver.publicKey]], rider, NOW + 1);

// ── Terms come from the offer the rider chose, and are frozen ──
let terms = Tm.rideTerms(live);
assert.equal(terms.mode, "metered");
assert.deepEqual([terms.base, terms.perMile, terms.perMinute, terms.currency], [2, 1.1, 0.25, "USD"]);
assert.equal(Tm.rideMint(live), MINT);
// The driver sends a new offer with higher rates in the middle of the ride: it changes nothing.
pub(K.RIDE_OFFER, { priceSats: 99999, mode: "metered", rates: { base: 9, perMile: 9, perMinute: 4, currency: "USD" }, mint: "https://other.mint", tripMiles: 5, tripMinutes: 15 }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]], driver, NOW + 50);
terms = Tm.rideTerms(live);
assert.equal(terms.base, 2, "the rates the rider agreed to are the rates of the ride");
assert.equal(Tm.rideMint(live), MINT, "and so is the mint");
assert.equal(Tm.agreedOffer(live).id, offer.id);
// An old offer from before flat prices were removed: it is read as the standard fare.
const req2 = pub(K.RIDE_REQUEST, { pickup: { name: "P", lat: 1, lng: 1 }, dropoff: { name: "D", lat: 2, lng: 2 }, status: "in_progress", driverPubkey: driver.publicKey, distanceMiles: 5, durationMin: 15 }, [["d", "ride-p2"], ["p", driver.publicKey]], rider);
const oldOffer = pub(K.RIDE_OFFER, { priceSats: 8000, mode: "flat", rates: { base: 2, perMile: 1.1, perMinute: 0.25, currency: "USD" }, mint: MINT, tripMiles: 5, tripMinutes: 15 }, [["e", req2.id], ["p", rider.publicKey], ["d", "offer-" + req2.id]], driver);
pub(K.RIDE_ACCEPT, { offerId: oldOffer.id, requestId: req2.id }, [["e", oldOffer.id], ["e", req2.id], ["p", driver.publicKey], ["d", "accept-" + req2.id]], rider);
const oldTerms = Tm.rideTerms(req2);
assert.equal(oldTerms.mode, "metered"); assert.equal(oldTerms.flatSats, undefined); assert.equal(oldTerms.base, 2);
// An offer without rates (old app) cannot be metered.
const req3 = pub(K.RIDE_REQUEST, { pickup: { name: "P", lat: 1, lng: 1 }, dropoff: { name: "D", lat: 2, lng: 2 }, status: "in_progress", driverPubkey: driver.publicKey }, [["d", "ride-p3"], ["p", driver.publicKey]], rider);
pub(K.RIDE_OFFER, { priceSats: 5000, etaMinutes: 3 }, [["e", req3.id], ["p", rider.publicKey], ["d", "offer-" + req3.id]], driver);
assert.equal(Tm.rideTerms(req3), null);

// ── Mints ──
assert.equal(Mn.cleanMintUrl(" https://mint.example.com/ "), "https://mint.example.com");
assert.equal(Mn.cleanMintUrl("https://mint.example.com/Bitcoin/"), "https://mint.example.com/Bitcoin");
assert.equal(Mn.cleanMintUrl("http://mint.example.com"), null, "plain http is refused");
assert.equal(Mn.cleanMintUrl("http://localhost:3338"), "http://localhost:3338", "except on this machine, for testing");
assert.equal(Mn.cleanMintUrl("https://user:pw@mint.example.com"), null);
assert.equal(Mn.cleanMintUrl("javascript:alert(1)"), null);
assert.equal(Mn.cleanMintUrl("https://m.example.com/?x=1"), null);
assert.ok(Mn.isMintUrl("https://mint.example.com") && !Mn.isMintUrl("https://mint.example.com/"));
assert.equal(Mn.mintLabel("https://mint.example.com/Bitcoin"), "mint.example.com");

// ── Ticks: only the rider's count; the token is sealed to the driver ──
const t1 = sign(rider, Pay.tickEvent(live, driver.publicKey, rider, { seq: 1, trigger: "base", amountSats: 2000, mint: MINT, token: "cashuBsecret-one" }));
const t2 = sign(rider, Pay.tickEvent(live, driver.publicKey, rider, { seq: 2, trigger: "min-1", amountSats: 250, mint: MINT, token: "cashuBsecret-two" }), NOW + 5);
sign(attacker, Pay.tickEvent(live, driver.publicKey, attacker, { seq: 3, trigger: "min-9", amountSats: 99999, mint: MINT, token: "x" }));
pub(K.RIDE_TICK, { seq: 4, amountSats: -5, sealed: "x" }, [["e", live.id], ["p", driver.publicKey], ["d", "tick-bad"]], rider);
pub(K.RIDE_TICK, { seq: 5, amountSats: 10.5, sealed: "x" }, [["e", live.id], ["p", driver.publicKey], ["d", "tick-bad2"]], rider);
const ticks = Pay.ticksOf(live);
assert.deepEqual(ticks.map((t) => t.amountSats), [2000, 250], "a stranger's tick, a negative and a fractional amount are ignored");
assert.ok(!JSON.stringify(t1).includes("secret-one"), "the token is not readable in the event");
assert.equal(Pay.tickToken(ticks[0], live, driver), "cashuBsecret-one", "the driver opens it");
assert.equal(Pay.tickToken(ticks[0], live, rider), null, "the rider does not open their own tick (only the driver needs it)");
assert.equal(Pay.tickToken(ticks[0], live, attacker), null, "nobody else can");
assert.equal(Pay.sentSats(live), 2250);
assert.equal(Pay.paidSats(live), 0, "nothing counts as paid until the driver confirms");

// ── Replies: only the assigned driver; a refusal does not undo a "received" ──
sign(driver, Pay.tickReplyEvent(live, t1, { ok: true, receivedSats: 2000 }));
sign(attacker, Pay.tickReplyEvent(live, t2, { ok: true, receivedSats: 250 }));
assert.equal(Pay.paidSats(live), 2000, "a stranger cannot confirm a payment");
sign(driver, Pay.tickReplyEvent(live, t2, { ok: false, reason: "The mint refused this token" }));
assert.equal(Pay.paidSats(live), 2000);
assert.equal(Pay.sentSats(live), 2250, "a refused tick still counts as sent until the rider's app has its token back (test/refusal.test.mjs)");
Pay.setTickVerdict(t2.id, "recovered");
assert.equal(Pay.sentSats(live), 2000, "once the rider's app took the token back from the mint, the tick was not paid: it is due again");
sign(driver, Pay.tickReplyEvent(live, t1, { ok: false, reason: "late nonsense" }), NOW + 90);
assert.equal(Pay.paidSats(live), 2000, "once received, a later refusal changes nothing");
assert.equal(Pay.tickReplies(live).get(t1.id).ok, true);
assert.equal(Pay.refusedTicks(live), 1, "the driver counts the payments its own app refused (t2); a received tick (t1) is never counted");

// ── Waivers: only the driver; unpaid money forgiven, and ecash sent back sealed to the rider ──
const w = sign(driver, Pay.waiverEvent(live, driver, { forgivenSats: 400, refundSats: 250, token: "cashuBrefund", reason: "Sorry about the detour" }));
sign(attacker, Pay.waiverEvent(live, attacker, { forgivenSats: 99999 }));
assert.equal(Pay.forgivenSats(live), 400, "a stranger cannot waive");
const waivers = Pay.waiversOf(live);
assert.equal(waivers.length, 1); assert.equal(waivers[0].refundSats, 250); assert.equal(waivers[0].reason, "Sorry about the detour");
assert.equal(Pay.waiverToken(waivers[0], live, rider), "cashuBrefund", "the rider opens the refund");
assert.equal(Pay.waiverToken(waivers[0], live, driver), null);
assert.equal(Pay.outstandingSats(live, 3000), 3000 - 2000 - 400, "owed minus confirmed minus forgiven");
assert.equal(Pay.outstandingSats(live, 100), 0, "never negative");

// ── Signs of life: from the two people only; a tap vouches for the other too ──
let sig = Pay.signalTimes(live);
assert.ok(sig.riderAt >= NOW * 1000 && sig.driverAt >= NOW * 1000);
const quietRide = pub(K.RIDE_REQUEST, { pickup: { name: "P", lat: 1, lng: 1 }, dropoff: { name: "D", lat: 2, lng: 2 }, status: "in_progress", driverPubkey: driver.publicKey }, [["d", "ride-quiet"], ["p", driver.publicKey]], rider);
assert.deepEqual(Pay.signalTimes(quietRide), { riderAt: null, driverAt: null }, "no signal yet");
pub(K.RIDE_STAGE, { stage: "riding" }, [["e", quietRide.id], ["d", "stage-q"]], driver, 5000);
assert.deepEqual(Pay.signalTimes(quietRide), { riderAt: null, driverAt: 5000000 });
sign(driver, Pay.aliveEvent(quietRide, rider.publicKey, "driver", "rider"), 6000);
sig = Pay.signalTimes(quietRide);
assert.equal(sig.riderAt, 6000000, "the driver tapping 'rider still with me' is a sign of life for the rider");
assert.equal(sig.driverAt, 6000000, "and for the driver");
sign(attacker, Pay.aliveEvent(quietRide, rider.publicKey, "driver", "rider"), 9999);
assert.equal(Pay.signalTimes(quietRide).riderAt, 6000000, "a stranger's sign of life is ignored");

// ── Stops: the rider asks, the driver answers; the fare keeps running at the same rates ──
const stopLive = req2;
assert.equal(St.hasAcceptedStop(stopLive), false);
const ask = sign(rider, St.stopRequestEvent(stopLive, rider, driver.publicKey, { mode: "stop", place: { name: "Pharmacy", lat: 1.5, lng: 1.5 } }));
let changes = St.stopChanges(stopLive);
assert.equal(changes.length, 1); assert.equal(changes[0].status, "pending");
assert.equal(St.readStop(changes[0], stopLive, driver).name, "Pharmacy", "the driver reads the new place");
assert.equal(St.readStop(changes[0], stopLive, rider).name, "Pharmacy", "so does the rider");
assert.equal(St.readStop(changes[0], stopLive, attacker), null, "nobody else");
assert.equal(Tm.rideTerms(stopLive).mode, "metered", "pending: nothing changes yet");
sign(attacker, St.stopReplyEvent(stopLive, changes[0].id, true));
assert.equal(St.stopChanges(stopLive)[0].status, "pending", "only the driver can accept");
const askByStranger = sign(attacker, St.stopRequestEvent(stopLive, attacker, driver.publicKey, { mode: "stop", place: { name: "Evil", lat: 3, lng: 3 } }));
assert.equal(St.stopChanges(stopLive).length, 1, "only the ride's rider can ask");
sign(driver, St.stopReplyEvent(stopLive, changes[0].id, true), NOW + 20);
assert.equal(St.stopChanges(stopLive)[0].status, "accepted");
assert.ok(St.hasAcceptedStop(stopLive));
assert.equal(Tm.rideTerms(stopLive).mode, "metered", "an accepted stop keeps the driver's normal fare");
assert.equal(Tm.rideTerms(stopLive).base, 2, "with the rates that were agreed");
let trip = St.stopTrip(stopLive, rider);
assert.deepEqual(trip.stops.map((s) => s.name), ["Pharmacy"]); assert.equal(trip.dropoff, null);
const dest = sign(rider, St.stopRequestEvent(stopLive, rider, driver.publicKey, { mode: "destination", place: { name: "Airport", lat: 5, lng: 5 } }), NOW + 30);
sign(driver, St.stopReplyEvent(stopLive, St.stopChanges(stopLive).find((c) => c.mode === "destination").id, false), NOW + 31);
assert.equal(St.stopTrip(stopLive, rider).dropoff, null, "a declined change changes nothing");
assert.equal(St.nextStop([{ name: "A" }, { name: "B" }], { name: "End" }, 0).name, "A");
assert.equal(St.nextStop([{ name: "A" }, { name: "B" }], { name: "End" }, 1).name, "B");
assert.equal(St.nextStop([{ name: "A" }], { name: "End" }, 1).name, "End", "all stops passed: the destination");
assert.equal(St.nextStop([], { name: "End" }, 0).name, "End");

// ── A ride finished by the driver after the rider stopped paying: the rider still owes the ticks ──
const owed = Tk.owedSats(Tk.advanceLedger(Tk.newLedger(0), { terms: Tm.rideTerms(live), nowMs: 125000, miles: 0.5, price: 100000 }));
assert.equal(owed, 2000 + 2 * 250);
assert.equal(Pay.outstandingSats(live, owed), owed - 2000 - 400, "what the rider can still pay later, after topping up the wallet");
console.log("ridepay tests ok");
