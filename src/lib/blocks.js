// ════════════════════════════════════════════════════════════
//  BLOCKS — A person's own block list: pubkeys they never want to deal with.
//  Pure helpers over the list (the app keeps it in localStorage). Blocking
//  is local to the app on this device: the blocked person is not told.
//    Driver app: a blocked rider's requests never appear.
//    Rider app:  a blocked driver's offers and car never appear.
//  It works BOTH ways ("they will not show up on the map to each other"): the blocker's own events carry
//  a list of HIDE TOKENS, one per blocked person. A token is a keyed hash made from the secret the blocker and the
//  other person SHARE (their NIP-44 conversation key), so it names no one and nobody else can test it: a stranger who knows
//  both public keys cannot tell whether one blocked the other. Each side can work it out for itself:
//    a rider's ride request  → `hide` tokens of the drivers the rider blocked; their apps never list it
//    a driver's presence     → `hide` tokens of the riders the driver blocked; their apps never show the car
//  This is a courtesy between honest apps, not a lock: someone who changes their app can still read public events.
// ════════════════════════════════════════════════════════════

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { nip44 } from "nostr-tools";

export const isBlocked = (list, pubkey) => list.some((b) => b.pubkey === pubkey);

export function addBlock(list, pubkey, name = "", at = Date.now()) {
  if (!pubkey || isBlocked(list, pubkey)) return list;
  return [...list, { pubkey, name: String(name || "").slice(0, 60), at }].slice(-500);
}

export const removeBlock = (list, pubkey) => list.filter((b) => b.pubkey !== pubkey);

// The secret two people share, kept per reader key (working it out costs a little; screens ask on every render).
const shared = new WeakMap(); // sk → Map(pubkey → conversation key | null)
function sharedKey(sk, pubkey) {
  let m = shared.get(sk);
  if (!m) shared.set(sk, (m = new Map()));
  if (!m.has(pubkey)) {
    let k = null;
    try { k = nip44.getConversationKey(sk, pubkey); } catch { /* not a usable public key */ }
    m.set(pubkey, k);
  }
  return m.get(pubkey);
}

// The token that says "the owner of `sk` blocked `other`". 16 hex characters are plenty to tell apart the few people on one list.
// null when `other` is not a usable public key.
export function hideToken(sk, other) {
  const key = sharedKey(sk, other);
  return key ? bytesToHex(hmac(sha256, key, utf8ToBytes("nostrride-hide"))).slice(0, 16) : null;
}

// The tokens for a whole block list (newest 100), to put into an event. `sk` = the blocker's secret key.
export const hideList = (sk, list) => list.slice(-100).map((b) => hideToken(sk, b.pubkey)).filter(Boolean);

// Did `owner` hide from me? `hide` is the list read from the owner's event (untrusted: anything that is not an array hides nobody).
// `sk` = MY secret key: the token is made from the secret the owner and I share.
export const hidesMe = (hide, owner, sk) => {
  if (!Array.isArray(hide) || !owner || !sk) return false;
  const token = hideToken(sk, owner);
  return !!token && hide.includes(token);
};
