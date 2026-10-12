// ════════════════════════════════════════════════════════════
//  GPS — How good is the device's location right now? Pure helpers (no
//  React) so they can be tested.
//
//  status:
//    searching  no fix yet
//    error      no fix and the browser reported a problem
//    good       fresh fix, accurate to GOOD_FIX_METERS or better
//    weak       fresh fix, but only accurate to a wider area (Wi-Fi / IP / indoors)
//    stale      the last fix is older than STALE_FIX_MS (tab asleep, signal lost)
//
//  A driver may go online, and be shown on the rider's map, with a "good" fix OR a
//  "weak" one that is still an APPROXIMATE location (phones can give apps only an
//  approximate location: accurate to a few km). The public presence is rounded to ~100 m
//  anyway. A fix worse than APPROX_FIX_METERS (a laptop's IP guess can be off by 50 km) is
//  too vague to show riders, and a stale or missing fix is never shown. Marking "I've arrived"
//  still needs a good fix (lib/arrival.js): 50 m cannot be judged from an approximate one.
// ════════════════════════════════════════════════════════════

export const GOOD_FIX_METERS = 200;
export const APPROX_FIX_METERS = 25000;
export const STALE_FIX_MS = 60000;

export function gpsStatus({ pos, seenAt, error }, now = Date.now()) {
  if (!pos) return error ? "error" : "searching";
  if (now - seenAt > STALE_FIX_MS) return "stale";
  return pos.accuracy > GOOD_FIX_METERS ? "weak" : "good";
}

// May a driver go online and show on the map with this fix? Good, or approximate but not too vague.
export const canBeOnline = (status, pos) => (status === "good" || status === "weak") && !!pos && pos.accuracy <= APPROX_FIX_METERS;

// For a driver who is online on an approximate fix: what riders see, and how to improve it.
export function approxNote(pos) {
  const meters = pos ? Math.round(pos.accuracy) : 0;
  const away = meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
  return `Approximate location (about ${away}). Riders see you in this area. For exact pickups, allow precise location.`;
}

// A short sentence for the screen (empty when the fix is good).
export function gpsMessage(status, pos, error) {
  const meters = pos ? Math.round(pos.accuracy) : 0;
  const away = meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
  if (status === "good") return "";
  if (status === "weak") return `Your location is only accurate to ${away}. Go outside or turn on precise location.`;
  if (status === "stale") return "Your location has not updated for a minute. Keep this screen open and check GPS.";
  if (status === "error") return error || "Your location is not available.";
  return "Finding your location…";
}

// Browser PositionError → something a person can act on.
export function geoErrorText(e) {
  if (e?.code === 1) return "Location is blocked. Allow location for this site in your browser settings.";
  if (e?.code === 2) return "Your device could not find its location.";
  if (e?.code === 3) return "Finding your location is taking too long.";
  return e?.message || "Couldn't get your location.";
}
