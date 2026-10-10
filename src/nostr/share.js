// ════════════════════════════════════════════════════════════
//  SHARE — "Share my trip": a friend opens a link and watches the trip on
//  a map, with no account and no server.
//
//  How it works: the rider's app makes a THROWAWAY key for the trip. Every
//  few seconds it publishes an addressable event (kind 30091, replaced each
//  time, expires in 2 h) signed by that key, with the payload (car position,
//  driver, plate, destination, stage) encrypted to the key itself (NIP-44).
//  The link carries the key in its #fragment — a browser never sends the
//  fragment to a server — plus a few relays. Whoever has the link can read
//  the trip; nobody else can. Stopping the share just stops the updates.
// ════════════════════════════════════════════════════════════

import { SimplePool } from "nostr-tools/pool";
import { generateSecretKey, getPublicKey, nip44 } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { EVENT_KINDS, APP_TAG } from "./eventKinds.js";
import { buildSignedEvent } from "./events.js";
import { getRelays } from "../config/relays.js";

const pool = new SimplePool({ enablePing: true, enableReconnect: true });
const TTL_SECONDS = 7200;
const HEX64 = /^[0-9a-f]{64}$/;

export const newShareToken = () => bytesToHex(generateSecretKey());

// https://…/track.html#k=<token>&r=<relay>,<relay>
export function shareLink(baseUrl, token, relays = getRelays()) {
  const r = relays.slice(0, 3).map(encodeURIComponent).join(",");
  return `${baseUrl}#k=${token}&r=${r}`;
}

// Read the link's #fragment: { token, relays } or null. Relays must be ws(s)://.
export function parseShareHash(hash) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const token = (params.get("k") || "").toLowerCase();
  if (!HEX64.test(token)) return null;
  const relays = (params.get("r") || "")
    .split(",")
    .map((r) => { try { return decodeURIComponent(r); } catch { return ""; } })
    .filter((r) => /^wss?:\/\/[^\s]+$/i.test(r))
    .slice(0, 5);
  return { token, relays };
}

const keyFor = (token) => {
  const sk = hexToBytes(token);
  return nip44.getConversationKey(sk, getPublicKey(sk));
};

export const sealShare = (token, payload) => nip44.encrypt(JSON.stringify(payload), keyFor(token));
export function openShare(token, ciphertext) {
  try { return JSON.parse(nip44.decrypt(ciphertext, keyFor(token))); } catch { return null; }
}

export function buildShareEvent(token, payload) {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return buildSignedEvent(
    EVENT_KINDS.TRIP_SHARE,
    { sealed: sealShare(token, payload) },
    [["d", "share"], ["t", APP_TAG], ["expiration", String(exp)]],
    hexToBytes(token)
  );
}

// Publish one update. Never throws.
export async function publishShare(token, payload) {
  try { await Promise.allSettled(pool.publish(getRelays(), buildShareEvent(token, payload))); } catch { /* next update retries */ }
}

// Viewer side: calls onUpdate(payload, createdAtSeconds) for each update
// (the stored latest one first). Returns an unsubscribe function.
export function subscribeShare(token, relays, onUpdate) {
  const pk = getPublicKey(hexToBytes(token));
  const filter = { kinds: [EVENT_KINDS.TRIP_SHARE], authors: [pk], "#d": ["share"] };
  let newest = 0;
  const take = (ev) => {
    if (ev.created_at < newest) return;
    let c; try { c = JSON.parse(ev.content); } catch { return; }
    const payload = openShare(token, c?.sealed);
    if (!payload) return;
    newest = ev.created_at;
    onUpdate(payload, ev.created_at);
  };
  let closed = false;
  pool.querySync(relays, filter).then((evs) => { if (!closed) evs.forEach(take); }).catch(() => {});
  const sub = pool.subscribeMany(relays, [filter], { onevent: take });
  return () => { closed = true; try { sub.close(); } catch { /* ignore */ } };
}
