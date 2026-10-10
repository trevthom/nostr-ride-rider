// ════════════════════════════════════════════════════════════
//  APP SETTINGS — Start here to change how the app behaves.
//  Everything in this file is safe to edit.
// ════════════════════════════════════════════════════════════

// Fare estimate (USD). fare = base + per-mile × miles + per-minute × minutes,
// never below `minimum`. The rider app shows it before requesting; the driver
// app shows the same number on the incoming request. Tune freely.
export const FARE_RATES = { base: 2.0, perMile: 1.1, perMinute: 0.25, minimum: 5.0 };

// Used ONLY when the live BTC price can't be fetched, so a fare can still be
// quoted in sats. The rider sees a "price estimate" note when it is in use.
export const FALLBACK_BTC_USD = 100000;

// Share of the fare a driver asks for up front (paid on confirm, non-refundable
// if the rider cancels after the driver is on the way). Drivers can change it.
export const DEFAULT_DEPOSIT_PERCENT = 20;

// How long an incoming request card stays on the driver's screen before it
// is set aside (the request itself stays open for other drivers).
export const REQUEST_CARD_SECONDS = 45;

// A driver's "I'll take it" stays valid this long (seconds) for a ride that is
// needed now. After that the rider no longer sees it and the driver has to
// accept again, so nobody gets picked on a stale promise.
export const OFFER_TTL_SECONDS = 300;

// Safety sheet: the number the "Call emergency services" button dials.
export const EMERGENCY_NUMBER = "911";

// Driver app: within this many meters of the pickup (or dropoff) the app suggests
// "I've arrived" (or "Complete trip").
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
