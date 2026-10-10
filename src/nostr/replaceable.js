// ════════════════════════════════════════════════════════════
//  REPLACEABLE EVENTS — Keep only the newest version of each event.
//
//  Some events (ride requests, routes) carry a "d" tag and can be
//  re-published to change their status, e.g. a request going from
//  "requested" -> "in_progress" -> "cancelled". The relay stores
//  every version; this helper collapses them so the app only sees
//  the latest one per (kind + author + d-tag).
//
//  Events WITHOUT a "d" tag (like offers) are left untouched.
// ════════════════════════════════════════════════════════════

export function latestVersions(events) {
  const newestByKey = new Map();
  const passthrough = [];

  for (const event of events) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1];
    if (dTag == null) {
      passthrough.push(event); // not replaceable; keep as-is
      continue;
    }
    const key = `${event.kind}:${event.pubkey}:${dTag}`;
    const current = newestByKey.get(key);
    // >= so the most recently published wins on a timestamp tie.
    if (!current || event.created_at >= current.created_at) {
      newestByKey.set(key, event);
    }
  }

  return [...newestByKey.values(), ...passthrough];
}
