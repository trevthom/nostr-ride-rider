// ════════════════════════════════════════════════════════════
//  GEO — Pure math helpers for distance.
//  No app logic here, just functions that take numbers in and
//  return numbers/booleans out. Easy to test, safe to reuse.
// ════════════════════════════════════════════════════════════

// Distance in miles between two lat/lng points (Haversine formula).
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
