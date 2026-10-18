// The money of one ride, end to end with a fake mint: the rider's app pays ticks, the driver's app redeems
// them, a short wallet stays due and is caught up after a top-up, finishing settles the rest, and a
// waiver sends money back.
// Run with: npm test
import assert from "node:assert/strict";
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const Pay = await import(`${R}/lib/payments.js`);
const Rm = await import(`${R}/lib/ridemoney.js`);
const Tm = await import(`${R}/lib/terms.js`);
const Tk = await import(`${R}/lib/ticks.js`);
const { payDue } = await import(`${R}/features/payments/rideTicks.js`);
const { redeemTicks } = await import(`${R}/features/payments/redeemTicks.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);
const { MINT, newNet, build, topUp } = await import("./helpers/fakemint.mjs");

const MIN = 60000, PRICE = 100000;
const T0 = Date.now() - 20 * MIN; // the ride started 20 minutes ago (all times are relative to it)
const sec = (ms) => Math.floor(ms / 1000);
const rider = generateKeypair(), driver = generateKeypair();
const signAs = (who, kind, content, tags, atMs) => {
  const ev = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk);
  if (atMs) ev.created_at = sec(atMs);
  relay._store(ev);
  return ev;
};
const publishAs = (who) => async (kind, content, tags) => { signAs(who, kind, content, tags); return true; };

function newRide(name, mode, extra = {}) {
  const d = "ride-" + name;
  const trip = { pickup: { name: "P", lat: 38, lng: -84.5 }, dropoff: { name: "D", lat: 38.1, lng: -84.5 }, distanceMiles: 5, durationMin: 15 };
  const req = signAs(rider, K.RIDE_REQUEST, { ...trip, status: "requested", time: "ASAP" }, [["d", d]], T0 - 5 * MIN);
  const offer = signAs(driver, K.RIDE_OFFER, { priceSats: mode === "flat" ? 8000 : 11250, mode, // "flat": an old offer from before flat prices were removed
    rates: { base: 2, perMile: 1.1, perMinute: 0.25, currency: "USD" }, mint: MINT, tripMiles: 5, tripMinutes: 15 }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]], T0 - 4 * MIN);
  signAs(rider, K.RIDE_ACCEPT, { offerId: offer.id, requestId: req.id }, [["e", offer.id], ["e", req.id], ["p", driver.publicKey], ["d", "accept-" + req.id]], T0 - 3 * MIN);
  const live = signAs(rider, K.RIDE_REQUEST, { ...trip, status: "in_progress", driverPubkey: driver.publicKey }, [["d", d], ["p", driver.publicKey]], T0 - 2 * MIN);
  signAs(driver, K.RIDE_STAGE, { stage: "arrived", at: T0 - MIN }, [["e", live.id], ["p", rider.publicKey], ["d", "stage-" + d]], T0 - MIN);
  signAs(rider, K.RIDE_CONFIRM, { phase: "code", ok: true }, [["e", live.id], ["p", driver.publicKey], ["d", "confirm-" + d + "-code"]], T0 - 30000);
  signAs(driver, K.RIDE_STAGE, { stage: "riding", at: T0, arrivedAt: T0 - MIN }, [["e", live.id], ["p", rider.publicKey], ["d", "stage-" + d]], T0);
  return live;
}
const ctx = (request, wallet, who, nowMs, miles) => ({ request, user: who, ecash: wallet, publish: publishAs(who), terms: Tm.rideTerms(request), mint: Tm.rideMint(request), price: PRICE, nowMs, miles });

// ── 1. A normal ride: base + 2 minutes are due 130 s after the start; the rider pays one tick ──
const net = newNet();
const riderW = build(net), driverW = build(net);
await topUp(riderW, net, 10000);
const ride = newRide("a", "metered");
assert.equal(Tm.rideTerms(ride).mode, "metered");
let r = await payDue(ctx(ride, riderW, rider, T0 + 130000, 0.4));
assert.equal(r.status, "paid", "the first call pays what is due");
assert.equal(r.sentNow, 2000 + 2 * 250, "base + minute 1 + minute 2");
assert.equal(Pay.sentSats(ride), 2500);
assert.equal(riderW.balance(MINT), 10000 - 2501, "2,500 sats and the mint's 1 sat fee left the wallet");
assert.equal(riderW.pendingList().length, 0, "the token was handed to the event, nothing is left pending");
r = await payDue(ctx(ride, riderW, rider, T0 + 131000, 0.4));
assert.equal(r.status, "ok", "nothing new is due a second later: no double payment");
assert.equal(Pay.ticksOf(ride).length, 1);
// The driver redeems it and answers.
const got = await redeemTicks({ request: ride, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT });
assert.equal(got.received, 2500, "the driver received the whole tick: the sender's fee paid the mint's input fee");
assert.equal(driverW.balance(MINT), 2500);
assert.equal(Pay.paidSats(ride), 2500, "the driver's confirmation counts as paid");
const again = await redeemTicks({ request: ride, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT });
assert.deepEqual(again, { received: 0, refused: 0, waiting: 0 }, "an answered tick is not redeemed again");
assert.equal(driverW.balance(MINT), 2500);

// ── 2. A mile passes: only the mile is due ──
r = await payDue(ctx(ride, riderW, rider, T0 + 150000, 1.2));
assert.equal(r.sentNow, 1100, "mile 1");
assert.deepEqual(Pay.ticksOf(ride).map((t) => t.trigger), ["min-2", "mile-1"]);

// ── 3. The mint is down for the driver: the tick waits, no refusal is sent ──
net[MINT].down = true;
await payDue(ctx(ride, riderW, rider, T0 + 4 * MIN, 1.2));
const waiting = await redeemTicks({ request: ride, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT, nowMs: Date.now() });
assert.ok(waiting.waiting >= 1 && waiting.refused === 0, "an unreachable mint is never reported as a refusal");
assert.equal(Pay.tickReplies(ride).size, 1, "only the first tick was answered; the waiting ones have no reply yet");
net[MINT].down = false;
const later = await redeemTicks({ request: ride, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT, nowMs: Date.now() + 60000 });
assert.ok(later.received > 0, "once the mint is back the tick is redeemed");

// ── 4. The same token inside a SECOND tick is a replay: refused, and it pays nothing ──
const first = Pay.ticksOf(ride)[0];
const token = Pay.tickToken(first, ride, driver);
const evil = Pay.tickEvent(ride, driver.publicKey, rider, { seq: 99, trigger: "min-3", amountSats: 250, mint: MINT, token });
const evilEv = signAs(rider, evil.kind, evil.content, evil.tags);
await redeemTicks({ request: ride, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT });
const verdict = Pay.tickReplies(ride).get(evilEv.id);
assert.equal(verdict.ok, false, "a replayed token is refused");
assert.match(verdict.reason, /already used for another payment/);
assert.equal(Pay.paidSats(ride), Pay.ticksOf(ride).filter((t) => t.id !== evilEv.id).reduce((s, t) => s + (Pay.tickReplies(ride).get(t.id)?.ok ? t.amountSats : 0), 0), "and it adds nothing to what is paid");
assert.equal(Pay.sentSats(ride), Pay.ticksOf(ride).reduce((s, t) => s + t.amountSats, 0), "a refused tick still counts as sent: the driver's word is not enough to make the rider pay it again (test/refusal.test.mjs)");

// ── 5. A short wallet: partial payment now, the rest caught up after a top-up ──
const poor = build(net);
await topUp(poor, net, 600);
const ride2 = newRide("b", "metered");
let p = await payDue(ctx(ride2, poor, rider, T0 + 3 * MIN, 0));
assert.equal(p.status, "short", "base + 3 minutes = 2,750 are due; the wallet holds 600");
assert.ok(p.sentNow > 0 && p.sentNow < 600, "part of it was paid so the driver is covered as far as possible: " + p.sentNow);
const left = poor.balance(MINT);
assert.ok(left <= 10, "and the wallet is nearly empty (a few sats stay back for the mint fee): " + left);
const ledger2 = Rm.currentLedger(ride2, { terms: Tm.rideTerms(ride2), price: PRICE, nowMs: T0 + 3 * MIN, miles: 0 });
assert.equal(Tk.missedTicks(ledger2, Pay.paidSats(ride2), T0 + 3 * MIN + 60000), 4, "the driver's app counts base and minutes 1-3 as missed (nothing was confirmed; minute 4 is not due long enough)");
await redeemTicks({ request: ride2, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT });
const missedNow = Tk.missedTicks(ledger2, Pay.paidSats(ride2), T0 + 3 * MIN + 60000);
assert.ok(missedNow >= Tk.MISSED_LIMIT, "two missed payments or more: the driver may finish the ride (" + missedNow + ")");
assert.equal(await payDue(ctx(ride2, poor, rider, T0 + 3 * MIN + 1000, 0)).then((x) => x.status), "short", "still short: still due");
await topUp(poor, net, 5000);
p = await payDue(ctx(ride2, poor, rider, T0 + 3 * MIN + 2000, 0));
assert.equal(p.status, "paid", "refilled: everything missed is paid in one go");
assert.equal(Pay.sentSats(ride2), Tk.owedSats(Rm.currentLedger(ride2, { terms: Tm.rideTerms(ride2), price: PRICE, nowMs: T0 + 3 * MIN + 2000, miles: 0 })), "paid up exactly: the missed ticks are included");
await redeemTicks({ request: ride2, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT });
assert.equal(Rm.ledgerSummary(ride2, Rm.currentLedger(ride2, { terms: Tm.rideTerms(ride2), price: PRICE, nowMs: T0 + 3 * MIN + 3000, miles: 0 })).outstanding <= 2, true, "nothing outstanding");

// ── 6. Finishing: the rider finishes after 3 min 30 s and 1.5 miles; the final tick settles the fractions ──
const ride3 = newRide("c", "metered");
await payDue(ctx(ride3, riderW, rider, T0 + 3 * MIN + 30000, 1.5));
const owedBefore = Pay.sentSats(ride3); // base + 3 min + 1 mile
assert.equal(owedBefore, 2000 + 3 * 250 + 1100);
signAs(rider, K.RIDE_FINISH, { requestId: ride3.id, reason: "rider", role: "rider", at: T0 + 3 * MIN + 30000, miles: 1.5, minutes: 3.5 }, [["e", ride3.id], ["p", driver.publicKey], ["d", "finish-" + ride3.id]], T0 + 3 * MIN + 30000);
const fin = await payDue(ctx(ride3, riderW, rider, T0 + 10 * MIN, 1.5));
assert.equal(fin.status, "paid");
assert.equal(fin.sentNow, Math.round(0.5 * 1100 + 0.5 * 250), "half a mile and half a minute");
assert.equal(Pay.ticksOf(ride3).at(-1).trigger, "final");
assert.equal((await payDue(ctx(ride3, riderW, rider, T0 + 11 * MIN, 9))).status, "ok", "after the final tick nothing more is due, however much time passes");

// ── 7. A ride finished by the driver after the rider stopped paying: the debt stays, and can be paid later ──
const ride4 = newRide("d", "metered");
const broke = build(net);
await topUp(broke, net, 100);
await payDue(ctx(ride4, broke, rider, T0 + 2 * MIN, 0));
signAs(driver, K.RIDE_FINISH, { requestId: ride4.id, reason: "unpaid", role: "driver", at: T0 + 2 * MIN + 5000, miles: 0.3, minutes: 2.1 }, [["e", ride4.id], ["p", rider.publicKey], ["d", "finish-" + ride4.id]], T0 + 2 * MIN + 5000);
const debt = await payDue(ctx(ride4, broke, rider, T0 + 30 * MIN, 0.3));
assert.equal(debt.status, "short");
assert.ok(debt.outstanding > 2000, "the rider still owes the base and the minutes");
await topUp(broke, net, 4000);
const settled = await payDue(ctx(ride4, broke, rider, T0 + 31 * MIN, 0.3));
assert.equal(settled.status, "paid", "the rider refilled the wallet and paid what was missed, including the final part");
await redeemTicks({ request: ride4, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT });
assert.ok(Rm.ledgerSummary(ride4, Rm.currentLedger(ride4, { terms: Tm.rideTerms(ride4), price: PRICE, nowMs: T0 + 32 * MIN, miles: 0.3 })).outstanding <= 2);

// ── 8. There are no flat prices: an old "flat" offer is paid like the standard fare, with no cap ──
await topUp(riderW, net, 20000);
const ride5 = newRide("e", "flat");
assert.equal(Tm.rideTerms(ride5).mode, "metered", "an old flat offer reads as the driver's standard fare");
await payDue(ctx(ride5, riderW, rider, T0 + 20 * MIN, 6));
assert.equal(Pay.sentSats(ride5), 2000 + 20 * 250 + 6 * 1100, "base + 20 minutes + 6 miles: it grows with time and distance");

// ── 9. The driver waives part of the fare: the unpaid part is forgiven, the rest comes back as ecash ──
const ride7 = newRide("g", "metered");
await payDue(ctx(ride7, riderW, rider, T0 + MIN, 0));
await redeemTicks({ request: ride7, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT });
const paid7 = Pay.paidSats(ride7);
const split = (await import(`${R}/lib/finish.js`)).waiverSplit({ outstandingSats: 0, paidSats: paid7, waiveSats: 1000 });
assert.deepEqual(split, { forgiven: 0, refund: 1000 });
const refund = await driverW.pay(MINT, split.refund);
const w = Pay.waiverEvent(ride7, driver, { forgivenSats: split.forgiven, refundSats: split.refund, token: refund.token, reason: "Sorry" });
signAs(driver, w.kind, w.content, w.tags);
driverW.settle(refund.id);
const wv = Pay.waiversOf(ride7)[0];
const before = riderW.balance(MINT);
const back = await riderW.redeem(Pay.waiverToken(wv, ride7, rider), { only: [MINT] });
assert.equal(riderW.balance(MINT), before + back.sats);
assert.ok(back.sats >= 999, "the rider received the refund as ecash: " + back.sats);
// ── 10. A silence is never charged: both phones quiet for 10 minutes -> the ledger stops at the last signal ──
const ride8 = newRide("h", "metered");
const key8 = (await import(`${R}/lib/rides.js`)).rideKey(ride8);
mem["nostrride_rideLastSignal"] = JSON.stringify({ [key8]: T0 + 3 * MIN }); // this device's last signal: 3 minutes in
const cutoff = Rm.silenceCutoff(ride8, "rider", T0 + 20 * MIN);
assert.equal(cutoff, T0 + 3 * MIN, "the last signal of either person is the cut-off");
assert.equal(Rm.silenceCutoff(ride8, "rider", T0 + 8 * MIN), null, "5 minutes of quiet is not enough");
const led8 = Rm.currentLedger(ride8, { terms: Tm.rideTerms(ride8), price: PRICE, nowMs: T0 + 20 * MIN, miles: 0, role: "rider" });
assert.deepEqual(led8.units.map((u) => u.id), ["base", "min-1", "min-2", "min-3"], "the 17 quiet minutes are not on the fare");
// The finish event for it may not run back past a signed event that proves someone was there.
signAs(rider, K.RIDE_ALIVE, { role: "rider", forRole: "driver", at: T0 + 9 * MIN }, [["e", ride8.id], ["p", driver.publicKey], ["d", "alive-x"]], T0 + 9 * MIN);
signAs(rider, K.RIDE_FINISH, { requestId: ride8.id, reason: "silence", role: "rider", at: T0 + 3 * MIN, miles: 0.5 }, [["e", ride8.id], ["p", driver.publicKey], ["d", "finish-" + ride8.id]], T0 + 21 * MIN);
const endAt = (await import(`${R}/lib/rides.js`)).rideEnding(ride8).fin.at;
assert.equal(endAt, sec(T0 + 9 * MIN) * 1000, "a 'silence' finish cannot claim an earlier time than a signed sign of life: the charge runs to minute 9");
// ── 11. The rider's phone sleeps with a full wallet (a web page's timers stop): the driver sees missed payments, and ONE payment on waking clears them ──
const ride9 = newRide("i", "metered");
assert.equal((await payDue(ctx(ride9, riderW, rider, T0 + 5000, 0))).status, "paid", "the screen is on at the start: the base is paid");
await redeemTicks({ request: ride9, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT, nowMs: T0 + 6000 });
assert.equal(Pay.paidSats(ride9), 2000);
// The timer stops (nobody calls payDue). The driver's app, awake, keeps its own ledger.
const asleepAt = T0 + 3 * MIN + 31000;
const driverLed = () => Rm.currentLedger(ride9, { terms: Tm.rideTerms(ride9), price: PRICE, nowMs: asleepAt, miles: 0.5, role: "driver" });
const driverSum = Rm.ledgerSummary(ride9, driverLed());
assert.equal(driverSum.outstanding, 750, "the base is paid; what is open is minutes 1, 2 and 3 (3 x 250 sats)");
assert.ok(Tk.missedTicks(driverLed(), driverSum.paid + driverSum.forgiven, asleepAt) >= Tk.MISSED_LIMIT, "the driver sees missed payments and may finish the ride, though the rider's wallet is full");
// The phone wakes (the app pays at once on `visibilitychange`): everything due goes out as ONE token and the driver is level again.
r = await payDue(ctx(ride9, riderW, rider, asleepAt + 1000, 0.5));
assert.equal(r.status, "paid", "the wallet had the money all along");
assert.equal(r.sentNow, 750, "one payment for all three minutes");
assert.equal(Pay.ticksOf(ride9).length, 2, "the base and the catch-up: two ticks in all");
await redeemTicks({ request: ride9, user: driver, ecash: driverW, publish: publishAs(driver), mint: MINT, nowMs: asleepAt + 2000 });
const levelSum = Rm.ledgerSummary(ride9, driverLed());
assert.equal(levelSum.outstanding, 0);
assert.equal(Tk.missedTicks(driverLed(), levelSum.paid + levelSum.forgiven, asleepAt + 2000), 0, "no missed payment is left");
console.log("rideflow tests ok");
