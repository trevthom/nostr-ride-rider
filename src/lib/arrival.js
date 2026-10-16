// ════════════════════════════════════════════════════════════
//  ARRIVAL — "I've arrived" counts only when the driver's GPS is within 150 m
//  of the pickup, on a good fix. The driver app disables the button until then
//  and the signed marker carries the measured distance, so the rider's app can
//  warn when the driver says "arrived" from far away.
//
//    canMarkArrived({ pos, status, pickup }) → { ok, meters, reason }
//    arrivalMismatch(driverPos, pickup)      → true when a claimed arrival is not near the pin
// ════════════════════════════════════════════════════════════

import { haversineDistance } from "./geo.js";

export const ARRIVE_MAX_METERS = 150;
export const ARRIVE_CLAIM_SLACK_METERS = 300; // the rider's check allows for GPS error on both phones (twice the limit)
const M_PER_MILE = 1609.344;

export function canMarkArrived({ pos, status, pickup }) {
  if (!pos || !pickup) return { ok: false, meters: null, reason: "Waiting for your location." };
  const meters = Math.round(haversineDistance(pos.lat, pos.lng, pickup.lat, pickup.lng) * M_PER_MILE);
  if (status !== "good") return { ok: false, meters, reason: "Your GPS is not accurate enough yet. Go outside or turn on precise location." };
  if (meters > ARRIVE_MAX_METERS) return { ok: false, meters, reason: `You are ${meters} m from the pickup. Get within ${ARRIVE_MAX_METERS} m to mark arrival.` };
  return { ok: true, meters, reason: "" };
}

// The rider's own check of a claimed arrival, from the driver's last position update.
export function arrivalMismatch(driverPos, pickup) {
  if (!driverPos || !pickup) return false;
  return haversineDistance(driverPos.lat, driverPos.lng, pickup.lat, pickup.lng) * M_PER_MILE > ARRIVE_CLAIM_SLACK_METERS;
}
