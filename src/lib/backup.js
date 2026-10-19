// ════════════════════════════════════════════════════════════
//  BACKUP — The person's own vouches, blocked people and settings, kept on the relays as ONE encrypted note that only their
//  secret key can open (nip44 to their own key, so the nsec is the only thing to remember). A new phone that logs in with the
//  nsec gets everything back. Relays see that a note exists, its size and when it changed: nothing inside.
//
//  What goes in (BACKUP_KEYS): the block list, trusted contacts, currency, units, dark mode (application and map), request radius / alerts, gender
//  preference, the amount unit, the chosen mint, the relay list, "automatically cash out at", the on-chain deposit addresses
//  (quote ids and numbers only: a deposit sent to an address stays claimable on a new phone) and the vouch list. What NEVER goes in: ecash (its own 12 words), keys, the outbox, prices, trip leftovers, open/closed sections.
//  Pure maths and storage; the sending is state/useBackup.js.
//
//    collectBackup(me, nowMs)        → { v, at, settings: {key: value}, vouches: [hex] }   (a snapshot of this device)
//    applyBackup(data)               → puts every allowed setting back (unknown keys are ignored) and returns the keys it set
//    sealBackup(data, sk, pk) / openBackup(text, sk, pk)   the encrypted text, and back (null when it is not ours / damaged)
//    backupEvent(sealed)             the Nostr event content + tags
//    backupDigest(data)              a short fingerprint of the content (not the time): "has anything changed?"
// ════════════════════════════════════════════════════════════

import { nip44 } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getSetting, setSetting, getRelays, setRelays } from "../config/relays.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { vouchList } from "./vouches.js";

export const BACKUP_KEYS = ["blocked", "trustedContacts", "currency", "units", "dark", "darkMap", "requestRadius", "requestAlerts", "genderPref", "amountUnit", "ecashMint"];
export const BACKUP_PREFIXES = ["autoCashOut_", "onchain_"]; // onchain_<pk16>: deposit addresses (ids and numbers, no key, no coin)
const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_BACKUP_BYTES = 60000; // one nip44 message holds 64 KB

export const allowedKey = (k) => typeof k === "string" && (BACKUP_KEYS.includes(k) || BACKUP_PREFIXES.some((p) => k.startsWith(p) && k.length < 60));

// Every saved setting the backup may carry, read from this device.
function localKeys() {
  const out = new Set(BACKUP_KEYS);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("nostrride_")) { const bare = k.slice("nostrride_".length); if (allowedKey(bare)) out.add(bare); }
    }
  } catch { /* no storage */ }
  return [...out];
}

export function collectBackup(me, nowMs = Date.now()) {
  const settings = {};
  for (const k of localKeys()) {
    const v = getSetting(k, undefined);
    if (v !== undefined && v !== null) settings[k] = v;
  }
  settings.relays = getRelays().slice(0, 20);
  return { v: 1, at: nowMs, settings, vouches: vouchList(me).slice(0, 100) };
}

// The part that says whether anything CHANGED (not the time it was taken).
export const backupDigest = (data) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify({ s: data.settings, v: data.vouches })))).slice(0, 16);

export function applyBackup(data) {
  const done = [];
  if (!data || typeof data !== "object" || !data.settings || typeof data.settings !== "object") return done;
  for (const [k, v] of Object.entries(data.settings)) {
    if (k === "relays") {
      if (Array.isArray(v) && v.length && v.length <= 20 && v.every((u) => typeof u === "string" && /^wss?:\/\//.test(u))) { setRelays(v); done.push(k); }
    } else if (allowedKey(k) && v !== undefined) { setSetting(k, v); done.push(k); }
  }
  return done;
}

// The vouches a backup holds (clean hex keys only).
export const backupVouches = (data) => (Array.isArray(data?.vouches) ? [...new Set(data.vouches.filter((p) => HEX64.test(p)))].slice(0, 100) : []);

const ck = (sk, pk) => nip44.getConversationKey(sk, pk);
export function sealBackup(data, sk, pk) {
  const text = nip44.encrypt(JSON.stringify(data), ck(sk, pk));
  if (text.length > MAX_BACKUP_BYTES * 1.4) throw new Error("The backup is too large.");
  return text;
}
export function openBackup(text, sk, pk) {
  try {
    const d = JSON.parse(nip44.decrypt(text, ck(sk, pk)));
    return d && d.v === 1 && d.settings && typeof d.settings === "object" ? d : null;
  } catch { return null; }
}

export const backupEvent = (sealed) => ({ kind: EVENT_KINDS.SETTINGS_BACKUP, content: { v: 1, sealed }, tags: [["d", "backup"], ["t", "backup"]] });
