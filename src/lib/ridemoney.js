// ════════════════════════════════════════════════════════════
//  RIDE MONEY — The ledger of one ride on this device: what the ride has
//  earned so far, tick by tick (lib/ticks.js), kept up to date and saved so a
//  reload loses nothing. Both apps use it; each keeps its own copy and they
//  agree because they use the same signed times and the same meter.
//
//    currentLedger(request, { terms, price, nowMs, miles })
//        → the ledger for the ride, advanced to now (or settled, once the ride has ended); null before the
//          ride started or while the price is unknown for the final tick.
//    ledgerSummary(request, ledger)
//        → { owed, paid, forgiven, outstanding, sent } in sats
//    ridesOwing(requests, me, { priceFor })
//        → every ride of mine that still owes money (the ride under way and finished ones), so the rider's app pays them all
//
//  The ledger is saved under the ride's key (the last 8 rides are kept).
// ════════════════════════════════════════════════════════════

import { getSetting, setSetting } from "../config/relays.js";
import { advanceLedger, milesAt, newLedger, owedSats, settle } from "./ticks.js";
import { rideDriver, rideEnding, rideKey, rideStatus, rideTimes } from "./rides.js";
import { rideTerms } from "./terms.js";
import { forgivenSats, paidSats, sentSats, signalTimes } from "./payments.js";
import { bothQuiet } from "./finish.js";
import { boundedMiles } from "./meter.js";

const parseContent = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const STORE = "rideLedger";
const KEEP = 8;
export const SIGNAL_STORE = "rideLastSignal"; // this device's own last signal per ride (written by features/payments/useRideLink.js)

// If BOTH phones have been silent for 10 minutes (this device's last signal and the other person's, from signed events), the
// moment the charge runs to: the last signal. null otherwise. Used so a ledger never counts the minutes of a silence, even in the
// seconds before the finish event for it is published.
export function silenceCutoff(request, role, nowMs) {
  const saved = (getSetting(SIGNAL_STORE, {}) || {})[rideKey(request)];
  if (!Number.isFinite(saved)) return null;
  const sig = signalTimes(request);
  const q = bothQuiet({
    riderAt: role === "rider" ? Math.max(saved, sig.riderAt ?? 0) : sig.riderAt,
    driverAt: role === "driver" ? Math.max(saved, sig.driverAt ?? 0) : sig.driverAt,
    nowMs,
    downMs: 0,
  });
  return q.finish ? q.lastAt : null;
}

export function loadLedger(key) {
  const all = getSetting(STORE, {});
  return all && typeof all === "object" ? all[key] || null : null;
}
function saveLedger(key, ledger) {
  const all = getSetting(STORE, {}) || {};
  const entries = Object.entries({ ...all, [key]: ledger });
  setSetting(STORE, Object.fromEntries(entries.slice(-KEEP)));
}

export function currentLedger(request, { terms, price, nowMs, miles, role }) {
  const startedAt = rideTimes(request).startedAt;
  if (!startedAt || !terms) return null;
  const key = rideKey(request);
  const saved = loadLedger(key);
  let led = saved && saved.startedAt === startedAt ? saved : newLedger(startedAt);
  const before = led;
  const end = rideEnding(request);
  const quoted = Number(parseContent(request)?.distanceMiles);
  if (end) {
    if (!led.final) {
      const atMs = Math.max(startedAt, end.fin?.at ?? end.at * 1000);
      // The miles in a finish event are a CLAIM by whoever finished (the driver could write 5,000). This phone's own measure
      // decides: the live meter, else the last miles the saved ledger saw (lib/meter.js boundedMiles).
      const last = led.samples[led.samples.length - 1];
      const own = Number.isFinite(miles) ? { own: miles, ownAt: nowMs } : last ? { own: last.miles, ownAt: last.t } : {};
      const miles_ = boundedMiles(end.fin?.miles, { ...own, startedAt, atMs, quotedMiles: quoted });
      led = settle(led, { terms, atMs, miles: miles_, price }) || led;
    }
  } else {
    const cut = role ? silenceCutoff(request, role, nowMs) : null;
    const at = cut != null ? Math.min(nowMs, cut) : nowMs;
    // A distance can never be more than the clock allows, whoever reported it.
    const live = Number.isFinite(miles) ? boundedMiles(miles, { startedAt, atMs: at }) : miles;
    led = advanceLedger(led, { terms, nowMs: at, miles: live, price });
  }
  if (led !== before || !saved) saveLedger(key, led);
  return led;
}

// The rides of `me` that still owe money, however long ago they ended: the ride under way and every finished ride whose fare is
// not covered (outstanding > 0). The rider's app pays THESE, not only the ride on screen: a receipt that was dismissed, a second
// ride that ended within the hour, or an app that was closed while the wallet was short must not lose the last of a fare (the
// driver has no way to ask for it again). Each item is { request, key, ledger, unpaid, outstanding, owed, paid, forgiven, sent }:
// `unpaid` is what no tick covers yet, `outstanding` also counts ticks that were sent but not confirmed (they are offered again).
export function ridesOwing(requests, me, { priceFor, nowMs = Date.now() } = {}) {
  const out = [];
  const seen = new Set();
  for (const r of requests || []) {
    if (!r || r.pubkey !== me) continue;
    const key = rideKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    const status = rideStatus(r);
    if (status !== "in_progress" && status !== "completed") continue;
    if (!rideDriver(r)) continue;
    // A finished ride with a settled ledger that is fully covered stays covered for good (owed is fixed, paid only grows):
    // skip it without asking for terms and a price, so a phone with many past rides does not work through all of them every 3 s.
    if (status === "completed") {
      const done = loadLedger(key);
      if (done?.final && owedSats(done) <= paidSats(r) + forgivenSats(r)) continue;
    }
    const terms = rideTerms(r);
    if (!terms) continue;
    const price = typeof priceFor === "function" ? priceFor(terms.currency) : null;
    if (!price) continue; // without a price the ticks cannot be counted: wait, never guess
    const led = currentLedger(r, { terms, price, nowMs, role: "rider" });
    if (!led) continue;
    const sum = ledgerSummary(r, led);
    if (sum.outstanding <= 0) continue;
    // `unpaid` = what no tick covers yet (a tick that was sent but not confirmed is not in it: it may still arrive, and the
    // ride stays in the queue so that tick is offered again). Only `unpaid` means more money will leave the wallet.
    const unpaid = Math.max(0, sum.owed - sum.sent - sum.forgiven);
    out.push({ request: r, key, ledger: led, unpaid, ...sum });
  }
  // The ride under way first (its payments are due as they fall), then the oldest debt: money that has waited longest is cleared first.
  const rank = (x) => (rideStatus(x.request) === "in_progress" ? -Infinity : rideEnding(x.request)?.at ?? 0);
  return out.sort((a, b) => rank(a) - rank(b));
}

// Everything in sats: what the ride earned, what the driver confirmed, what they forgave, what is still open.
export function ledgerSummary(request, ledger) {
  const owed = ledger ? owedSats(ledger) : 0;
  const paid = paidSats(request), forgiven = forgivenSats(request);
  return { owed, paid, forgiven, sent: sentSats(request), outstanding: Math.max(0, owed - paid - forgiven) };
}

// The trip distance (miles) at a past moment, from the saved ledger (0 when unknown): "up to the last signal".
export function milesAtTime(request, t) {
  const led = loadLedger(rideKey(request));
  return led ? milesAt(led, t) : 0;
}
