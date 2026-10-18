// ════════════════════════════════════════════════════════════
//  UNITS — Miles or kilometers, the person's choice (Account → Units). It changes only what is SHOWN and typed.
//  Everything that is stored, signed or paid stays in miles (the fare is per mile, the meter and the events count miles),
//  so a driver in kilometers and a rider in miles still agree to the cent.
//    getUnits() / setUnits("mi" | "km")   the saved choice (miles until changed; saved on this device, and in the encrypted backup)
//    useUnits()                           [units, setUnits] for a screen (re-renders when it changes)
//    formatDistance(miles, opts)          "7.3 mi" or "11.7 km"            (opts.digits: decimals, default 1)
//    distanceIn(miles) / milesFrom(x)     the number in the chosen unit, and back
//    unitName()                           "mi" | "km"                       rateLabel(): "per mile" | "per kilometer"
//    ratePerUnit(perMile) / perMileFrom(perUnit)   a price per mile shown as a price per unit, and back
//  Pure apart from the saved choice.
// ════════════════════════════════════════════════════════════

import { useSyncExternalStore } from "react";
import { getSetting, setSetting } from "../config/relays.js";

export const KM_PER_MILE = 1.609344;
const KEY = "units";

export const getUnits = () => (getSetting(KEY, "mi") === "km" ? "km" : "mi");
const listeners = new Set();
export function setUnits(u) {
  setSetting(KEY, u === "km" ? "km" : "mi");
  listeners.forEach((fn) => fn());
}
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("storage", (e) => { if (e.key === "nostrride_" + KEY) listeners.forEach((fn) => fn()); });
}
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useUnits = () => [useSyncExternalStore(subscribe, getUnits, () => "mi"), setUnits];

export const unitName = (u = getUnits()) => u;
export const rateLabel = (u = getUnits()) => (u === "km" ? "per kilometer" : "per mile");
export const distanceIn = (miles, u = getUnits()) => (u === "km" ? miles * KM_PER_MILE : miles);
export const milesFrom = (x, u = getUnits()) => (u === "km" ? x / KM_PER_MILE : x);
export const ratePerUnit = (perMile, u = getUnits()) => (u === "km" ? perMile / KM_PER_MILE : perMile);
export const perMileFrom = (perUnit, u = getUnits()) => (u === "km" ? perUnit * KM_PER_MILE : perUnit);

export function formatDistance(miles, { digits = 1, unit = getUnits() } = {}) {
  if (!Number.isFinite(miles)) return "–";
  return `${distanceIn(miles, unit).toFixed(digits)} ${unit}`;
}
