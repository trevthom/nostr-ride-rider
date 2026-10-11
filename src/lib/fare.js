// ════════════════════════════════════════════════════════════
//  FARE — Price estimates for a trip, in USD and in sats.
//
//  Every driver can set their own "typical fare": a base amount, a price per
//  mile and a price per minute. Riders see these, so the suggested price for a
//  trip comes from the drivers nearby (the app's own rates are the fallback).
//  The rider names the price they want to pay, in any amount: that offer is
//  published in the ride request (`fareSats`). A driver accepts it or counters
//  with a higher one (RIDE_OFFER `priceSats`). Sats are the source of truth;
//  dollars are shown from the live BTC price. Pure functions, no network (the
//  BTC price is passed in).
// ════════════════════════════════════════════════════════════

import { FARE_RATES, FALLBACK_BTC_USD, MIN_OFFER_USD, MAX_OFFER_FACTOR, RATE_LIMITS } from "../config/settings.js";

const AVG_CITY_MPH = 24; // for time/ETA guesses when no routing result exists
const DETOUR = 1.3; // straight line → road distance

// Road miles guessed from a straight-line distance.
export const roadMiles = (straightMiles) => straightMiles * DETOUR;

// Driving minutes guessed from road miles.
export const driveMinutes = (miles) => Math.max(1, Math.round((miles / AVG_CITY_MPH) * 60));

// Fare in dollars for a trip of `miles` / `minutes`.
export function fareUsd(miles, minutes, rates = FARE_RATES) {
  const raw = rates.base + rates.perMile * miles + rates.perMinute * minutes;
  return Math.round(Math.max(rates.minimum, raw) * 100) / 100;
}

// Dollars → sats at `btcUsd`, rounded to 100 sats so amounts look clean.
export function usdToSats(usd, btcUsd) {
  if (!btcUsd) return 0;
  return Math.max(100, Math.round(((usd / btcUsd) * 1e8) / 100) * 100);
}

// A full quote. `live` is false when the fallback BTC price was used.
export function quoteFare({ miles, minutes }, btcUsd, rates = FARE_RATES) {
  const usd = fareUsd(miles, minutes, rates);
  const price = btcUsd || FALLBACK_BTC_USD;
  return { usd, sats: usdToSats(usd, price), live: !!btcUsd };
}

// The up-front deposit for a fare: `percent` of it, at least 1 sat unless 0%.
export function depositSats(fareSats, percent) {
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  return pct === 0 ? 0 : Math.max(1, Math.round((fareSats * pct) / 100));
}

// Minutes for a driver to reach a pickup `miles` away (straight line).
export function pickupEta(miles) {
  return driveMinutes(roadMiles(miles));
}

// A driver's rates, checked: { base, perMile, perMinute } in dollars (cents at most), each
// between 0 and its limit. Anything else (junk from a relay, a missing field) -> null.
export function normalizeRates(r) {
  if (!r || typeof r !== "object") return null;
  const out = {};
  for (const key of ["base", "perMile", "perMinute"]) {
    const n = typeof r[key] === "string" && r[key].trim() !== "" ? Number(r[key]) : r[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > RATE_LIMITS[key]) return null;
    out[key] = Math.round(n * 100) / 100;
  }
  return out;
}

// What a driver typically charges for a trip, in dollars. Drivers with no rates use the app's.
export function typicalFareUsd(rates, miles, minutes) {
  return fareUsd(miles, minutes, { ...FARE_RATES, ...(normalizeRates(rates) || {}) });
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Dollars <-> sats, exact (no rounding to a round number): an offer of $6.37 is whatever
// sats that is at the current price, and shows back as $6.37.
export function satsFromUsd(usd, btcUsd) {
  const rate = btcUsd || FALLBACK_BTC_USD;
  return Math.max(1, Math.round((usd / rate) * 1e8));
}
export function usdFromSats(sats, btcUsd) {
  const rate = btcUsd || FALLBACK_BTC_USD;
  return Math.round(sats * 1e-8 * rate * 100) / 100;
}

// The lowest and highest offer (in sats) for a trip whose suggested price is `suggestedSats`.
export function offerLimitsSats(suggestedSats, btcUsd) {
  const min = satsFromUsd(MIN_OFFER_USD, btcUsd);
  return { min, max: Math.max(min, Math.round(suggestedSats * MAX_OFFER_FACTOR)) };
}

// How an offer compares with the suggested price: "low" | "fair" | "high".
// "low" means more than 10% under it (drivers are likely to counter).
export function offerLevel(offerUsd, suggestedUsd) {
  if (offerUsd < suggestedUsd * 0.9) return "low";
  if (offerUsd > suggestedUsd * 1.1) return "high";
  return "fair";
}

// How a driver's reply relates to the rider's offer:
// "same" (accepted the price) | "counter" (asked for more) | "lower" (asked for less).
export function replyKind(priceSats, offeredSats) {
  if (!offeredSats || priceSats === offeredSats) return "same";
  return priceSats > offeredSats ? "counter" : "lower";
}
