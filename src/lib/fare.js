// ════════════════════════════════════════════════════════════
//  FARE — Price estimates for a trip, in USD and in sats.
//
//  The rider app quotes a fare before requesting and publishes it in the
//  ride request (`fareSats`). A driver who taps Accept agrees to that
//  fare. Pure functions, no network (the BTC price is passed in).
// ════════════════════════════════════════════════════════════

import { FARE_RATES, FALLBACK_BTC_USD } from "../config/settings.js";

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
export function quoteFare({ miles, minutes }, btcUsd) {
  const usd = fareUsd(miles, minutes);
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
