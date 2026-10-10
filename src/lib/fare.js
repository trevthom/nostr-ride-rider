// ════════════════════════════════════════════════════════════
//  FARE — Price estimates for a trip, in USD and in sats.
//
//  The rider app suggests a price from the trip's distance and time. The
//  rider can change it: the price the rider offers is published in the ride
//  request (`fareSats`). A driver accepts that price or counters with a higher
//  one (RIDE_OFFER `priceSats`). Pure functions, no network (the BTC price is
//  passed in).
// ════════════════════════════════════════════════════════════

import { FARE_RATES, FALLBACK_BTC_USD, OFFER_STEP_USD, MIN_OFFER_USD, MAX_OFFER_FACTOR } from "../config/settings.js";

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

// The lowest and highest price a rider (or a countering driver) can name,
// in whole dollars, for a trip with the suggested price `suggestedUsd`.
export function offerLimits(suggestedUsd) {
  const min = MIN_OFFER_USD;
  const max = Math.max(min, Math.ceil(suggestedUsd * MAX_OFFER_FACTOR));
  return { min, max };
}

// Move an offer up or down one step, inside the limits. Result in whole dollars.
export function stepOffer(usd, direction, suggestedUsd) {
  const { min, max } = offerLimits(suggestedUsd);
  const next = Math.round(usd / OFFER_STEP_USD) * OFFER_STEP_USD + direction * OFFER_STEP_USD;
  return Math.min(max, Math.max(min, next));
}

// Keep a typed offer inside the limits. Not a number -> the suggestion.
export function clampOffer(usd, suggestedUsd) {
  const { min, max } = offerLimits(suggestedUsd);
  const n = Number(usd);
  if (!Number.isFinite(n)) return Math.round(suggestedUsd);
  return Math.min(max, Math.max(min, Math.round(n)));
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
