// A fare is paid until it is covered, whatever the screen shows, and a paid tick is offered to the relays again until the driver
// answers. Both are about money that would otherwise stop moving: a dismissed receipt (or a phone that was short) left the rest
// of a fare unpaid, and one relay saying "OK" did not mean the driver's app could read the tick.
// Run with: npm test
import assert from "node:assert/strict";
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);
const Pay = await import(`${R}/lib/payments.js`);
const { ridesOwing, ledgerSummary } = await import(`${R}/lib/ridemoney.js`);
const { rideTerms } = await import(`${R}/lib/terms.js`);
const { rideStatus, rideKey } = await import(`${R}/lib/rides.js`);
const { resendUnansweredTicks, RESEND_AFTER_MS } = await import(`${R}/features/payments/rideTicks.js`);
const { MINT } = await import("./helpers/fakemint.mjs");

const MIN = 60000, HOUR = 3600000, PRICE = 100000; // 100,000 USD per BTC (the test's price)
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const rider = generateKeypair(), driver = generateKeypair();
const signAs = (who, kind, content, tags, atMs) => {
  const ev = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk);
  if (atMs) ev.created_at = Math.floor(atMs / 1000);
  relay._store(ev);
  return ev;
};

// A whole ride, started and finished, ending at `endMs`.
function newRide(name, { startMs = NOW - 7 * HOUR, endMs = NOW - 6 * HOUR, started = true } = {}) {
  const d = "ride-" + name;
  const trip = { pickup: { name: "P", lat: 38, lng: -84.5 }, dropoff: { name: "D", lat: 38.1, lng: -84.5 }, distanceMiles: 5, durationMin: 15 };
  const req = signAs(rider, K.RIDE_REQUEST, { ...trip, status: "requested", time: "ASAP" }, [["d", d]], startMs - 5 * MIN);
  const offer = signAs(driver, K.RIDE_OFFER, { priceSats: 11250, mode: "metered", rates: { base: 2, perMile: 1.1, perMinute: 0.25, currency: "USD" }, mint: MINT, tripMiles: 5, tripMinutes: 15 }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]], startMs - 4 * MIN);
  signAs(rider, K.RIDE_ACCEPT, { offerId: offer.id, requestId: req.id }, [["e", offer.id], ["e", req.id], ["p", driver.publicKey], ["d", "accept-" + req.id]], startMs - 3 * MIN);
  const live = signAs(rider, K.RIDE_REQUEST, { ...trip, status: "in_progress", driverPubkey: driver.publicKey }, [["d", d], ["p", driver.publicKey]], startMs - 2 * MIN);
  if (started) {
    signAs(rider, K.RIDE_CONFIRM, { phase: "code", ok: true }, [["e", live.id], ["p", driver.publicKey], ["d", "confirm-" + d + "-code"]], startMs - 30000);
    signAs(driver, K.RIDE_STAGE, { stage: "riding", at: startMs }, [["e", live.id], ["p", rider.publicKey], ["d", "stage-" + d]], startMs);
  }
  if (endMs != null) signAs(rider, K.RIDE_FINISH, { requestId: live.id, reason: "rider", role: "rider", at: endMs, miles: 5, minutes: (endMs - startMs) / MIN }, [["e", live.id], ["p", driver.publicKey], ["d", "finish-" + live.id]], endMs);
  return live;
}
const payFor = (code) => (code === "USD" ? PRICE : code === "EUR" ? PRICE / 1.1 : null);

// ── The ride under way, and every finished ride that still owes money ──
const old = newRide("old", { startMs: NOW - 7 * HOUR - 20 * MIN, endMs: NOW - 7 * HOUR });
const fresh = newRide("fresh", { startMs: NOW - 2 * HOUR, endMs: NOW - 1 * HOUR });
assert.equal(rideStatus(old), "completed");
const list = () => ridesOwing([old, fresh], rider.publicKey, { priceFor: payFor, nowMs: NOW });
const owing = list();
assert.equal(owing.length, 2, "a fare that ended seven hours ago is still owed (the receipt is long gone)");
assert.equal(owing[0].key, rideKey(old), "the oldest debt is paid first");
assert.ok(owing[0].outstanding > 0);
const sum = ledgerSummary(old, owing[0].ledger);
assert.equal(sum.outstanding, owing[0].outstanding);

// A ride that ended before it started owes nothing.
const never = newRide("never", { startMs: NOW - 2 * HOUR, endMs: null, started: false });
signAs(rider, K.RIDE_FINISH, { requestId: never.id, reason: "rider", role: "rider", at: NOW - HOUR }, [["e", never.id], ["p", driver.publicKey], ["d", "finish-" + never.id]], NOW - HOUR);
assert.equal(rideStatus(never), "closed");
assert.ok(!ridesOwing([never], rider.publicKey, { priceFor: payFor, nowMs: NOW }).length, "a ride that never started is not a debt");

// The driver's confirmed payment clears the ride from the queue, even though nothing on screen changed.
{
  const item = owing[0];
  const tick = Pay.tickEvent(item.request, driver.publicKey, rider, { seq: 1, trigger: "final", amountSats: item.outstanding, mint: MINT, token: "cashuBfake" });
  const ev = signAs(rider, tick.kind, tick.content, tick.tags, NOW - 6 * HOUR);
  const reply = Pay.tickReplyEvent(item.request, ev, { ok: true, receivedSats: item.outstanding });
  signAs(driver, reply.kind, reply.content, reply.tags, NOW - 6 * HOUR);
  assert.ok(!list().some((o) => o.key === item.key), "paid: it leaves the queue");
  assert.equal(list().length, 1);
}

// A price that is not known yet pays nothing (and the ride stays in the queue).
assert.ok(!ridesOwing([fresh], rider.publicKey, { priceFor: () => null, nowMs: NOW }).length, "no price: wait, never guess");

// ── A tick the driver never answered is sent again, and can never pay twice ──
{
  const ride = newRide("resend", { startMs: NOW - 2 * HOUR, endMs: null });
  const tick = Pay.tickEvent(ride, driver.publicKey, rider, { seq: 1, trigger: "base", amountSats: 500, mint: MINT, token: "cashuBx", at: NOW - 2 * RESEND_AFTER_MS });
  const ev = signAs(rider, tick.kind, tick.content, tick.tags, NOW - 2 * RESEND_AFTER_MS);
  const sent = [];
  const send = (e) => { sent.push(e); return Promise.resolve(false); };
  const opts = { online: true, send };
  assert.equal(resendUnansweredTicks(ride, { ...opts, nowMs: NOW }), 1, "no answer after a while: send the SAME event again");
  assert.equal(sent[0].id, ev.id, "the same signed event: the driver cannot be paid twice");
  assert.equal(resendUnansweredTicks(ride, { ...opts, nowMs: NOW }), 0, "not every few seconds");
  assert.equal(resendUnansweredTicks(ride, { ...opts, nowMs: NOW + 61000 }), 1, "a minute later, once more");
  const reply = Pay.tickReplyEvent(ride, ev, { ok: true, receivedSats: 500 });
  signAs(driver, reply.kind, reply.content, reply.tags, NOW - 60000);
  assert.equal(resendUnansweredTicks(ride, { ...opts, nowMs: NOW + 5 * MIN }), 0, "answered: stop sending it");
}
console.log("pay queue tests ok");
