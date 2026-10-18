// ════════════════════════════════════════════════════════════
//  REDEEM WAIVERS (rider side) — When a driver waives part of a fare and sends money back,
//  the refund is an ecash token sealed to the rider inside a waiver event (kind 30097). This
//  puts it into the rider's wallet by itself, also for old rides and after the receipt was
//  closed. A token is never redeemed twice (the wallet remembers a fingerprint of each one).
//
//    redeemWaiversFor({ user, ecash, rideRequests }) → [{ sats, mint }] refunds collected now
// ════════════════════════════════════════════════════════════

import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { rideDriver } from "../../lib/rides.js";
import { rideMint } from "../../lib/terms.js";
import { waiversOf, waiverToken } from "../../lib/payments.js";

const tried = new Set(); // waiver ids already handled in this session

export async function redeemWaiversFor({ user, ecash, rideRequests }) {
  const got = [];
  if (!ecash) return got;
  const seen = new Set();
  for (const ev of relay.query({ kinds: [EVENT_KINDS.RIDE_WAIVER], "#p": [user.publicKey] })) {
    if (tried.has(ev.id)) continue;
    const eid = ev.tags.filter((t) => t[0] === "e").map((t) => t[1]);
    const request = rideRequests.find((r) => eid.includes(r.id)) || eid.map((id) => relay.query({ kinds: [EVENT_KINDS.RIDE_REQUEST], ids: [id] })[0]).find(Boolean);
    if (!request || request.pubkey !== user.publicKey || rideDriver(request) !== ev.pubkey || seen.has(request.id)) continue;
    seen.add(request.id);
    // A refund is ecash at the mint the ride was agreed at, and only from there. A token from any other mint would make this app
    // contact an address the DRIVER picked, and could fill the wallet with money that is worth nothing.
    const mint = rideMint(request);
    for (const w of waiversOf(request)) {
      if (tried.has(w.id)) continue;
      const token = waiverToken(w, request, user);
      if (!token || !mint) { if (!token) tried.add(w.id); continue; }
      try {
        const r = await ecash.redeem(token, { only: [mint] });
        tried.add(w.id);
        got.push(r);
      } catch (e) {
        if (e?.code === "used" || e?.definitive) tried.add(w.id); // already ours, or refused for good
      }
    }
  }
  return got;
}
