// ════════════════════════════════════════════════════════════
//  SEALING — Gift wraps for every job event, so a relay cannot read what a ride
//  is about. The signed event (the "inner" event) is encrypted with NIP-44 to ONE person and
//  put inside a kind-1059 event signed by a throwaway key made for that one copy. The relay sees
//  only: a throwaway author, the recipient's key, a time and a blob. It cannot see the kind, the
//  tags, the ride, the place or the price.
//
//  Each person who must read an event gets their own wrap: the author (so a reload or a second
//  phone still works), every `p`-tagged person, and, for a request, the audience (the drivers
//  who may take it) and everyone who answered it. The receiving app unwraps, checks the
//  inner signature, and puts the inner event in its local cache, so the rest of the app reads the
//  same events it always did (lib/rides.js: trust rules unchanged).
//
//  What stays visible to a relay: who receives a wrap and when it was sent; presence (coarse,
//  public on purpose); vouch lists; profiles (kind 0). Not hidden: the SIZE of a wrap.
// ════════════════════════════════════════════════════════════

import { generateSecretKey, finalizeEvent, verifyEvent, nip44 } from "nostr-tools";
import { EVENT_KINDS } from "./eventKinds.js";

export const GIFT_WRAP = 1059;

const K = EVENT_KINDS;
// The kinds that are sent only inside wraps. Everything else (profile, presence, vouches, the encrypted
// location pings and the settings backup, which is already encrypted to the person's own key) keeps its own shape.
export const SEALED_KINDS = new Set([
  K.RIDE_REQUEST, K.RIDE_OFFER, K.RIDE_ACCEPT, K.RIDE_FINISH, K.RIDE_COMPLETE, K.RIDE_STAGE, K.RIDE_PAYMENT, K.RIDE_CONFIRM,
  K.RIDE_PICKUP_CHANGE, K.RIDE_PICKUP_REPLY, K.RIDE_TICK, K.RIDE_TICK_REPLY, K.RIDE_WAIVER, K.RIDE_ALIVE,
  K.RIDE_STOP_CHANGE, K.RIDE_STOP_REPLY, K.RIDE_OFFER_DECLINE, K.RIDE_DRIVER_DECLINE,
]);

const isHex = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

// One wrap of `inner` for `recipient` (hex pubkey). A new throwaway key every time.
export function wrap(inner, recipient, nowSec = Math.floor(Date.now() / 1000)) {
  const sk = generateSecretKey();
  const content = nip44.encrypt(JSON.stringify(inner), nip44.getConversationKey(sk, recipient));
  return finalizeEvent({ kind: GIFT_WRAP, created_at: nowSec, tags: [["p", recipient]], content }, sk);
}

// The inner event of a wrap addressed to us, or null (not for us, damaged, a bad signature, or not a job event).
export function unwrap(wrapEvent, mySk) {
  if (!wrapEvent || wrapEvent.kind !== GIFT_WRAP || typeof wrapEvent.content !== "string") return null;
  let inner;
  try { inner = JSON.parse(nip44.decrypt(wrapEvent.content, nip44.getConversationKey(mySk, wrapEvent.pubkey))); } catch { return null; }
  if (!inner || typeof inner !== "object" || !SEALED_KINDS.has(inner.kind)) return null;
  try { if (!verifyEvent(inner)) return null; } catch { return null; }
  return inner;
}

// Who gets a copy: the author, every person the event names with a `p` tag, and `extra` (the audience of a request).
export function recipientsOf(inner, extra = []) {
  const out = new Set();
  if (isHex(inner.pubkey)) out.add(inner.pubkey);
  for (const t of inner.tags || []) if (t[0] === "p" && isHex(t[1])) out.add(t[1]);
  for (const pk of extra) if (isHex(pk)) out.add(pk);
  return [...out];
}
