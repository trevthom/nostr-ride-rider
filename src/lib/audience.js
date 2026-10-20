// ════════════════════════════════════════════════════════════
//  AUDIENCE — Who gets a copy of a new ride request. A request is sealed (nostr/sealing.js), so it
//  reaches only people we choose: the online drivers near the pickup (nearest first). A person we
//  blocked is left out, and a driver who blocked us is not in the presence list at all (presence
//  hides itself). Pure: the caller passes the presence list. A driver who comes online later gets
//  the request when the rider's app next sees them (state/AudienceSync.jsx).
// ════════════════════════════════════════════════════════════

import { haversineDistance } from "./geo.js";

export const AUDIENCE_MILES = 100; // the widest radius a driver can set
export const AUDIENCE_LIMIT = 100; // most people one request is sent to in all; more would make it heavy to send

// `people`: presence entries { pubkey, lat, lng }. `content`: the request's content (coarse pickup).
// Presence is self-reported and anyone can make a key, so "the nearest 60" could all be fakes standing at the pickup, and no real
// driver would ever see the request. So the choice is mixed:
//   1. people the rider vouches for, or whom the rider's vouches vouch for (`trusted(pubkey)`), first, up to a third of the places;
//   2. then the nearest, up to half of what is left;
//   3. then the rest of the places, drawn AT RANDOM from everyone else within the radius.
// `limit` = how many more people this call may add (the caller subtracts those who already hold the request).
export function audienceFor(content, people, { me, blocked = [], limit = AUDIENCE_LIMIT, trusted = () => false, random = Math.random } = {}) {
  const p = content?.pickup;
  if (!p || typeof p.lat !== "number" || typeof p.lng !== "number" || limit <= 0) return [];
  const hidden = new Set((blocked || []).map((b) => (typeof b === "string" ? b : b.pubkey)));
  const near = (people || [])
    .filter((x) => x.pubkey !== me && !hidden.has(x.pubkey))
    .map((x) => ({ pubkey: x.pubkey, miles: haversineDistance(p.lat, p.lng, x.lat, x.lng) }))
    .filter((x) => Number.isFinite(x.miles) && x.miles <= AUDIENCE_MILES)
    .sort((a, b) => a.miles - b.miles);
  const out = [];
  const take = (list, n) => { for (const x of list) { if (n <= 0) break; out.push(x.pubkey); n--; } };
  const known = near.filter((x) => trusted(x.pubkey));
  take(known, Math.ceil(limit / 3));
  const rest = near.filter((x) => !out.includes(x.pubkey));
  take(rest, Math.ceil((limit - out.length) / 2));
  const pool = near.filter((x) => !out.includes(x.pubkey));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  take(pool, limit - out.length);
  return out;
}

// The online driver closest to `point` ({lat,lng}): the presence entry, or null when there is none. ("Notify nearest driver immediately".)
export function nearestDriver(drivers, point) {
  if (!point || typeof point.lat !== "number" || typeof point.lng !== "number") return null;
  let best = null, bestMiles = Infinity;
  for (const d of drivers || []) {
    const miles = haversineDistance(point.lat, point.lng, d.lat, d.lng);
    if (Number.isFinite(miles) && miles < bestMiles) { best = d; bestMiles = miles; }
  }
  return best;
}
