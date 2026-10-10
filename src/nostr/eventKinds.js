// ════════════════════════════════════════════════════════════
//  NOSTR EVENT KINDS — The "type" number on every Nostr event.
//  These are how the app tells a ride request apart from an offer.
//  Kind 0 is the Nostr standard for profiles; the 30078+ numbers
//  are in Nostr's "addressable" range.
//
//  IMPORTANT: kind numbers like 30078 (NIP-78) are ALSO used by other
//  Nostr apps on the public relays. So every event this app publishes
//  also carries an app tag (["t", APP_TAG]) and we filter relay reads
//  to that tag — otherwise we'd ingest unrelated apps' events (whose
//  content isn't our JSON) and crash when parsing them.
// ════════════════════════════════════════════════════════════

// Distinguishes this app's events from other apps sharing the same kinds.
export const APP_TAG = "nostrride";

export const EVENT_KINDS = {
  METADATA: 0, // User profile (name, contact methods)
  RIDE_REQUEST: 30078, // A rider asking for a ride
  RIDE_OFFER: 30079, // A driver offering to take a request
  RIDE_ACCEPT: 30080, // A rider accepting one offer
  RIDE_CANCEL: 30081, // A cancelled ride
  RIDE_COMPLETE: 30084, // A completed ride (published by the driver)
  RIDE_STAGE: 30085, // Driver progress on an accepted ride: arrived / riding
  RIDE_PAYMENT: 30086, // Rider's record of a payment (proof sealed to the driver): evidence
  RIDE_CONFIRM: 30087, // Rider's own confirmation: boarded / trip ended OK or a problem: evidence
  RATING: 30082, // A star rating + review
  DRIVER_ROUTE: 30083, // (removed feature; kept for back-compat)

  // Driver presence: addressable (replaceable per driver via d-tag), with a
  // short NIP-40 expiration. Stored on relays so other devices can PULL the
  // current set (more reliable cross-device than ephemeral events).
  PRESENCE: 30090, // public: a driver is online (approx location)

  // The driver's license photo: addressable (d = "license"), encrypted to the driver's own key,
  // so relays store only ciphertext. Never shown to anyone else.
  DRIVER_LICENSE: 30092,

  // Trip sharing: addressable, signed by a throwaway key made for one trip; the payload is
  // encrypted with that key, which lives only in the share link's #fragment.
  TRIP_SHARE: 30091,

  // Ephemeral (20000–29999): relays pass to live subscribers, not stored.
  RIDE_LOCATION: 21100, // encrypted: live location to the matched rider
};
