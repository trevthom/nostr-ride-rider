// ════════════════════════════════════════════════════════════
//  EVENTS — Builds Nostr event objects.
//
//   • createNostrEvent : unsigned placeholder event (demo / local-only
//     cache). Fine because the in-memory cache doesn't verify sigs.
//   • buildSignedEvent : REAL signed event for sending to public relays.
//
//  Every action's content is stored as a JSON string (Nostr standard).
// ════════════════════════════════════════════════════════════

import { finalizeEvent, getPublicKey } from "nostr-tools";

// A random hex string, used for placeholder id/sig values (demo only).
function randomHex(length) {
  const arr = new Uint8Array(length / 2);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createNostrEvent(kind, content, tags, pubkey) {
  return {
    id: randomHex(64),
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind,
    tags,
    // Content is always stored as a JSON string (the Nostr standard).
    content: typeof content === "string" ? content : JSON.stringify(content),
    sig: randomHex(128), // placeholder signature (demo/local-only events)
  };
}

// Replaceable kinds (0, 10000–19999) and addressable kinds (30000–39999):
// a relay keeps only the newest event per (kind, author, d-tag), and on a
// timestamp tie it keeps the one with the LOWEST id. Two updates inside one
// second (say two profile saves) could therefore leave the older one on the
// relay, so each update gets a timestamp strictly after the previous one.
const lastStamp = new Map();
const isReplaceable = (kind) => kind === 0 || (kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000);

function stampFor(kind, tags, sk) {
  const now = Math.floor(Date.now() / 1000);
  if (!isReplaceable(kind)) return now;
  const key = `${kind}:${getPublicKey(sk)}:${(tags.find((t) => t[0] === "d") || [])[1] ?? ""}`;
  const at = Math.max(now, (lastStamp.get(key) || 0) + 1);
  lastStamp.set(key, at);
  return at;
}

// REAL, signed event — required for events sent to public relays so
// other relays/clients accept them. `sk` is the author's secret key
// (Uint8Array); finalizeEvent fills in pubkey, id, and a valid sig.
export function buildSignedEvent(kind, content, tags, sk) {
  return finalizeEvent(
    {
      kind,
      created_at: stampFor(kind, tags, sk),
      tags,
      content: typeof content === "string" ? content : JSON.stringify(content),
    },
    sk
  );
}
