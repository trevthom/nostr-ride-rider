// ════════════════════════════════════════════════════════════
//  ODOMETER — Adds up the miles of a GPS track. Pure functions: feed it one
//  fix at a time. GPS wobbles even when a car stands still, so it counts a
//  move only when it is real:
//    • a fix with poor accuracy (worse than 50 m) is skipped;
//    • a move smaller than max(6 m, half the accuracy) is wobble, skipped.
//      (The start point stays put, so a slow real drift still adds up once it
//      is far enough from it.)
//    • a jump faster than 120 mph is a GPS glitch, skipped. After 5 such
//      jumps in a row the start point moves to the new fix (the old one was bad).
//    • a GPS GAP (a tunnel, a garage): when the next good fix comes up to 10 minutes
//      after the last one, the miles in between are filled in with a straight line
//      from the last fix to the new one (the speed check above still applies).
//      After a longer gap the new fix only becomes the new start point; the
//      missing miles are not counted (lib/finish.js: the silence rule decides).
//  Straight lines between fixes cut corners, so a track with few fixes
//  reads a little low. That is why the rider's own number is only used when
//  it differs a lot from the driver's (lib/meter.js).
//
//    stepOdo(state, { lat, lng, accuracy?, t }) → new state { miles, last, rej }
//    (t = time in ms)
// ════════════════════════════════════════════════════════════

import { haversineDistance } from "./geo.js";

const M_PER_MILE = 1609.344;
export const ODO_LIMITS = { maxAccuracyM: 50, minMoveM: 6, maxSpeedMps: 53.6, maxRejects: 5, maxGapMs: 10 * 60000 };

export const newOdo = () => ({ miles: 0, last: null, rej: 0 });

export function stepOdo(odo, fix, limits = ODO_LIMITS) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || !Number.isFinite(fix.t)) return odo;
  const acc = Number.isFinite(fix.accuracy) ? fix.accuracy : 0;
  if (acc > limits.maxAccuracyM) return odo;
  const here = { lat: fix.lat, lng: fix.lng, t: fix.t };
  if (!odo.last) return { ...odo, last: here, rej: 0 };

  const dt = (fix.t - odo.last.t) / 1000;
  if (dt <= 0) return odo;
  if (dt * 1000 > limits.maxGapMs) return { ...odo, last: here, rej: 0 }; // gap longer than the grace time
  const d = haversineDistance(odo.last.lat, odo.last.lng, fix.lat, fix.lng) * M_PER_MILE; // meters
  if (d < Math.max(limits.minMoveM, acc * 0.5)) return odo;
  if (d / dt > limits.maxSpeedMps) {
    const rej = (odo.rej || 0) + 1;
    return rej >= limits.maxRejects ? { ...odo, last: here, rej: 0 } : { ...odo, rej };
  }
  return { miles: odo.miles + d / M_PER_MILE, last: here, rej: 0 };
}
