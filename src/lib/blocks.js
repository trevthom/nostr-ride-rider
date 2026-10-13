// ════════════════════════════════════════════════════════════
//  BLOCKS — A person's own block list: pubkeys they never want to deal with.
//  Pure helpers over the list (the app keeps it in localStorage). Blocking
//  is local to the app on this device: the blocked person is not told.
//    Driver app: a blocked rider's requests never appear.
//    Rider app:  a blocked driver's offers and car never appear.
//  It works BOTH ways ("they will not show up on the map to each other"): the blocker's own events carry
//  a list of HIDE TOKENS, one per blocked person. A token is a short hash of the blocker's key and the
//  other person's key, so the list does not name anyone, but each app can test itself:
//    a rider's ride request  → `hide` tokens of the drivers the rider blocked; their apps never list it
//    a driver's presence     → `hide` tokens of the riders the driver blocked; their apps never show the car
//  This is a courtesy between honest apps, not a lock: someone who changes their app can still read public events.
// ════════════════════════════════════════════════════════════

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const isBlocked = (list, pubkey) => list.some((b) => b.pubkey === pubkey);

export function addBlock(list, pubkey, name = "", at = Date.now()) {
  if (!pubkey || isBlocked(list, pubkey)) return list;
  return [...list, { pubkey, name: String(name || "").slice(0, 60), at }].slice(-500);
}

export const removeBlock = (list, pubkey) => list.filter((b) => b.pubkey !== pubkey);

// The token that says "`owner` blocked `other`". 16 hex characters are plenty to tell apart the few people on one list.
export const hideToken = (owner, other) => bytesToHex(sha256(utf8ToBytes(`nostrride-hide:${owner}:${other}`))).slice(0, 16);

// The tokens for a whole block list (newest 100), to put into an event.
export const hideList = (owner, list) => list.slice(-100).map((b) => hideToken(owner, b.pubkey));

// Did `owner` hide from `me`? `hide` is the list read from the owner's event (untrusted: anything that is not an array hides nobody).
export const hidesMe = (hide, owner, me) => Array.isArray(hide) && !!owner && !!me && hide.includes(hideToken(owner, me));
