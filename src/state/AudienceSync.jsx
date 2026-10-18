// ════════════════════════════════════════════════════════════
//  AUDIENCE SYNC — Draws nothing. Requests are sealed, so only the people we send them to can see
//  them (lib/audience.js). This keeps a list of the drivers who are online, and when a
//  new one appears near a request of ours that still waits, sends them a copy (relay.sealTo).
//  The list is shared with `publish` (lib/audienceStore.js) for the first send.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppContext.jsx";
import { relay } from "../nostr/relay.js";
import { subscribePresence } from "../nostr/live.js";
import { audienceFor } from "../lib/audience.js";
import { setPeople, getPeople, getAudience, addAudience, answerersOf } from "../lib/audienceStore.js";
import { rideStatus, rideExpiryMs } from "../lib/rides.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const dOf = (e) => (e.tags.find((t) => t[0] === "d") || [])[1];

export default function AudienceSync() {
  const { user, rideRequests, blocked, liveTick } = useApp();
  const me = user?.publicKey;
  const [seen, setSeen] = useState("");
  const last = useRef("");

  // Who is online: drivers, near or far (the audience rule picks the near ones).
  useEffect(() => {
    if (!me) return undefined;
    return subscribePresence((list) => {
      setPeople(list);
      const key = list.map((p) => p.pubkey).sort().join(",");
      if (key !== last.current) { last.current = key; setSeen(key); }
    }, { excludePubkey: me, viewerPubkey: me });
  }, [me]);

  // A person we have not sent a waiting request to yet gets it now.
  useEffect(() => {
    if (!me) return;
    const now = Date.now();
    const mine = (rideRequests || []).filter((r) => r.pubkey === me && rideStatus(r) === "requested" && now < rideExpiryMs(parse(r), r.created_at));
    for (const r of mine) {
      const d = dOf(r);
      const c = parse(r);
      if (!d || !c) continue;
      const have = new Set([...getAudience(d), ...answerersOf(d, me)]);
      const fresh = audienceFor(c, getPeople(), { me, blocked }).filter((pk) => !have.has(pk));
      if (!fresh.length) continue;
      addAudience(d, fresh);
      relay.sealTo(r, fresh);
    }
  }, [me, seen, rideRequests, blocked, liveTick]);

  return null;
}
