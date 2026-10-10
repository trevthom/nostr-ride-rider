// ════════════════════════════════════════════════════════════
//  LIVE — Real-time location over REAL Nostr relays.
//
//  This is the one part of the app that talks to real relays (the
//  list in config/relays.js), because live location only makes
//  sense across devices/people. It uses signed EPHEMERAL events
//  (kinds 20000–29999) which relays forward to current subscribers
//  but never store — so no location history is left behind.
//
//  Two channels:
//    • Presence (public)  — "I'm an online driver near here". Location
//      is COARSENED (~100 m) on purpose; exact position is never made
//      public. Used for the nearby-drivers map.
//    • Ride location (encrypted) — exact position shared ONLY with the
//      matched rider, end-to-end encrypted with NIP-44.
//
//  Subscriptions re-open automatically if the relay list changes.
// ════════════════════════════════════════════════════════════

import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, nip44 } from "nostr-tools";
import { EVENT_KINDS, APP_TAG } from "./eventKinds.js";
import { getRelays, onRelaysChange } from "../config/relays.js";

const pool = new SimplePool({ enablePing: true, enableReconnect: true });

const PRESENCE_TTL_MS = 45000; // a driver is "gone" if silent this long
const nowSec = () => Math.floor(Date.now() / 1000);

// Round to ~100 m so public presence can't pinpoint someone.
const coarse = (n) => Math.round(n * 1000) / 1000;

// ── Presence (public) ───────────────────────────────────────

// Publish one presence beat. Call this on an interval while online.
// Addressable (d-tag "presence") so each driver has exactly one current
// presence on the relay, with a short expiration.
export async function publishPresence(user, { lat, lng, vehicle }) {
  const content = JSON.stringify({
    name: user.name,
    npub: user.npub,
    vehicle: vehicle || "",
    lat: coarse(lat),
    lng: coarse(lng),
    ts: Date.now(),
  });
  const event = finalizeEvent(
    {
      kind: EVENT_KINDS.PRESENCE,
      created_at: nowSec(),
      tags: [["d", "presence"], ["t", "driver-presence"], ["t", APP_TAG], ["expiration", String(nowSec() + 90)]],
      content,
    },
    user.sk
  );
  try {
    await Promise.allSettled(pool.publish(getRelays(), event));
  } catch {
    /* offline / relay error — ignore; next beat will retry */
  }
}

// Subscribe to all online drivers. Calls onDrivers(list) on changes.
// Pulls the current set first (querySync) THEN subscribes live, so a
// newly-opened device sees drivers who are already online. Stale drivers
// drop after TTL. Returns an unsubscribe function.
export function subscribePresence(onDrivers, { excludePubkey } = {}) {
  const drivers = new Map();
  let sub = null;
  let closed = false;

  const emit = () => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    for (const [key, d] of drivers) if (d.ts < cutoff) drivers.delete(key);
    onDrivers([...drivers.values()]);
  };

  const take = (ev) => {
    if (excludePubkey && ev.pubkey === excludePubkey) return;
    try {
      const d = JSON.parse(ev.content);
      if (typeof d.lat !== "number" || typeof d.lng !== "number") return;
      const prev = drivers.get(ev.pubkey);
      const ts = d.ts || Date.now();
      if (prev && prev.ts > ts) return; // keep the freshest
      drivers.set(ev.pubkey, { pubkey: ev.pubkey, ...d, ts });
      emit();
    } catch {
      /* ignore malformed presence */
    }
  };

  const open = () => {
    try { sub && sub.close(); } catch { /* ignore */ }
    const filter = { kinds: [EVENT_KINDS.PRESENCE], "#t": [APP_TAG], since: nowSec() - 120 };
    // Pull current presences once.
    pool.querySync(getRelays(), filter).then((evs) => { if (!closed) evs.forEach(take); }).catch(() => {});
    // Then stream updates.
    sub = pool.subscribeMany(getRelays(), [filter], { onevent: take });
  };

  open();
  const offChange = onRelaysChange(open); // reconnect if relays change
  const sweeper = setInterval(emit, 8000); // expire stale even with no new events
  return () => {
    closed = true;
    clearInterval(sweeper);
    offChange();
    try { sub && sub.close(); } catch { /* ignore */ }
  };
}

// ── Ride location (encrypted, driver → matched rider) ────────

// Driver publishes their exact location, encrypted to one rider.
export async function publishRideLocation(user, riderPubkey, { lat, lng }) {
  const key = nip44.getConversationKey(user.sk, riderPubkey);
  const content = nip44.encrypt(JSON.stringify({ lat, lng, ts: Date.now() }), key);
  const event = finalizeEvent(
    {
      kind: EVENT_KINDS.RIDE_LOCATION,
      created_at: nowSec(),
      tags: [["p", riderPubkey], ["t", APP_TAG], ["expiration", String(nowSec() + 60)]],
      content,
    },
    user.sk
  );
  try {
    await Promise.allSettled(pool.publish(getRelays(), event));
  } catch {
    /* ignore */
  }
}

// Rider subscribes to the matched driver's encrypted location.
// Calls onLocation({lat,lng,ts}). Returns an unsubscribe function.
export function subscribeRideLocation(user, driverPubkey, onLocation) {
  const key = nip44.getConversationKey(user.sk, driverPubkey);
  let sub = null;

  const open = () => {
    try { sub && sub.close(); } catch { /* ignore */ }
    sub = pool.subscribeMany(
      getRelays(),
      [{ kinds: [EVENT_KINDS.RIDE_LOCATION], authors: [driverPubkey], "#p": [user.publicKey], "#t": [APP_TAG] }],
      {
        onevent(ev) {
          try {
            onLocation(JSON.parse(nip44.decrypt(ev.content, key)));
          } catch {
            /* ignore undecryptable */
          }
        },
      }
    );
  };

  open();
  const offChange = onRelaysChange(open);
  return () => {
    offChange();
    try { sub && sub.close(); } catch { /* ignore */ }
  };
}
