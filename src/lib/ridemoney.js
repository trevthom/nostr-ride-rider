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
//
//  The ledger is saved under the ride's key (the last 8 rides are kept).
// ════════════════════════════════════════════════════════════

import { getSetting, setSetting } from "../config/relays.js";
import { advanceLedger, convertToMetered, milesAt, newLedger, owedSats, settle } from "./ticks.js";
import { rideEnding, rideKey, rideTimes } from "./rides.js";
import { forgivenSats, paidSats, sentSats, signalTimes } from "./payments.js";
import { bothQuiet } from "./finish.js";

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
  let led = saved && saved.startedAt === startedAt ? saved : newLedger(startedAt, terms.mode);
  const before = led;
  if (led.mode === "flat" && terms.mode === "metered") led = convertToMetered(led, { terms, nowMs, miles, price });
  const end = rideEnding(request);
  if (end) {
    if (!led.final) {
      const atMs = Math.max(startedAt, end.fin?.at ?? end.at * 1000);
      const miles_ = end.fin?.miles ?? miles ?? 0;
      led = settle(led, { terms, atMs, miles: miles_, price, atDestination: !!end.fin?.atDestination }) || led;
    }
  } else {
    const cut = role ? silenceCutoff(request, role, nowMs) : null;
    led = advanceLedger(led, { terms, nowMs: cut != null ? Math.min(nowMs, cut) : nowMs, miles, price });
  }
  if (led !== before || !saved) saveLedger(key, led);
  return led;
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
