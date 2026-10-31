// ════════════════════════════════════════════════════════════
//  FARE — Price estimates for a trip, and the checks on a driver's rates.
//
//  Every driver sets their own rates: a base amount (paid when the ride starts), a
//  price per mile and a price per minute, in THEIR currency (lib/currency.js). The
//  ride is then paid tick by tick at those rates (lib/ticks.js), so the fare is
//  exactly  base + per mile × miles + per minute × minutes  with no minimum.
//  The numbers here are only ESTIMATES shown before the ride:
//    • the suggested price for a trip comes from the drivers nearby (their MEDIAN; the
//      app's own rates are the fallback);
//    • the rider picks a driver and pays that driver's standard fare, tick by tick (RIDE_OFFER
//      `priceSats` is the driver's estimate).
//  Sats are the source of truth. Pure functions, no network: the BTC prices are passed in
//  (a price is "units of that currency per 1 BTC").
// ════════════════════════════════════════════════════════════

import { FARE_RATES, FALLBACK_BTC_USD, RATE_LIMITS, LOW_BALANCE_USD } from "../config/settings.js";
import { CURRENCIES, DEFAULT_CURRENCY, isCurrency, satsFromFiat, fiatFromSats } from "./currency.js";

const AVG_CITY_MPH = 24; // for time/ETA guesses when no routing result exists
const DETOUR = 1.3; // straight line → road distance

// Road miles guessed from a straight-line distance.
export const roadMiles = (straightMiles) => straightMiles * DETOUR;

// Driving minutes guessed from road miles.
export const driveMinutes = (miles) => Math.max(1, Math.round((miles / AVG_CITY_MPH) * 60));

// base + per mile × miles + per minute × minutes, in the currency of the rates, to the cent.
export function fareAmount(miles, minutes, rates = FARE_RATES) {
  const raw = rates.base + rates.perMile * miles + rates.perMinute * minutes;
  return Math.round(raw * 100) / 100;
}

// The app's own rates are in dollars.
export const APP_RATES = { base: FARE_RATES.base, perMile: FARE_RATES.perMile, perMinute: FARE_RATES.perMinute, currency: DEFAULT_CURRENCY };

// Dollars → sats at `usdPrice`, rounded to 100 sats so amounts look clean.
export function usdToSats(usd, usdPrice) {
  if (!usdPrice) return 0;
  return Math.max(100, Math.round(((usd / usdPrice) * 1e8) / 100) * 100);
}

// A quote at the app's own rates. `live` is false when the fallback BTC price was used.
export function quoteFare({ miles, minutes }, usdPrice, rates = APP_RATES) {
  const usd = fareAmount(miles, minutes, rates);
  const price = usdPrice || FALLBACK_BTC_USD;
  return { usd, sats: usdToSats(usd, price), live: !!usdPrice };
}

// Minutes for a driver to reach a pickup `miles` away (straight line).
export function pickupEta(miles) {
  return driveMinutes(roadMiles(miles));
}

// A driver's rates, checked: { base, perMile, perMinute, currency } — amounts in that currency (cents at most),
// each between 0 and its limit (the limits are in dollars and are scaled for other currencies). Anything else
// (junk from a relay, a missing field, an unknown currency) → null. A missing currency means dollars.
export function normalizeRates(r) {
  if (!r || typeof r !== "object") return null;
  const currency = r.currency === undefined ? DEFAULT_CURRENCY : r.currency;
  if (!isCurrency(currency)) return null;
  const scale = CURRENCIES[currency].scale;
  const out = {};
  for (const key of ["base", "perMile", "perMinute"]) {
    const n = typeof r[key] === "string" && r[key].trim() !== "" ? Number(r[key]) : r[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > RATE_LIMITS[key] * scale) return null;
    out[key] = Math.round(n * 100) / 100;
  }
  out.currency = currency;
  return out;
}

