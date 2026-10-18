// ════════════════════════════════════════════════════════════
//  MILEAGE — Total miles a person has driven, counted from their own finished
//  rides (the meter at the finish; the quoted trip if there is none).
//  Miles are stored in miles; lib/units.js only changes how they show.
//  The total goes into the person's own profile (kind 0 `stats`) so others can read it without
//  reading job events.
// ════════════════════════════════════════════════════════════

import { rideEnding, rideStatus } from "./rides.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const tenth = (n) => Math.round((Number(n) || 0) * 10) / 10;

// Miles of one finished ride: the meter if the finish carries it, else the trip as quoted.
export function rideMiles(request) {
  const m = Number(rideEnding(request)?.fin?.miles);
  return m > 0 ? m : Number(parse(request)?.distanceMiles) || 0;
}

// Miles of the rides this person drove and finished.
export function milesDriven(rideRequests, pubkey) {
  let total = 0;
  for (const r of rideRequests) if (parse(r)?.driverPubkey === pubkey && rideStatus(r) === "completed") total += rideMiles(r);
  return tenth(total);
}

// What a profile may carry: { miles } rounded to a tenth, or null when there is nothing to say.
export function statsOf(profile) {
  const m = Number(profile?.stats?.miles);
  return m > 0 && m < 1e7 ? { miles: tenth(m) } : null;
}
