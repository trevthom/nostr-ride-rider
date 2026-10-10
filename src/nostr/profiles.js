// ════════════════════════════════════════════════════════════
//  PROFILES — Look up a user's name, contacts, photo, Lightning
//  address, and vehicle by public key.
//  Reads the most recent Kind 0 (metadata) event for that user.
// ════════════════════════════════════════════════════════════

import { relay } from "./relay.js";
import { EVENT_KINDS } from "./eventKinds.js";

// The raw content of the user's NEWEST kind-0 (or null). Kind 0 is
// shared by every Nostr app, so writes must merge into this, not
// replace it, or we wipe fields other apps set (about, lud16, nip05…).
export function getMetadata(pubkey) {
  const events = relay.query({ kinds: [EVENT_KINDS.METADATA], authors: [pubkey] });
  if (events.length === 0) return null;
  // >= so the most recently stored wins a same-second tie (like latestVersions).
  const newest = events.reduce((a, b) => (b.created_at >= a.created_at ? b : a));
  try {
    const meta = JSON.parse(newest.content);
    return meta && typeof meta === "object" ? meta : null;
  } catch {
    return null;
  }
}

// Kind-0 content comes from untrusted relays, so coerce every field to
// the shape the screens render (a non-string name or an object plate
// would otherwise crash React).
const str = (v) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

export function getProfile(pubkey) {
  const meta = getMetadata(pubkey);
  if (!meta) return null;
  const v = meta.vehicle && typeof meta.vehicle === "object" ? meta.vehicle : null;
  return {
    name: str(meta.name),
    comm: (Array.isArray(meta.communication) ? meta.communication : [])
      .filter((c) => c && typeof c === "object")
      .map((c) => ({ platform: str(c.platform), handle: str(c.handle) })),
    picture: str(meta.picture),
    lud16: str(meta.lud16).trim(), // Lightning address: where riders pay this user
    gender: meta.gender === "male" || meta.gender === "female" ? meta.gender : "", // optional, self-declared
    vehicle: v && {
      picture: str(v.picture),
      plateState: str(v.plateState),
      plateNumber: str(v.plateNumber),
      year: str(v.year),
      make: str(v.make),
      model: str(v.model),
    },
  };
}
