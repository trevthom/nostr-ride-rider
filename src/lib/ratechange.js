// ════════════════════════════════════════════════════════════
//  RATE CHANGE — A driver may change their rates while a rider is deciding. The rider must never accept a higher price without seeing it.
//  This app remembers the rates the rider LAST SAW for each driver on each request (in memory: asking a driver from the list or the map,
//  opening their offer). When the rates in front of the rider differ from the rates they saw, the confirm screen stops and asks
//  (rider/screens/ActiveTrip.jsx). The offer the rider finally accepts is frozen (lib/terms.js agreedOffer), so this only protects the moment BEFORE.
//
//    rememberRates(d, driverPubkey, rates)   the rider has seen these rates (d = the request's d tag)
//    seenRates(d, driverPubkey)              the rates the rider last saw, or null
//    ratesChanged(before, now)               true when both are real rates and any of base / per mile / per minute / currency differs
//    rateDirection(before, now, miles, minutes)  "higher" | "lower" | "same": what the trip would cost under each
// ════════════════════════════════════════════════════════════

import { normalizeRates, fareAmount } from "./fare.js";

const seen = new Map();
const keyOf = (d, pk) => `${d}|${pk}`;
const sig = (r) => [r.currency, r.base, r.perMile, r.perMinute].join("|");

export function rememberRates(d, driverPubkey, rates) {
  const r = normalizeRates(rates);
  if (d && driverPubkey && r) seen.set(keyOf(d, driverPubkey), r);
}

export const seenRates = (d, driverPubkey) => seen.get(keyOf(d, driverPubkey)) || null;

export function ratesChanged(before, now) {
  const a = normalizeRates(before), b = normalizeRates(now);
  return !!a && !!b && sig(a) !== sig(b);
}

// Compare what the same trip costs: only when both are in one currency; otherwise the numbers cannot be compared and "different" is all we know.
export function rateDirection(before, now, miles, minutes) {
  const a = normalizeRates(before), b = normalizeRates(now);
  if (!a || !b || a.currency !== b.currency) return "different";
  const x = fareAmount(miles || 0, minutes || 0, a), y = fareAmount(miles || 0, minutes || 0, b);
  return y > x ? "higher" : y < x ? "lower" : sig(a) === sig(b) ? "same" : "different";
}
