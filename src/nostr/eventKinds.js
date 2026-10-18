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
  RIDE_FINISH: 30081, // Either person finishes the ride (no cancellations, no cancel fees)
  RIDE_COMPLETE: 30084, // A completed ride (published by the driver)
  RIDE_STAGE: 30085, // Driver progress on an accepted ride: arrived / riding
  RIDE_PAYMENT: 30086, // Rider's record of a payment (proof sealed to the driver): evidence
  RIDE_CONFIRM: 30087, // Rider's own confirmation: boarded / trip ended OK or a problem: evidence
  RIDE_PICKUP_CHANGE: 30093, // Rider asks to change the pickup while the driver is on the way (exact place sealed)
  RIDE_PICKUP_REPLY: 30094, // The assigned driver accepts or declines that change
  RIDE_TICK: 30095, // Rider -> driver: one ecash payment while the ride runs (token sealed to the driver)
  RIDE_TICK_REPLY: 30096, // Driver -> rider: that payment was received (or could not be redeemed)
  RIDE_WAIVER: 30097, // Driver -> rider: part of the fare is waived (the unpaid part, and/or ecash sent back)
  RIDE_ALIVE: 30098, // "Still riding" / "Still driving": a signed sign of life for the ride
  RIDE_STOP_CHANGE: 30099, // Rider asks to add a stop or change the destination mid-ride (place sealed)
  VOUCH_LIST: 30102, // "Your vouches": the people this person knows and trusts (public, replaceable, one p tag each)
  RIDE_OFFER_DECLINE: 30101, // The rider turns down ONE driver's offer; the request stays open for everyone else
  SETTINGS_BACKUP: 30111, // The person's own backup of vouches, blocks and settings, encrypted to their own key (lib/backup.js)
  RIDE_STOP_REPLY: 30100, // The assigned driver accepts the extra stop (or finishes the ride instead)
  RATING: 30082, // UNUSED: star ratings and reviews were removed (too easy to fake); see VOUCH_LIST
  DRIVER_ROUTE: 30083, // (removed feature; kept for back-compat)

  // Driver presence: addressable (replaceable per driver via d-tag), with a
  // short NIP-40 expiration. Stored on relays so other devices can PULL the
  // current set (more reliable cross-device than ephemeral events).
  PRESENCE: 30090, // public: a driver is online (approx location)

  // 30092 was the driver's license photo. It is no longer used or required.

  // Trip sharing: addressable, signed by a throwaway key made for one trip; the payload is
  // encrypted with that key, which lives only in the share link's #fragment.
  TRIP_SHARE: 30091,

  // Ephemeral (20000–29999): relays pass to live subscribers, not stored.
  RIDE_LOCATION: 21100, // encrypted: live location to the matched rider
  RIDE_METER: 21101, // encrypted: the rider's app tells the driver's app the agreed trip distances (lib/meter.js)
};
