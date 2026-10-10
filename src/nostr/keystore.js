// ════════════════════════════════════════════════════════════
//  KEYSTORE — Optional "remember me on this device". The secret key
//  is saved ONLY encrypted with the user's password (NIP-49
//  "ncryptsec", scrypt + XChaCha20), never in clear. On reload the
//  app asks for the password to unlock it. Logging out removes it.
// ════════════════════════════════════════════════════════════

import { getPublicKey } from "nostr-tools";
import { encrypt, decrypt } from "nostr-tools/nip49";
import { IS_DRIVER_APP } from "../config/app.js";

// Each app keeps its own saved key, so the rider and driver apps can run on
// one origin without overwriting each other. (The rider app keeps the
// original name, so keys saved before the split still unlock.)
const KEY = IS_DRIVER_APP ? "nostrride_driver_key" : "nostrride_key";
export const MIN_PASSWORD = 8;

// { ncryptsec, pubkey, name } or null.
export function getSavedKey() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v && typeof v.ncryptsec === "string" ? v : null;
  } catch {
    return null;
  }
}

export function saveKey(sk, password, { name = "" } = {}) {
  const ncryptsec = encrypt(sk, password, 16);
  try {
    localStorage.setItem(KEY, JSON.stringify({ ncryptsec, pubkey: getPublicKey(sk), name }));
  } catch {
    /* storage blocked (private mode) — stay logged in for this tab only */
  }
}

// Returns the secret key bytes. Throws "Wrong password." on failure.
export function unlockKey(password) {
  const saved = getSavedKey();
  if (!saved) throw new Error("No saved key on this device.");
  try {
    return decrypt(saved.ncryptsec, password);
  } catch {
    throw new Error("Wrong password.");
  }
}

export function forgetKey() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
