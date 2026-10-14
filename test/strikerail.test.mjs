// A ride paid STRAIGHT from the rider's Strike account into the driver's Strike account (lib/strikerail.js), with no ecash mint:
// the rider's app asks for an invoice for each tick, the driver's app makes it in the currency the driver chose and confirms only
// when the driver's OWN Strike says it is paid. Run against the stand-in Strike server, with the real rider and driver code.
//   • the rail is frozen by the offer and the accept; an ecash ride is untouched
//   • a tick → an invoice → a payment → "received", for bitcoin and for dollars; the right account is credited in the right currency
//   • nothing is paid twice, a lost answer is never retried blindly, a wrong invoice is never paid, a short balance asks nothing
//   • an unanswered or unpaid tick stops counting as sent, so the rider asks again; a late payment still counts
// Run with: npm test
import assert from "node:assert/strict";
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const Pay = await import(`${R}/lib/payments.js`);
const Tm = await import(`${R}/lib/terms.js`);
const Sr = await import(`${R}/lib/strikerail.js`);
const S = await import(`${R}/lib/strike.js`);
const { payRideStrike } = await import(`${R}/features/payments/strikeTicks.js`);
const { serveStrikeTicks, serveAllStrike } = await import(`${R}/features/payments/strikeServe.js`);
const { redeemTicks } = await import(`${R}/features/payments/redeemTicks.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);
const { startLocalStrike } = await import("./helpers/localstrike.mjs");

const MIN = 60000, PRICE = 100000;
const T0 = Date.now() - 20 * MIN;
const sec = (ms) => Math.floor(ms / 1000);
const rider = generateKeypair(), driver = generateKeypair(), stranger = generateKeypair();
const signAs = (who, kind, content, tags, atMs) => {
  const ev = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk);
  if (atMs) ev.created_at = sec(atMs);
  relay._store(ev);
  return ev;
};
const publishAs = (who) => async (kind, content, tags) => { signAs(who, kind, content, tags); return true; };

// A ride whose offer carries `offerStrike` (the driver's Strike currency, or none) and whose accept names `rail`.
function newRide(name, { offerStrike, rail } = {}) {
  const d = "ride-" + name;
  const trip = { pickup: { name: "P", lat: 38, lng: -84.5 }, dropoff: { name: "D", lat: 38.1, lng: -84.5 }, distanceMiles: 5, durationMin: 15 };
  const req = signAs(rider, K.RIDE_REQUEST, { ...trip, status: "requested", time: "ASAP" }, [["d", d]], T0 - 5 * MIN);
  const offer = signAs(driver, K.RIDE_OFFER, { priceSats: 11250, mode: "metered", rates: { base: 2, perMile: 1.1, perMinute: 0.25, currency: "USD" }, mint: "https://mint.test", ...(offerStrike && { strike: { currency: offerStrike } }), tripMiles: 5, tripMinutes: 15 }, [["e", req.id], ["p", rider.publicKey], ["d", "offer-" + req.id]], T0 - 4 * MIN);
  signAs(rider, K.RIDE_ACCEPT, { offerId: offer.id, requestId: req.id, ...(rail && { rail }) }, [["e", offer.id], ["e", req.id], ["p", driver.publicKey], ["d", "accept-" + req.id]], T0 - 3 * MIN);
  const live = signAs(rider, K.RIDE_REQUEST, { ...trip, status: "in_progress", driverPubkey: driver.publicKey }, [["d", d], ["p", driver.publicKey]], T0 - 2 * MIN);
  signAs(driver, K.RIDE_STAGE, { stage: "arrived", at: T0 - MIN }, [["e", live.id], ["p", rider.publicKey], ["d", "stage-" + d]], T0 - MIN);
  signAs(driver, K.RIDE_STAGE, { stage: "riding", at: T0, arrivedAt: T0 - MIN }, [["e", live.id], ["p", rider.publicKey], ["d", "stage-" + d]], T0);
  return live;
}

// ── 1. The rail is frozen by the offer AND the accept ──
const strikeRide = newRide("a", { offerStrike: "USD", rail: "strike" });
assert.equal(Sr.rideRail(strikeRide), "strike");
assert.deepEqual(Sr.rideStrike(strikeRide), { currency: "USD" });
assert.equal(Sr.rideRail(newRide("b", { offerStrike: "USD" })), "ecash", "the rider did not ask for Strike");
assert.equal(Sr.rideRail(newRide("c", { rail: "strike" })), "ecash", "the driver did not offer Strike: the rider cannot make them take it");
assert.equal(Sr.rideRail(newRide("d", { offerStrike: "EUR", rail: "strike" })), "ecash", "only bitcoin or dollars");
assert.equal(Tm.rideMint(strikeRide), "https://mint.test", "the ecash mint is still there as the other way");

const strikeSrv = await startLocalStrike({ apiKey: "rider-key-aaaaaaaaaaaaaaaa", usdPerBtc: PRICE, balances: { BTC: 0.01, USD: 500 } });
const driverAcct = strikeSrv.addAccount("driver-key-bbbbbbbbbbbbbbbb", { BTC: 0, USD: 0 });
const mk = (key, extra = {}) => ({ client: S.makeStrike({ apiKey: key, baseUrl: strikeSrv.url, sleep: async () => {} }), source: "BTC", receive: "USD", ...extra });
const riderStrike = mk("rider-key-aaaaaaaaaaaaaaaa"), driverStrike = mk("driver-key-bbbbbbbbbbbbbbbb");
const rideArgs = (request, nowMs, miles, over = {}) => ({ request, user: rider, strike: riderStrike, publish: publishAs(rider), terms: Tm.rideTerms(request), price: PRICE, usdPrice: PRICE, nowMs, miles, ...over });
const serveArgs = (request, nowMs, over = {}) => ({ request, user: driver, strike: driverStrike, publish: publishAs(driver), usdPrice: PRICE, nowMs, ...over });
try {
  // ── 2. A short Strike balance asks for nothing ──
  riderStrike.source = "USD";
  const poor = await startLocalStrike({ apiKey: "poor-key-cccccccccccccccc", balances: { BTC: 0, USD: 1 } });
  const poorRes = await payRideStrike(rideArgs(strikeRide, T0 + 130000, 0.4, { strike: { client: S.makeStrike({ apiKey: "poor-key-cccccccccccccccc", baseUrl: poor.url }), source: "USD" } }));
  assert.equal(poorRes.status, "short", "$1 cannot pay $2.50");
  assert.equal(Pay.ticksOf(strikeRide).length, 0, "nothing was asked of the driver");
  await poor.close();

  // ── 3. The first tick (base + 2 minutes = 2,500 sats), paid from the Bitcoin balance into a driver who wants dollars ──
  riderStrike.source = "BTC";
  let r = await payRideStrike(rideArgs(strikeRide, T0 + 130000, 0.4));
  assert.equal(r.status, "paid");
  assert.equal(r.sentNow, 2500);
  let ticks = Pay.ticksOf(strikeRide);
  assert.deepEqual(ticks.map((t) => [t.rail, t.amountSats]), [["strike", 2500]]);
  assert.equal(Pay.sentSats(strikeRide, T0 + 130000), 2500);
  assert.equal(Pay.paidSats(strikeRide), 0, "asked, not paid");
  assert.equal(strikeSrv.stats.payments.length, 0, "no money moved yet");
  r = await payRideStrike(rideArgs(strikeRide, T0 + 131000, 0.4));
  assert.equal(Pay.ticksOf(strikeRide).length, 1, "one tick, not two: it is already counted as sent");
  // The driver makes ONE invoice, in dollars, and sends it sealed.
  let d = await serveStrikeTicks(serveArgs(strikeRide, T0 + 132000));
  assert.deepEqual([d.issued, d.received, d.waiting], [1, 0, 1]);
  assert.deepEqual(strikeSrv.stats.invoices.map((i) => i.amount), [{ currency: "USD", amount: "2.50" }], "2,500 sats at $100,000 = $2.50");
  const inv = Sr.invoicesOf(strikeRide).get(ticks[0].id);
  assert.equal(inv.currency, "USD");
  assert.equal(inv.sats, 2500);
  assert.ok(!JSON.stringify(inv.event).includes("lnbc"), "the invoice is sealed to the rider");
  assert.ok(Sr.invoiceBolt(inv, strikeRide, rider).startsWith("lnbc"), "the rider opens it");
  assert.equal(Sr.invoiceBolt(inv, strikeRide, driver), null, "the driver does not open their own reply (only the rider needs it)");
  assert.equal(Sr.invoiceBolt(inv, strikeRide, stranger), null);
  d = await serveStrikeTicks(serveArgs(strikeRide, T0 + 133000));
  assert.equal(strikeSrv.stats.invoices.length, 1, "asking again does not make a second invoice");
  assert.equal(Pay.paidSats(strikeRide), 0, "unpaid is not paid");
  // The rider's Strike pays it.
  r = await payRideStrike(rideArgs(strikeRide, T0 + 134000, 0.4));
  assert.equal(strikeSrv.stats.payments.length, 1);
  assert.equal(strikeSrv.stats.payments[0].source, "BTC");
  assert.equal(strikeSrv.stats.payments[0].sats, 2500);
  assert.ok(Math.abs(strikeSrv.balances.BTC - (0.01 - 2501e-8)) < 1e-12, "2,500 sats and the network fee left the Bitcoin balance");
  assert.ok(Math.abs(driverAcct.balances.USD - 2.5) < 1e-9, "the driver's Strike received dollars: " + driverAcct.balances.USD);
  assert.equal(driverAcct.balances.BTC, 0, "and no bitcoin: they chose dollars");
  await payRideStrike(rideArgs(strikeRide, T0 + 135000, 0.4));
  assert.equal(strikeSrv.stats.payments.length, 1, "a paid invoice is never paid again");
  // The driver's own Strike says PAID → "received".
  d = await serveStrikeTicks(serveArgs(strikeRide, T0 + 141000)); // after the driver's 8 s wait between looks
  assert.equal(d.received, 2500);
  assert.equal(Pay.paidSats(strikeRide), 2500, "the driver's confirmation counts as paid");
  d = await serveStrikeTicks(serveArgs(strikeRide, T0 + 142000));
  assert.deepEqual([d.issued, d.received, d.waiting], [0, 0, 0], "an answered tick is left alone");

  // ── 4. A mile, in bitcoin this time (the driver changes nothing for this ride: dollars are frozen in the offer) ──
  driverStrike.receive = "BTC";
  await payRideStrike(rideArgs(strikeRide, T0 + 150000, 1.2));
  assert.equal(Pay.ticksOf(strikeRide).at(-1).amountSats, 1100, "mile 1");
  await serveStrikeTicks(serveArgs(strikeRide, T0 + 151000));
  assert.equal(strikeSrv.stats.invoices.at(-1).amount.currency, "USD", "the currency is the one in the offer the rider chose");
  await payRideStrike(rideArgs(strikeRide, T0 + 152000, 1.2));
  const dd = await serveStrikeTicks(serveArgs(strikeRide, T0 + 160000));
  assert.equal(dd.received, 1100);
  assert.equal(Pay.paidSats(strikeRide), 3600);
  assert.ok(Math.abs(driverAcct.balances.USD - 3.6) < 1e-9, "$3.60 in all: " + driverAcct.balances.USD);

  // ── 5. A ride whose driver is paid in bitcoin: exact sats, to the sat ──
  const btcRide = newRide("e", { offerStrike: "BTC", rail: "strike" });
  riderStrike.source = "USD"; // and the rider pays from dollars
  await payRideStrike(rideArgs(btcRide, T0 + 130000, 0.4));
  await serveStrikeTicks(serveArgs(btcRide, T0 + 131000));
  assert.deepEqual(strikeSrv.stats.invoices.at(-1).amount, { currency: "BTC", amount: "0.00002500" });
  await payRideStrike(rideArgs(btcRide, T0 + 132000, 0.4));
  assert.equal(strikeSrv.stats.payments.at(-1).source, "USD", "paid from the dollar balance");
  assert.ok(Math.abs(strikeSrv.balances.USD - (500 - 2.51 * 1.005 * 1)) < 0.02, "dollars paid, with Strike's spread: " + strikeSrv.balances.USD);
  assert.ok(Math.abs(driverAcct.balances.BTC - 2500e-8) < 1e-12, "the driver's Strike received exactly 2,500 sats");
  assert.equal((await serveStrikeTicks(serveArgs(btcRide, T0 + 140000))).received, 2500);
  assert.equal(Pay.paidSats(btcRide), 2500);

  // ── 6. A wrong invoice is never paid ──
  riderStrike.source = "BTC";
  const bad = newRide("f", { offerStrike: "BTC", rail: "strike" });
  await payRideStrike(rideArgs(bad, T0 + 130000, 0.4));
  const badTick = Pay.ticksOf(bad)[0];
  const { invoiceFor } = await import("./helpers/localmint.mjs");
  signAs(driver, ...(() => { const ev = Sr.invoiceEvent(bad, badTick.event, driver, { bolt11: invoiceFor(9000, "greedy"), sats: 9000, currency: "BTC", receive: null, expiresAt: T0 + 400000 }); return [ev.kind, ev.content, ev.tags]; })());
  const before = strikeSrv.stats.payments.length;
  r = await payRideStrike(rideArgs(bad, T0 + 131000, 0.4));
  assert.equal(strikeSrv.stats.payments.length, before, "an invoice for 9,000 sats is not paid for a 2,500 sat tick");
  assert.equal(r.status, "error");
  assert.match(r.message, /does not match/);
  r = await payRideStrike(rideArgs(bad, T0 + 140000, 0.4));
  assert.equal(strikeSrv.stats.payments.length, before, "and it is not tried again");
  assert.equal(r.status, "error", "and the rider keeps being told while that invoice is open");

  // ── 7. A lost answer: Strike took the payment but the rider's app never heard. It is NOT paid a second time. ──
  const lost = newRide("g", { offerStrike: "BTC", rail: "strike" });
  await payRideStrike(rideArgs(lost, T0 + 130000, 0.4));
  await serveStrikeTicks(serveArgs(lost, T0 + 131000));
  strikeSrv.glitch = "after";
  r = await payRideStrike(rideArgs(lost, T0 + 132000, 0.4));
  assert.equal(r.status, "error", "the rider is told it did not go through, and to look");
  const paidOnce = strikeSrv.stats.payments.length;
  await payRideStrike(rideArgs(lost, T0 + 150000, 0.4));
  assert.equal(strikeSrv.stats.payments.length, paidOnce, "no second payment for the same invoice");
  assert.equal((await serveStrikeTicks(serveArgs(lost, T0 + 151000))).received, 2500, "the driver's Strike saw the payment, so the tick is confirmed");

  // ── 7b. A crash after the invoice was made but before it was sent: the saved invoice is sent, a second one is NOT made ──
  const crash = newRide("m", { offerStrike: "BTC", rail: "strike" });
  await payRideStrike(rideArgs(crash, T0 + 130000, 0.4));
  const crashTick = Pay.ticksOf(crash)[0];
  Sr.issuedRecords.set(crashTick.id, { invoiceId: "inv-saved", bolt11: invoiceFor(2500, "saved"), sats: 2500, currency: "BTC", receive: { currency: "BTC", amount: "0.00002500" }, expiresAt: T0 + 130000 + 5 * MIN, sent: false });
  const invoicesBefore = strikeSrv.stats.invoices.length;
  await serveStrikeTicks(serveArgs(crash, T0 + 131000)).catch(() => {}); // Strike does not know "inv-saved": the point is only that no new invoice is made
  assert.equal(strikeSrv.stats.invoices.length, invoicesBefore, "the saved invoice is used; no second one is made");
  assert.ok(Sr.invoicesOf(crash).has(crashTick.id), "and it was sent to the rider");

  // ── 7c. A rider cannot make the driver's Strike issue invoices without end ──
  const flood = newRide("n", { offerStrike: "BTC", rail: "strike" });
  for (let i = 1; i <= 9; i++) { const t = Pay.tickEvent(flood, driver.publicKey, rider, { seq: i, trigger: "min-" + i, amountSats: 300 + i, rail: "strike", at: T0 + 130000 }); signAs(rider, t.kind, t.content, t.tags); }
  const invBefore = strikeSrv.stats.invoices.length;
  await serveStrikeTicks(serveArgs(flood, T0 + 131000));
  assert.equal(strikeSrv.stats.invoices.length - invBefore, 5, "at most five invoices wait at a time");

  // ── 8. A lost request: Strike never took it. The invoice runs out, the driver refuses, and the rider is asked for it again. ──
  const gone = newRide("h", { offerStrike: "BTC", rail: "strike" });
  await payRideStrike(rideArgs(gone, T0 + 130000, 0.4));
  await serveStrikeTicks(serveArgs(gone, T0 + 131000));
  strikeSrv.glitch = "before";
  await payRideStrike(rideArgs(gone, T0 + 132000, 0.4));
  const goneTick = Pay.ticksOf(gone)[0];
  assert.equal(Pay.sentSats(gone, T0 + 133000), 2500, "while the invoice can still be paid it counts as sent");
  d = await serveStrikeTicks(serveArgs(gone, T0 + 132000 + 5 * MIN + 100000)); // past the invoice and its grace
  assert.equal(d.refused, 1);
  assert.equal(Pay.tickReplies(gone).get(goneTick.id).ok, false);
  assert.equal(Pay.sentSats(gone, T0 + 132000 + 5 * MIN + 100000), 0, "a refused tick does not count as sent");
  const ask2 = await payRideStrike(rideArgs(gone, T0 + 132000 + 5 * MIN + 110000, 0.4));
  assert.ok(ask2.sentNow >= 2500, "asked again, for the minutes that have passed too: " + ask2.sentNow);
  assert.equal(Pay.ticksOf(gone).length, 2, "a new tick was made");
  // A late payment of the old invoice still counts: "received" replaces the refusal.
  const oldInv = Sr.invoicesOf(gone).get(goneTick.id);
  const q = await riderStrike.client.payQuote(Sr.invoiceBolt(oldInv, gone, rider), "BTC");
  await riderStrike.client.execute(q.id);
  d = await serveStrikeTicks(serveArgs(gone, T0 + 132000 + 5 * MIN + 120000));
  assert.equal(Pay.tickReplies(gone).get(goneTick.id).ok, true, "a late payment is still a payment");

  // ── 9. A driver who never answers: the request stops counting after a while, so the rider asks again ──
  const mute = newRide("i", { offerStrike: "BTC", rail: "strike" });
  await payRideStrike(rideArgs(mute, T0 + 130000, 0.4));
  assert.equal(Pay.sentSats(mute, T0 + 130000 + 2 * MIN), 2500, "within three minutes the driver may still answer");
  assert.equal(Pay.sentSats(mute, T0 + 130000 + 4 * MIN), 0, "after that the request lapses");
  const again = await payRideStrike(rideArgs(mute, T0 + 130000 + 4 * MIN, 0.4));
  assert.equal(again.status, "paid", "the rider asks again");
  d = await serveStrikeTicks(serveArgs(mute, T0 + 130000 + 4 * MIN + 1000));
  const [oldTick, newTick] = Pay.ticksOf(mute);
  assert.equal(Pay.tickReplies(mute).get(oldTick.id).ok, false, "the lapsed request gets no invoice and is refused");
  assert.ok(Sr.invoicesOf(mute).has(newTick.id) && !Sr.invoicesOf(mute).has(oldTick.id), "the new request gets its invoice");

  // ── 10. A key without the permission: nothing is refused, the tick waits and is tried later ──
  const noInv = await startLocalStrike({ apiKey: "limited-key-dddddddddddd", scopes: [S.SCOPES.balances] });
  const limited = newRide("j", { offerStrike: "BTC", rail: "strike" });
  await payRideStrike(rideArgs(limited, T0 + 130000, 0.4));
  d = await serveStrikeTicks(serveArgs(limited, T0 + 131000, { strike: { client: S.makeStrike({ apiKey: "limited-key-dddddddddddd", baseUrl: noInv.url }) } }));
  assert.deepEqual([d.refused, d.waiting], [0, 1], "a permission problem is the driver's to fix: the rider is not told no");
  await noInv.close();

  // ── 11. A rider cannot make an ecash ride pay through Strike, and a Strike tick on an ecash ride is refused ──
  const ecashRide = newRide("k", { offerStrike: "BTC" }); // the rider did not choose Strike
  const sneaky = Pay.tickEvent(ecashRide, driver.publicKey, rider, { seq: 1, trigger: "base", amountSats: 2000, rail: "strike" });
  signAs(rider, sneaky.kind, sneaky.content, sneaky.tags);
  d = await serveStrikeTicks(serveArgs(ecashRide, T0 + 131000));
  assert.equal(d.refused, 1);
  assert.match(Pay.tickReplies(ecashRide).get(Pay.ticksOf(ecashRide)[0].id).reason, /not paid with Strike/);
  assert.equal((await redeemTicks({ request: strikeRide, user: driver, ecash: { redeem() { throw new Error("must not be called"); } }, publish: publishAs(driver), mint: "https://mint.test" })).received, 0, "the ecash code leaves Strike ticks alone");

  // ── 12. serveAllStrike finds the rides by itself (a rider may pay long after the ride) ──
  const later = newRide("l", { offerStrike: "BTC", rail: "strike" });
  await payRideStrike(rideArgs(later, T0 + 130000, 0.4));
  await serveAllStrike({ user: driver, strike: driverStrike, publish: publishAs(driver), usdPrice: PRICE, rideRequests: [later], nowMs: T0 + 131000 });
  assert.equal(Sr.invoicesOf(later).size, 1, "the driver's loop answered the tick");
  // A stranger cannot ask for invoices.
  const evil = Pay.tickEvent(later, driver.publicKey, stranger, { seq: 9, trigger: "min-1", amountSats: 500, rail: "strike" });
  signAs(stranger, evil.kind, evil.content, evil.tags);
  await serveAllStrike({ user: driver, strike: driverStrike, publish: publishAs(driver), usdPrice: PRICE, rideRequests: [later], nowMs: T0 + 140000 });
  assert.equal(Pay.ticksOf(later).length, 1, "a tick that is not from the ride's rider is not a tick");
  assert.equal(Sr.invoicesOf(later).size, 1, "so it gets no invoice");
} finally {
  await strikeSrv.close();
}

// ── Pure rules ──
assert.equal(S.centSats(100000), 10);
assert.equal(S.centSats(0), 0);
assert.equal(S.tickSlack(250, 100000), 20, "two cents' worth, because a dollar invoice is in whole cents");
assert.equal(S.tickSlack(100000, 100000), 2000, "or 2%");
assert.equal(S.invoiceFits({ tickSats: 2500, invoiceSats: 2500, currency: "BTC" }), true);
assert.equal(S.invoiceFits({ tickSats: 2500, invoiceSats: 2501, currency: "BTC" }), false, "a bitcoin invoice may not ask for a sat more");
assert.equal(S.invoiceFits({ tickSats: 2500, invoiceSats: 2400, currency: "BTC" }), true, "less is fine");
assert.equal(S.invoiceFits({ tickSats: 250, invoiceSats: 265, currency: "USD", usdPerBtc: 100000 }), true, "a dollar invoice may round up a little");
assert.equal(S.invoiceFits({ tickSats: 250, invoiceSats: 300, currency: "USD", usdPerBtc: 100000 }), false);
assert.equal(S.invoiceFits({ tickSats: 250, invoiceSats: 250, currency: "USD" }), false, "no price: a dollar invoice cannot be checked");
assert.equal(Sr.strikeCanPay({ BTC: 0.0001, USD: 5 }, "BTC", 9000, 100000), true);
assert.equal(Sr.strikeCanPay({ BTC: 0.0001, USD: 5 }, "BTC", 11000, 100000), false);
assert.equal(Sr.strikeCanPay({ BTC: 0.0001, USD: 5 }, "USD", 4000, 100000), true, "$4 for $4.00 with a little extra");
assert.equal(Sr.strikeCanPay({ BTC: 0.0001, USD: 5 }, "USD", 5000, 100000), false, "$5 is not enough for $5.00 plus the spread");
assert.equal(Sr.strikeCanPay(null, "BTC", 1, 1), null, "unknown balances: let Strike decide");
assert.equal(Sr.strikeCanPay({ USD: 5 }, "USD", 1000, null), null, "no price: unknown");
console.log("strikerail: ok");
