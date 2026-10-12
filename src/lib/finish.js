// ════════════════════════════════════════════════════════════
//  FINISH — How a ride ends. There are no cancellations and no cancel fees.
//  Either person taps "Finish ride" (after a confirmation). The rider then
//  owes only what the ride has earned so far — the base, each mile and each
//  minute (lib/ticks.js) — and most of it is already paid, tick by tick.
//  Before the ride starts nothing is owed, so finishing then is free.
//
//  The driver may waive any part of the fare afterwards (waiverSplit).
//
//  Silence and lost connections never end a ride on their own:
//    • a phone that goes quiet mid-ride is NOT a finish. The other person can
//      tap "Still riding" / "Still driving"; that counts as a signal;
//    • only when BOTH phones have been silent for 10 minutes does the ride
//      finish, and the charge runs up to the last signed signal;
//    • time when OUR OWN relays were unreachable is not counted (neither
//      person is blamed for a relay outage);
//    • a person who goes offline on purpose to dodge a charge changes
//      nothing: the charge runs to the last signal, as for any finish.
//  A GPS gap (a tunnel) is allowed for 10 minutes (lib/odometer.js).
//
//  Pure functions.
// ════════════════════════════════════════════════════════════

export const SILENCE_FINISH_MS = 10 * 60000;
export const GPS_GAP_GRACE_MS = 10 * 60000;

// Why a ride was finished (the `reason` of the signed finish event).
export const FINISH_REASONS = {
  rider: "The rider finished the ride.",
  driver: "The driver finished the ride.",
  destination: "The driver finished the ride at the destination.",
  unpaid: "The driver finished the ride after payments were missed.",
  silence: "Both phones were silent for 10 minutes, so the ride was finished at the last signal.",
};
export const isFinishReason = (r) => Object.prototype.hasOwnProperty.call(FINISH_REASONS, r);

// How long a person has been quiet, in ms, leaving out the time our own relays were down.
export function quietMs(lastAt, nowMs, downMs = 0) {
  if (!Number.isFinite(lastAt)) return Infinity;
  return Math.max(0, nowMs - lastAt - Math.max(0, downMs));
}

// Both phones quiet? { lastAt, quiet, finish } — `finish` is true after SILENCE_FINISH_MS.
// riderAt / driverAt = the time (ms) of each person's last signed signal; null if never.
export function bothQuiet({ riderAt, driverAt, nowMs, downMs = 0 }) {
  const lastAt = Math.max(Number.isFinite(riderAt) ? riderAt : -Infinity, Number.isFinite(driverAt) ? driverAt : -Infinity);
  if (lastAt === -Infinity) return { lastAt: null, quiet: 0, finish: false }; // no signal yet: nothing to measure
  const quiet = quietMs(lastAt, nowMs, downMs);
  return { lastAt, quiet, finish: quiet >= SILENCE_FINISH_MS };
}

// The moment the charge runs to: the last signal after a silence, otherwise now.
export const finishCutoff = (reason, { nowMs, lastSignalAt }) => (reason === "silence" && Number.isFinite(lastSignalAt) ? Math.min(nowMs, lastSignalAt) : nowMs);

// A finish event's content, checked (anything from a relay is untrusted). null if it is not usable.
export function readFinish(content) {
  if (!content || typeof content !== "object") return null;
  const num = (x, max) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : null);
  return {
    reason: isFinishReason(content.reason) ? content.reason : "",
    role: content.role === "rider" || content.role === "driver" ? content.role : "",
    at: num(content.at, 4e12),
    miles: num(content.miles, 5000),
    minutes: num(content.minutes, 1e5),
    atDestination: content.atDestination === true,
    note: typeof content.note === "string" ? content.note.slice(0, 500) : "",
  };
}

// The driver waives `waiveSats` of the fare. Unpaid money is waived first; if more is waived than is
// unpaid, the rest is refunded from what the rider already paid (as ecash sent back).
export function waiverSplit({ outstandingSats, paidSats, waiveSats }) {
  const waive = Math.max(0, Math.min(Math.round(waiveSats) || 0, Math.max(0, outstandingSats) + Math.max(0, paidSats)));
  const forgiven = Math.min(waive, Math.max(0, outstandingSats));
  return { forgiven, refund: waive - forgiven };
}
