// ════════════════════════════════════════════════════════════
//  SPEND CAP — The most the rider's app pays on one ride without asking. The app pays everything that falls due, by
//  itself, every few seconds. That is right for a normal ride. If anything is wrong (a driver who claims too many miles, a
//  wrong BTC price, a bug), nothing would stop it before the wallet is empty. So each ride has a cap:
//    3 × the fare of the quoted trip at the agreed rates, and never less than 10 US dollars' worth of sats.
//  It is fixed when the ride's first payment is due (saved with the ride, so a later price jump cannot raise it). At the
//  cap the app stops and asks; "Allow more" adds one more cap's worth. Money already paid is never taken back.
//
//    rideSpendCap(request, { terms, price, usdPrice }) → sats | null   (null: no price yet, nothing can be paid anyway)
//    allowMoreSpend(request)                           raise this ride's cap by its first amount
// ════════════════════════════════════════════════════════════

import { getSetting, setSetting } from "../config/relays.js";
import { satsFromFiat } from "./currency.js";
import { fareAmount, satsFromUsd } from "./fare.js";
import { rideKey } from "./rides.js";

export const CAP_MULTIPLE = 3;
export const CAP_FLOOR_USD = 10;
const STORE = "rideCap";
const KEEP = 12;

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const load = () => { const all = getSetting(STORE, {}); return all && typeof all === "object" ? all : {}; };
const save = (key, rec) => setSetting(STORE, Object.fromEntries(Object.entries({ ...load(), [key]: rec }).slice(-KEEP)));

export function rideSpendCap(request, { terms, price, usdPrice }) {
  const key = rideKey(request);
  let rec = load()[key];
  if (!rec || !(rec.base > 0)) {
    const c = parse(request) || {};
    const miles = Number.isFinite(c.distanceMiles) ? c.distanceMiles : 0;
    const minutes = Number.isFinite(c.durationMin) ? c.durationMin : 0;
    const quoted = satsFromFiat(fareAmount(miles, minutes, terms), price);
    if (quoted == null) return null;
    const floor = usdPrice ? satsFromUsd(CAP_FLOOR_USD, usdPrice) : 0;
    rec = { base: Math.max(Math.round(quoted * CAP_MULTIPLE), floor), extra: 0 };
    save(key, rec);
  }
  return rec.base + (rec.extra || 0);
}

export function allowMoreSpend(request) {
  const key = rideKey(request);
  const rec = load()[key];
  if (rec && rec.base > 0) save(key, { base: rec.base, extra: (rec.extra || 0) + rec.base });
}
