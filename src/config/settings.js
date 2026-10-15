// ════════════════════════════════════════════════════════════
//  APP SETTINGS — Start here to change how the app behaves.
//  Everything in this file is safe to edit.
// ════════════════════════════════════════════════════════════

// The app's own rates (USD), used for a driver who has set none. A ride is paid tick by tick
// (lib/ticks.js): the base when the ride starts, then each mile and each minute at these rates.
// There is no minimum fare. The rider app shows the estimate before requesting; the driver
// app shows the same number on the incoming request. Tune freely.
export const FARE_RATES = { base: 2.0, perMile: 1.1, perMinute: 0.25 };

// Used ONLY when the live BTC price can't be fetched, so a fare can still be
// quoted in sats. The rider sees a "price estimate" note when it is in use.
export const FALLBACK_BTC_USD = 100000;

// A rider may offer a FLAT price instead of the driver's standard fare. The suggested price is only a
// starting point. A flat offer can be any amount (in the rider's currency, or sats), never below
// MIN_OFFER_USD and never above MAX_OFFER_FACTOR times the suggested price (this stops a typo from
// costing real money). A driver can accept the offer or counter with a higher price.
export const MIN_OFFER_USD = 3;
export const MAX_OFFER_FACTOR = 3;

// Each driver can set their own rates (base + per mile + per minute). These are the highest values
// they can enter (in dollars; other currencies are scaled, see lib/currency.js), so a typo cannot
// publish a silly rate.
export const RATE_LIMITS = { base: 50, perMile: 20, perMinute: 5 };

// How long an incoming request card stays on the driver's screen before it
// is set aside (the request itself stays open for other drivers).
export const REQUEST_CARD_SECONDS = 45;

// A driver's "I'll take it" stays valid this long (seconds) for a ride that is
// needed now. After that the rider no longer sees it and the driver has to
// accept again, so nobody gets picked on a stale promise.
export const OFFER_TTL_SECONDS = 300;

// How often a live position is sent, in milliseconds: the driver's exact position to the rider during a ride, and the rider's
// own position to the people following a shared trip (the same pace, so a friend sees the rider as fresh as the rider sees the car).
export const LOCATION_PING_MS = 6000;

// Safety sheet: the number the "Call emergency services" button dials.
export const EMERGENCY_NUMBER = "911";

// Driver app: within this many meters of the pickup (or dropoff) the app suggests
// "I've arrived" (or "Finish ride"). The "I've arrived" button itself works only within
// 50 m of the pickup (lib/arrival.js).
export const ARRIVE_RADIUS_METERS = 150;

// Driver app: only show requests with a pickup within this many miles.
export const DEFAULT_REQUEST_RADIUS_MILES = 15;

// The list of Nostr relays now lives in src/config/relays.js (it is
// editable in-app and saved to the browser). Import DEFAULT_RELAYS or
// getRelays() from there.

// When true, the app pre-loads a few fake riders and requests so you can
// see the full flow immediately. On only while developing (`npm run dev`)
// so real users never see fake riders. Set to false for a clean dev app.
export const USE_DEMO_DATA = import.meta.env?.DEV === true; // undefined under Node tests

// Contact platforms users can pick from in their profile.
export const CONTACT_PLATFORMS = ["Signal", "Telegram", "Phone", "WhatsApp"];
