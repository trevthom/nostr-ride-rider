// ════════════════════════════════════════════════════════════
//  START CODE — A ride starts only when both people are at the car. When
//  the rider reaches the driver's car, each phone shows its OWN random
//  2-digit code, and each person types the code they see on the OTHER
//  person's phone:
//    • the rider types the driver's code → signed "code" confirmation;
//    • the driver types the rider's code → unlocks "Start trip".
//  Nothing travels between the phones for this: the code of each person is
//  made from their shared NIP-44 secret and the ride, so both apps can work
//  it out, yet nobody else can. It is different for every ride and for each
//  of the two people.
//
//    startCode(sk, otherPubkey, rideKey, role) → "07"   (role = whose code: "rider" | "driver")
//    checkCode(typed, expected)                 → boolean
//    attemptGate                                 a wrong guess locks typing for a while (100 codes only)
// ════════════════════════════════════════════════════════════

import { nip44 } from "nostr-tools";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const enc = new TextEncoder();

export function startCode(sk, otherPubkey, rideKey, role) {
  const key = nip44.getConversationKey(sk, otherPubkey);
  const mac = hmac(sha256, key, enc.encode(`nostrride-start|${rideKey}|${role}`));
  const n = ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0;
  return String(n % 100).padStart(2, "0");
}

export const checkCode = (typed, expected) => /^\d{2}$/.test(String(typed || "").trim()) && String(typed).trim() === expected;

// Only 100 codes exist, so guessing must be slow: the 3rd wrong try locks typing for 30 s, the next for 60 s, and so on.
export const MAX_FREE_TRIES = 3;
export function attemptGate(state, nowMs) {
  const s = state || { wrong: 0, lockedUntil: 0 };
  return { open: nowMs >= s.lockedUntil, waitMs: Math.max(0, s.lockedUntil - nowMs) };
}
export function recordAttempt(state, ok, nowMs) {
  const s = state || { wrong: 0, lockedUntil: 0 };
  if (ok) return { wrong: 0, lockedUntil: 0 };
  const wrong = s.wrong + 1;
  const over = wrong - MAX_FREE_TRIES;
  return { wrong, lockedUntil: over >= 0 ? nowMs + 30000 * 2 ** Math.min(over, 6) : 0 };
}
