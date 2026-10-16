// ════════════════════════════════════════════════════════════
//  START CODE — A ride starts only when the rider is at the driver's car. When
//  the driver arrives, the DRIVER's phone shows a random 4-digit code, and the
//  RIDER types it on the rider's phone (a signed "code" confirmation). The
//  driver types nothing: "Start trip" unlocks when the rider's confirmation
//  arrives.
//  Nothing travels between the phones for this: the code is made from the
//  two people's shared NIP-44 secret and the ride, so both apps can work it
//  out, yet nobody else can. It is different for every ride.
//
//    startCode(sk, otherPubkey, rideKey) → "0731"
//    checkCode(typed, expected)          → boolean
//    attemptGate                          a wrong guess locks typing for a while (10,000 codes only)
// ════════════════════════════════════════════════════════════

import { nip44 } from "nostr-tools";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const enc = new TextEncoder();
export const CODE_DIGITS = 4;
const CODES = 10 ** CODE_DIGITS;

export function startCode(sk, otherPubkey, rideKey) {
  const key = nip44.getConversationKey(sk, otherPubkey);
  const mac = hmac(sha256, key, enc.encode(`nostrride-start4|${rideKey}`));
  const n = ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0;
  return String(n % CODES).padStart(CODE_DIGITS, "0");
}

export const checkCode = (typed, expected) => {
  const t = String(typed || "").trim();
  return t.length === CODE_DIGITS && /^\d+$/.test(t) && t === expected;
};

// 10,000 codes exist, so guessing must be slow: the 3rd wrong try locks typing for 30 s, the next for 60 s, and so on.
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
