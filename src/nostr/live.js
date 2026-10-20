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
//  NOTE: nostr-tools 2.25 takes ONE filter object in subscribeMany / querySync,
//  not an array of filters (an array reaches the relay as an invalid filter).
// ════════════════════════════════════════════════════════════

import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, nip44 } from "nostr-tools";
import { EVENT_KINDS, APP_TAG } from "./eventKinds.js";
import { getRelays, onRelaysChange } from "../config/relays.js";
import { hidesMe } from "../lib/blocks.js";

// maxWaitForConnection: the library's 3 s default DROPS a slow relay for good (see nostr/relay.js).
const pool = new SimplePool({ enablePing: true, enableReconnect: true, maxWaitForConnection: 15000 });

const PRESENCE_TTL_MS = 45000; // a driver is "gone" if silent this long
const nowSec = () => Math.floor(Date.now() / 1000);

// Round to ~100 m so public presence can't pinpoint someone.
const coarse = (n) => Math.round(n * 1000) / 1000;

// ── Presence (public) ───────────────────────────────────────

// When a presence beat counts as sent. The beat names its own time (`ts`), but the signed event has one too, and a driver could
// write a time far in the future: the car would then never expire from the riders' maps, and no later beat from it could replace it.
// So the beat's own time is believed only within a minute of the event's time.
export function presenceTs(createdAtSec, claimed) {
  const at = Number(createdAtSec) * 1000;
  const c = Number(claimed);
  if (!Number.isFinite(at)) return Date.now();
  return Number.isFinite(c) ? Math.min(Math.max(c, at - 60000), at + 60000) : at;
}

// Publish one presence beat. Call this on an interval while online.
// Addressable (d-tag "presence") so each driver has exactly one current
// presence on the relay, with a short expiration.
export async function publishPresence(user, { lat, lng, vehicle, rates, hide, gender }) {
  const content = JSON.stringify({
    name: user.name,
    npub: user.npub,
    vehicle: vehicle || "",
    ...(rates && { rates }), // the driver's own typical-fare rates (public, like the rest of presence)
    ...((gender === "male" || gender === "female") && { gender }), // optional, self-declared (also in the public profile): a rider can ask for "Female only" / "Male only"
    ...(hide?.length && { hide }), // tokens of the riders this driver blocked: their apps do not show this car (lib/blocks.js)
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
export function subscribePresence(onDrivers, { excludePubkey, viewerSk } = {}) {
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
      if (hidesMe(d.hide, ev.pubkey, viewerSk)) return; // this driver blocked me: they do not show up for me
      const prev = drivers.get(ev.pubkey);
      const ts = presenceTs(ev.created_at, d.ts);
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
    sub = pool.subscribeMany(getRelays(), filter, { onevent: take });
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
// `pm` and `tm` are the driver's odometers (miles to the pickup, miles on the trip).
export async function publishRideLocation(user, riderPubkey, { lat, lng, pm, tm }) {
  const key = nip44.getConversationKey(user.sk, riderPubkey);
  const content = nip44.encrypt(JSON.stringify({ lat, lng, ts: Date.now(), ...(Number.isFinite(pm) && { pm: Math.round(pm * 100) / 100 }), ...(Number.isFinite(tm) && { tm: Math.round(tm * 100) / 100 }) }), key);
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
      { kinds: [EVENT_KINDS.RIDE_LOCATION], authors: [driverPubkey], "#p": [user.publicKey], "#t": [APP_TAG] },
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

// ── Trip meter (encrypted, rider → matched driver) ───────────
// The rider's app works out the distances both screens show (lib/meter.js) and sends them to the
// driver's app, so the two screens agree. Ephemeral: only the latest matters.
export async function publishMeter(user, driverPubkey, { pm, tm }) {
  const key = nip44.getConversationKey(user.sk, driverPubkey);
  const content = nip44.encrypt(JSON.stringify({ ts: Date.now(), ...(Number.isFinite(pm) && { pm: Math.round(pm * 100) / 100 }), ...(Number.isFinite(tm) && { tm: Math.round(tm * 100) / 100 }) }), key);
  const event = finalizeEvent(
    {
      kind: EVENT_KINDS.RIDE_METER,
      created_at: nowSec(),
      tags: [["p", driverPubkey], ["t", APP_TAG], ["expiration", String(nowSec() + 60)]],
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

// Driver subscribes to the matched rider's meter. Calls onMeter({pm, tm, ts}). Returns unsubscribe.
export function subscribeMeter(user, riderPubkey, onMeter) {
  const key = nip44.getConversationKey(user.sk, riderPubkey);
  let sub = null;
  const open = () => {
    try { sub && sub.close(); } catch { /* ignore */ }
    sub = pool.subscribeMany(
      getRelays(),
      { kinds: [EVENT_KINDS.RIDE_METER], authors: [riderPubkey], "#p": [user.publicKey], "#t": [APP_TAG] },
      {
        onevent(ev) {
          try {
            onMeter(JSON.parse(nip44.decrypt(ev.content, key)));
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
