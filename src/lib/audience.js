// ════════════════════════════════════════════════════════════
//  AUDIENCE — Who gets a copy of a new ride request. A request is sealed (nostr/sealing.js), so it
//  reaches only people we choose: the online drivers near the pickup (nearest first). A person we
//  blocked is left out, and a driver who blocked us is not in the presence list at all (presence
//  hides itself). Pure: the caller passes the presence list. A driver who comes online later gets
//  the request when the rider's app next sees them (state/AudienceSync.jsx).
// ════════════════════════════════════════════════════════════

import { haversineDistance } from "./geo.js";

export const AUDIENCE_MILES = 100; // the widest radius a driver can set
export const AUDIENCE_LIMIT = 60; // nearest first; more would make a request heavy to send

// `people`: presence entries { pubkey, lat, lng }. `content`: the request's content (coarse pickup).
export function audienceFor(content, people, { me, blocked = [], limit = AUDIENCE_LIMIT } = {}) {
  const p = content?.pickup;
  if (!p || typeof p.lat !== "number" || typeof p.lng !== "number") return [];
  const hidden = new Set((blocked || []).map((b) => (typeof b === "string" ? b : b.pubkey)));
  return (people || [])
    .filter((x) => x.pubkey !== me && !hidden.has(x.pubkey))
    .map((x) => ({ pubkey: x.pubkey, miles: haversineDistance(p.lat, p.lng, x.lat, x.lng) }))
    .filter((x) => x.miles <= AUDIENCE_MILES)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit)
    .map((x) => x.pubkey);
}