// What a driver typically charges for a trip, in the currency of their rates. Drivers with no rates use the app's.
export function typicalFare(rates, miles, minutes) {
  return fareAmount(miles, minutes, normalizeRates(rates) || APP_RATES);
}
export const ratesOrApp = (rates) => normalizeRates(rates) || APP_RATES;

// The same, in sats, at `prices` (code → BTC price). null when the price of that currency is unknown.
export function typicalSats(rates, miles, minutes, prices) {
  const r = ratesOrApp(rates);
  const price = prices?.[r.currency] || (r.currency === DEFAULT_CURRENCY ? FALLBACK_BTC_USD : null);
  return satsFromFiat(fareAmount(miles, minutes, r), price);
}

// The rider's OWN estimate of what an offer will cost: the driver's rates applied to the trip in the request, at the current price.
// An offer's `priceSats` is only the driver's word. The charge follows the rates, so the number a rider sees (and ranks drivers by)
// must come from the rates too; a driver could write a low `priceSats` next to high rates. null when rates, trip or price are missing.
export function offerEstimate(offerContent, requestContent, prices) {
  const rates = normalizeRates(offerContent?.rates);
  const miles = Number(requestContent?.distanceMiles), minutes = Number(requestContent?.durationMin);
  if (!rates || !Number.isFinite(miles) || miles < 0 || !Number.isFinite(minutes) || minutes < 0) return null;
  const price = prices?.[rates.currency];
  return price ? satsFromFiat(fareAmount(miles, minutes, rates), price) : null;
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Amount <-> sats, exact (no rounding to a round number): an offer of $6.37 is whatever sats that is at
// the current price, and shows back as $6.37. `price` = the BTC price in that currency (USD names kept for the tests).
export function satsFromUsd(usd, usdPrice) {
  const rate = usdPrice || FALLBACK_BTC_USD;
  return Math.max(1, satsFromFiat(usd, rate) ?? 1);
}
export function usdFromSats(sats, usdPrice) {
  return fiatFromSats(sats, usdPrice || FALLBACK_BTC_USD, DEFAULT_CURRENCY);
}

// ── During a ride ──

// A rider's ecash is "low" at LOW_BALANCE_USD or less (US dollars at the live price; the fallback price when it is unknown).
export const lowBalanceSats = (usdPrice) => satsFromUsd(LOW_BALANCE_USD, usdPrice);
export const isLowBalance = (sats, usdPrice) => Number.isFinite(sats) && sats <= lowBalanceSats(usdPrice);

// A rider may plan and request a ride only with at least LOW_BALANCE_USD in the wallet (exactly $5 is enough).
// `sats` must be a known balance: null (the wallet is still loading) is not enough.
export const hasRideFunds = (sats, usdPrice) => Number.isFinite(sats) && sats >= lowBalanceSats(usdPrice);

// A request or a ride that has not started is cancelled by itself when the wallet falls BELOW the amount needed
// to request one. Once the ride is `riding` the base rate has been charged, and the ride continues.
export const shouldCancelForLowWallet = ({ status, stage, sats, usdPrice }) =>
  (status === "requested" || status === "in_progress") && stage !== "riding" && Number.isFinite(sats) && !hasRideFunds(sats, usdPrice);

// How much the fare changes when the REST of the trip goes from `before` to `after` ({ miles, minutes } each), at one driver's rates:
// per mile × the change in miles + per minute × the change in minutes. The base rate does not change. Signed, in sats at `price`
// (the BTC price in the currency of the rates); null when the rates or the price are not known. This is an ESTIMATE: the road and the traffic decide.
export function fareChangeSats(rates, before, after, price) {
  const r = normalizeRates(rates);
  if (!r || !before || !after || !(price > 0)) return null;
  const fiat = r.perMile * (after.miles - before.miles) + r.perMinute * (after.minutes - before.minutes);
  if (!Number.isFinite(fiat)) return null;
  return Math.sign(fiat) * satsFromFiat(Math.abs(fiat), price);
}
