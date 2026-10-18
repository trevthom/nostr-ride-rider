// ════════════════════════════════════════════════════════════
//  AUDIENCE STORE — What the sender's app remembers about its own sealed requests:
//  the online drivers last seen (`getPeople`, filled by state/AudienceSync.jsx), who
//  already received each request (`getAudience`, kept on this device so a reload does not
//  resend to everyone), and who answered it (`answerersOf`, from the cache). Later versions of
//  a request (accepted, closed) go to all of them, so a driver who was not chosen sees the
//  request is gone.
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";

const KEY = "nostrride_audience";
const MAX_REQUESTS = 60;
let people = [];

export const setPeople = (list) => { people = Array.isArray(list) ? list : []; };
export const getPeople = () => people;

function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } }

// Public keys that already hold request `d`.
export function getAudience(d) { const v = load()[d]; return Array.isArray(v) ? v : []; }

export function addAudience(d, pks) {
  if (!d || !pks?.length) return;
  const all = load();
  all[d] = [...new Set([...(all[d] || []), ...pks])];
  const keys = Object.keys(all);
  if (keys.length > MAX_REQUESTS) for (const k of keys.slice(0, keys.length - MAX_REQUESTS)) delete all[k]; // oldest first
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* no storage */ }
}

// Drivers who answered one of my request versions with an offer.
export function answerersOf(d, me) {
  const ids = relay.query({ kinds: [EVENT_KINDS.RIDE_REQUEST], authors: [me], "#d": [d] }).map((e) => e.id);
  if (!ids.length) return [];
  return [...new Set(relay.query({ kinds: [EVENT_KINDS.RIDE_OFFER], "#e": ids }).map((e) => e.pubkey))];
}
