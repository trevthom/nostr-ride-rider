// ════════════════════════════════════════════════════════════
//  STRIKE KEY — Where the person's Strike API key is kept. The key can move money, so it is NEVER saved in the clear:
//  it is encrypted to the user's own Nostr key (NIP-44, the same way the ecash wallet is saved, nostr/ecash.js) and the blob
//  sits in this browser's storage. Without the user's key it cannot be opened, so it is useless to the next person on this
//  device. "Disconnect" erases it. Deleting the key in Strike's dashboard revokes it everywhere.
//
//  Also the two choices that go with it (plain settings, no secret):
//    strikeSource   which balance pays a rider's bill: "BTC" | "USD"
//    strikeReceive  what Strike keeps a driver's cash out as: "BTC" | "USD"
//    strikeDirect   rides are paid straight from / into Strike (no ecash mint), when both people allow it (default on)
// ════════════════════════════════════════════════════════════

import { nip44 } from "nostr-tools";
import { getSetting, setSetting } from "../config/relays.js";

const slot = (user) => "strike_" + user.publicKey.slice(0, 16);
const convKey = (user) => nip44.getConversationKey(user.sk, user.publicKey);

// What was pasted → the bare key (people paste "Bearer …", or with spaces and line breaks).
export function cleanStrikeKey(text) {
  return String(text ?? "").trim().replace(/^bearer\s+/i, "").replace(/\s+/g, "");
}
// A key is a long run of letters, digits and a few symbols. This only catches an obvious mistake; Strike decides if it works.
export const looksLikeKey = (k) => /^[A-Za-z0-9._~+/=-]{16,}$/.test(k);

export function saveStrikeKey(user, key) { setSetting(slot(user), nip44.encrypt(key, convKey(user))); }
export function loadStrikeKey(user) {
  const blob = getSetting(slot(user), null);
  if (typeof blob !== "string") return null;
  try { return nip44.decrypt(blob, convKey(user)); } catch { return null; }
}
export function eraseStrikeKey(user) { setSetting(slot(user), null); }

const CURRENCY = new Set(["BTC", "USD"]);
export const getStrikeSource = () => { const v = getSetting("strikeSource", "BTC"); return CURRENCY.has(v) ? v : "BTC"; };
export const setStrikeSource = (v) => { if (CURRENCY.has(v)) setSetting("strikeSource", v); };
export const getStrikeReceive = () => { const v = getSetting("strikeReceive", "BTC"); return CURRENCY.has(v) ? v : "BTC"; };
export const setStrikeReceive = (v) => { if (CURRENCY.has(v)) setSetting("strikeReceive", v); };
export const getStrikeDirect = () => getSetting("strikeDirect", true) !== false;
export const setStrikeDirect = (on) => setSetting("strikeDirect", !!on);
