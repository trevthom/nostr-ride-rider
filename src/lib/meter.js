// ════════════════════════════════════════════════════════════
//  METER — The numbers the trip screens show (time and distance) and the
//  rule for which distance to believe.
//
//  Two apps measure the same drive:
//    • the DRIVER's app, from the driver's own GPS (the reference); and
//    • the RIDER's app, from the rider's own GPS during the trip (or, while
//      the driver is still on the way to the pickup, from the driver's
//      position updates the rider receives). Its number is kept inside the
//      code: no screen shows it.
//  The rule: use the DRIVER's distance as long as the rider's is within 5% of
//  it. If the two differ by more than 5%, use the RIDER's. The same rule
//  covers the driver's drive to the pickup.
//  One small addition: near zero a percentage means nothing, so a gap of
//  0.05 mile (about 80 m) or less always counts as "within".
//
//  The rider's app works the answer out and sends it to the driver's app, so
//  both screens show the same number.
// ════════════════════════════════════════════════════════════

import { formatDistance } from "./units.js";

export const METER_TOLERANCE = 0.05; // 5% of the driver's distance
export const METER_FLOOR_MILES = 0.05;

const num = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;

// The distance (miles) the screens use. Either input may be missing (null).
export function referenceMiles(driverMiles, riderMiles, { pct = METER_TOLERANCE, floor = METER_FLOOR_MILES } = {}) {
  if (!num(driverMiles)) return num(riderMiles) ? riderMiles : null;
  if (!num(riderMiles)) return driverMiles;
  // (1e-9: so a gap of exactly 5% is "within" even after floating-point rounding)
  return Math.abs(driverMiles - riderMiles) <= Math.max(driverMiles * pct, floor) + 1e-9 ? driverMiles : riderMiles;
}

export const fmtMiles = (m) => (num(m) ? formatDistance(m) : "–"); // in the chosen unit (lib/units.js)

// "12 min", "1 h 05 min", "<1 min". Input in milliseconds.
export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "<1 min";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

// The same with the seconds, for the clock of a ride that is running: "45 s", "5 min 03 s", "1 h 05 min 03 s". Input in milliseconds.
export function fmtDurationSec(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min ${ss} s`;
  return m > 0 ? `${m} min ${ss} s` : `${s} s`;
}

// A waiting clock, "2:05".
export function fmtClock(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// What to show for a ride at `nowMs`:
//   { phase, pickup: { miles, ms }, trip: { miles, ms } | null, waitMs }
// `times` = { confirmedAt, arrivedAt, startedAt } (ms, from the signed stage events, lib/rides.js rideTimes).
// `pickupMiles` / `tripMiles` = the reference distances.
export function meterView({ stage, times, pickupMiles, tripMiles, nowMs }) {
  const t = times || {};
  const pickupEnd = t.arrivedAt ?? (stage === "enroute" ? nowMs : t.startedAt ?? nowMs);
  return {
    phase: stage,
    pickup: { miles: pickupMiles ?? null, ms: t.confirmedAt != null ? Math.max(0, pickupEnd - t.confirmedAt) : null },
    trip: stage === "riding" ? { miles: tripMiles ?? null, ms: t.startedAt != null ? Math.max(0, nowMs - t.startedAt) : null } : null,
    waitMs: stage === "arrived" && t.arrivedAt != null ? Math.max(0, nowMs - t.arrivedAt) : stage === "riding" && t.arrivedAt != null && t.startedAt != null ? Math.max(0, t.startedAt - t.arrivedAt) : 0,
  };
}
