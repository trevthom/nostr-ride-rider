// A driver's "refused" answer must not make the rider pay a tick again unless the rider's own app got the money back.
// Before: sentSats left a refused tick out, so a driver could redeem the token, answer "refused", and have the rider pay again and again.
// Run with: npm test
import assert from "node:assert/strict";
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const R = new URL("../src", import.meta.url).pathname;
const Pay = await import(`${R}/lib/payments.js`);
const { payDue } = await import(`${R}/features/payments/rideTicks.js`);
const { redeemTicks } = await import(`${R}/features/payments/redeemTicks.js`);
const { recoverRefused } = await import(`${R}/features/payments/recoverRefused.js`);
const Tm = await import(`${R}/lib/terms.js`);
const { relay } = await import(`${R}/nostr/relay.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);
const { MINT, newNet, build, topUp } = await import("./helpers/fakemint.mjs");

const MIN = 60000, PRICE = 100000;
const T0 = Date.now() - 20 * MIN;
const sec = (ms) => Math.floor(ms / 1000);
const rider = generateKeypair(), driver = generateKeypair();
const signAs = (who, kind, content, tags, atMs) => {
  const ev = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk);
  if (atMs) ev.created_at = sec(atMs);
  relay._store(ev);
  return ev;
};
const publishAs = (who) => async (kind, content, tags) => { signAs(who, kind, content, tags); return true; };
function newRide(name) {
  const d = "ride-" + name;
  const trip = { pickup: { name: "P", lat: 38, lng: -84.5 }, dropoff: { name: "D", lat: 38.1, lng: -84.5 }, distanceMiles: 5, durationMin: 15 };
  const req = signAs(rider, K.RIDE_REQUEST, { ...trip, status: "requested", time: "ASAP" }, [["d", d]], T0 - 5 * MIN);
  const offer = signAs(driver, K.RIDE_OFFER, { priceSats: 11250, mode: "metered", rates: { base: 2, perMile: 1.1, perMinute: 0.25, currency: "USD" }, mint: MINT, tripMiles: 5, tripMinutes: 15 }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]], T0 - 4 * MIN);
  signAs(rider, K.RIDE_ACCEPT, { offerId: offer.id, requestId: req.id }, [["e", offer.id], ["e", req.id], ["p", driver.publicKey], ["d", "accept-" + req.id]], T0 - 3 * MIN);
  const live = signAs(rider, K.RIDE_REQUEST, { ...trip, status: "in_progress", driverPubkey: driver.publicKey }, [["d", d], ["p", driver.publicKey]], T0 - 2 * MIN);
  signAs(driver, K.RIDE_STAGE, { stage: "arrived", at: T0 - MIN }, [["e", live.id], ["p", rider.publicKey], ["d", "stage-" + d]], T0 - MIN);
  signAs(rider, K.RIDE_CONFIRM, { phase: "code", ok: true }, [["e", live.id], ["p", driver.publicKey], ["d", "confirm-" + d + "-code"]], T0 - 30000);
  signAs(driver, K.RIDE_STAGE, { stage: "riding", at: T0, arrivedAt: T0 - MIN }, [["e", live.id], ["p", rider.publicKey], ["d", "stage-" + d]], T0);
  return live;
}
const ctx = (request, wallet, nowMs, miles) => ({ request, user: rider, ecash: wallet, publish: publishAs(rider), terms: Tm.rideTerms(request), mint: Tm.rideMint(request), price: PRICE, nowMs, miles });
const settleBackground = () => new Promise((r) => setTimeout(r, 30)); // payDue starts the check at the mint in the background
const refuse = (ride, tick) => signAs(driver, K.RIDE_TICK_REPLY, { tickId: tick.id, ok: false, receivedSats: 0, reason: "bad token" }, [["e", ride.id], ["e", tick.id], ["p", rider.publicKey], ["d", "tick-reply-" + tick.id]]);

// ── 1. The driver redeems the token and still says "refused": the rider must NOT pay that tick again ──
{
  const net = newNet(), riderW = build(net), driverW = build(net);
  await topUp(riderW, net, 20000);
  const ride = newRide("a");
  await payDue(ctx(ride, riderW, T0 + 130000, 0.4));
  const tick = Pay.ticksOf(ride)[0];
  await driverW.redeem(Pay.tickToken(tick, ride, driver), { only: [MINT], ref: tick.id }); // the driver takes the money ...
  refuse(ride, tick); // ... and says no
  const before = riderW.balance(MINT);
  const r = await payDue(ctx(ride, riderW, T0 + 131000, 0.4));
  await settleBackground();
  assert.equal(r.status, "ok", "nothing is due again just because the driver said so");
  assert.equal(Pay.tickVerdict(tick.id), "spent", "the mint says the token is spent: the driver has the money");
  const again = await payDue(ctx(ride, riderW, T0 + 132000, 0.4));
  assert.equal(again.status, "ok", "still nothing due: a lying driver cannot make the rider pay twice, however often it refuses");
  assert.equal(riderW.balance(MINT), before, "the wallet is untouched");
  assert.equal(Pay.ticksOf(ride).length, 1, "no second tick was sent");
}

// ── 2. The driver refuses a token it never took (it is a griefer, or the token really was refused): the money comes back and is paid ONCE more ──
{
  const net = newNet(), riderW = build(net), driverW = build(net);
  await topUp(riderW, net, 20000);
  const ride = newRide("b");
  await payDue(ctx(ride, riderW, T0 + 130000, 0.4));
  const tick = Pay.ticksOf(ride)[0];
  const afterPay = riderW.balance(MINT);
  refuse(ride, tick);
  await payDue(ctx(ride, riderW, T0 + 131000, 0.4)); // starts the check
  await settleBackground();
  assert.equal(Pay.tickVerdict(tick.id), "recovered", "the token was unspent: the rider took it back");
  assert.ok(riderW.balance(MINT) >= afterPay + tick.amountSats - 2, "the money is in the wallet again");
  assert.equal(Pay.sentSats(ride), 0, "so the tick was not paid");
  const r = await payDue(ctx(ride, riderW, T0 + 132000, 0.4));
  assert.equal(r.status, "paid", "and it is paid again, once");
  const tick2 = Pay.ticksOf(ride).at(-1);
  await redeemTicks({ request: ride, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT });
  assert.equal(Pay.paidSats(ride), tick2.amountSats, "the driver, now honest, is paid");
  assert.equal((await payDue(ctx(ride, riderW, T0 + 133000, 0.4))).status, "ok", "and nothing more is due");
}

// ── 3. The mint cannot be reached: nothing is decided, nothing is paid again ──
{
  const net = newNet(), riderW = build(net);
  await topUp(riderW, net, 20000);
  const ride = newRide("c");
  await payDue(ctx(ride, riderW, T0 + 130000, 0.4));
  const tick = Pay.ticksOf(ride)[0];
  refuse(ride, tick);
  net[MINT].down = true;
  const r = await recoverRefused({ request: ride, user: rider, ecash: riderW, nowMs: Date.now() });
  assert.deepEqual(r, { recovered: 0, spent: 0, waiting: 1 });
  assert.equal(Pay.tickVerdict(tick.id), null);
  assert.equal(Pay.sentSats(ride), tick.amountSats, "until the mint answers the tick still counts as sent");
  net[MINT].down = false;
  const later = await recoverRefused({ request: ride, user: rider, ecash: riderW, nowMs: Date.now() + 60000 });
  assert.equal(later.recovered, 1, "tried again later: the token comes back");
}
// ── 4. A refund (waiver) is redeemed only at the mint the ride was agreed at ──
{
  const { redeemWaiversFor } = await import(`${R}/features/payments/redeemWaivers.js`);
  const OTHER = "https://other.test";
  const net = newNet();
  net[OTHER] = { n: 1, quotes: {}, spent: new Set(), paidInvoices: [], failMelt: false, down: false };
  const riderW = build(net), driverW = build(net);
  await topUp(driverW, net, 5000);
  await topUp(driverW, net, 5000, OTHER);
  const ride = newRide("d");
  const good = await driverW.pay(MINT, 300);
  const bad = await driverW.pay(OTHER, 300);
  const w1 = Pay.waiverEvent(ride, driver, { forgivenSats: 0, refundSats: 300, token: bad.token, reason: "sorry" });
  signAs(driver, w1.kind, w1.content, w1.tags);
  const got1 = await redeemWaiversFor({ user: rider, ecash: riderW, rideRequests: [ride] });
  assert.equal(got1.length, 0, "a refund from a mint the ride was not agreed at is not redeemed");
  assert.equal(riderW.balance(OTHER), 0, "so nothing appears at the driver's other mint");
  const w2 = Pay.waiverEvent(ride, driver, { forgivenSats: 0, refundSats: 300, token: good.token, reason: "sorry again" });
  signAs(driver, w2.kind, w2.content, w2.tags, Date.now() + 5000);
  const got2 = await redeemWaiversFor({ user: rider, ecash: riderW, rideRequests: [ride] });
  assert.equal(got2.length, 1, "a refund at the ride's mint is");
  assert.ok(riderW.balance(MINT) > 0);
}
console.log("refusal checks passed");
process.exit(0);
