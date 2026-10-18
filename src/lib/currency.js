// ════════════════════════════════════════════════════════════
//  CURRENCY — The local currency each person picks in Account. Charges are
//  stated in that currency and turned into sats at the BTC price of the
//  moment the charge happens. Sats stay the source of truth for money that
//  moves; the local currency is how people read it.
//
//    CURRENCIES            the supported codes (all have a CoinGecko price)
//    getCurrency()         the code now in use (saved on this device, default USD)
//    setCurrency(code)     change it; listeners are told
//    formatFiat(x, code?)  "$12.40", "12,40 €" (the current currency unless given)
//    toMinor / fromMinor   whole cents (or whole yen) <-> an amount
//    satsFromFiat / fiatFromSats  exact conversions at a BTC price in that currency
//    PRICE_CODES           the codes to ask the price feed for
//  Pure apart from the saved choice; the price itself comes from AppContext.
// ════════════════════════════════════════════════════════════

import { getSetting, setSetting } from "../config/relays.js";

// digits = places after the decimal point in everyday use. scale = roughly how many units equal one US dollar:
// it only widens the sanity limits on a driver's rates (RATE_LIMITS are in dollars); it is NEVER used as a price.
export const CURRENCIES = {
  USD: { symbol: "$", name: "US dollar", digits: 2, scale: 1 },
  EUR: { symbol: "€", name: "Euro", digits: 2, scale: 1 },
  GBP: { symbol: "£", name: "British pound", digits: 2, scale: 1 },
  CAD: { symbol: "$", name: "Canadian dollar", digits: 2, scale: 2 },
  AUD: { symbol: "$", name: "Australian dollar", digits: 2, scale: 2 },
  NZD: { symbol: "$", name: "New Zealand dollar", digits: 2, scale: 2 },
  CHF: { symbol: "CHF", name: "Swiss franc", digits: 2, scale: 1 },
  JPY: { symbol: "¥", name: "Japanese yen", digits: 0, scale: 200 },
  KRW: { symbol: "₩", name: "South Korean won", digits: 0, scale: 2000 },
  MXN: { symbol: "$", name: "Mexican peso", digits: 2, scale: 25 },
  BRL: { symbol: "R$", name: "Brazilian real", digits: 2, scale: 8 },
  INR: { symbol: "₹", name: "Indian rupee", digits: 2, scale: 100 },
  SEK: { symbol: "kr", name: "Swedish krona", digits: 2, scale: 12 },
  NOK: { symbol: "kr", name: "Norwegian krone", digits: 2, scale: 12 },
  DKK: { symbol: "kr", name: "Danish krone", digits: 2, scale: 8 },
  PLN: { symbol: "zł", name: "Polish zloty", digits: 2, scale: 5 },
  CZK: { symbol: "Kč", name: "Czech koruna", digits: 2, scale: 30 },
  ZAR: { symbol: "R", name: "South African rand", digits: 2, scale: 22 },
  NGN: { symbol: "₦", name: "Nigerian naira", digits: 2, scale: 2000 },
  TRY: { symbol: "₺", name: "Turkish lira", digits: 2, scale: 60 },
};
export const PRICE_CODES = Object.keys(CURRENCIES);
export const DEFAULT_CURRENCY = "USD";

export const isCurrency = (code) => typeof code === "string" && Object.prototype.hasOwnProperty.call(CURRENCIES, code);

let current = DEFAULT_CURRENCY;
try {
  const saved = getSetting("currency", DEFAULT_CURRENCY);
  if (isCurrency(saved)) current = saved;
} catch { /* no storage (tests) */ }
const listeners = new Set();

export const getCurrency = () => current;
export function setCurrency(code) {
  if (!isCurrency(code) || code === current) return;
  current = code;
  setSetting("currency", code);
  listeners.forEach((fn) => { try { fn(code); } catch { /* ignore */ } });
}
export function onCurrencyChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const digitsOf = (code = current) => (isCurrency(code) ? CURRENCIES[code].digits : 2);

// An amount in whole minor units (cents; yen has none). Always an integer.
export const toMinor = (amount, code = current) => Math.round(Number(amount) * 10 ** digitsOf(code));
export const fromMinor = (minor, code = current) => Number(minor) / 10 ** digitsOf(code);

const locale = () => (typeof navigator !== "undefined" && navigator.language) || "en-US";

// One formatter per currency (building one is slow). A browser that reports a language tag Intl rejects falls back to its default.
const formatters = new Map();
function formatterFor(code, digits) {
  const key = code + "|" + digits;
  if (!formatters.has(key)) {
    let f = null;
    for (const loc of [locale(), undefined]) {
      try { f = new Intl.NumberFormat(loc, { style: "currency", currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits }); break; } catch { /* try the next */ }
    }
    formatters.set(key, f);
  }
  return formatters.get(key);
}

// "$12.40". Below the smallest unit it says "<$0.01". Unknown code: shown as plain digits and the code.
export function formatFiat(amount, code = current) {
  if (amount == null || !Number.isFinite(Number(amount))) return "";
  const digits = digitsOf(code);
  const smallest = 10 ** -digits;
  if (Number(amount) > 0 && Number(amount) < smallest) return "<" + formatFiat(smallest, code);
  const f = formatterFor(code, digits);
  return f ? f.format(amount) : `${Number(amount).toFixed(digits)} ${code}`;
}

// Sats <-> an amount in a currency, at `price` (that currency per 1 BTC). Exact: no rounding to round numbers.
// A missing price is not guessed here: callers decide (null when unknown).
export function satsFromFiat(amount, price) {
  if (!price || !Number.isFinite(price) || price <= 0 || !Number.isFinite(amount)) return null;
  return Math.max(0, Math.round((amount / price) * 1e8));
}
export function fiatFromSats(sats, price, code = current) {
  if (!price || !Number.isFinite(price) || price <= 0 || sats == null || !Number.isFinite(sats)) return null;
  const digits = digitsOf(code);
  return Math.round(sats * 1e-8 * price * 10 ** digits) / 10 ** digits;
}

// Price feed: how long a saved price may be used when the feed is down (a ride must not stop because of it).
export const PRICE_MAX_AGE_MS = 24 * 3600000;

// ── A price feed that goes wrong ──
// The apps turn every charge into sats at the BTC price of the moment, and pay by themselves. A wrong price (a feed error, a
// glitch that returns 1 instead of 100,000) would make every tick far too large. So a new price that is more than 30% away
// from the last good one is NOT taken at once. It is kept as a suspect; if the same new level shows up on 3 fetches in a row
// (a real crash or jump does), it is accepted. Pure.
//    acceptPrices(prev, fetched, suspects) → { prices, suspects }      (prices: code → price; suspects: code → { value, n })
export const PRICE_JUMP = 0.3;
export const PRICE_CONFIRMS = 3;
export function acceptPrices(prev, fetched, suspects = {}) {
  const prices = { ...(prev || {}) };
  const nextSuspects = {};
  for (const [code, value] of Object.entries(fetched || {})) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    const old = prices[code];
    if (!old || Math.abs(value - old) / old <= PRICE_JUMP) { prices[code] = value; continue; }
    const sus = suspects[code];
    const n = sus && Math.abs(value - sus.value) / sus.value <= PRICE_JUMP ? sus.n + 1 : 1;
    if (n >= PRICE_CONFIRMS) prices[code] = value;
    else nextSuspects[code] = { value, n };
  }
  return { prices, suspects: nextSuspects };
}
