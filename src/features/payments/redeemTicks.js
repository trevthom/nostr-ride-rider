// ════════════════════════════════════════════════════════════
//  REDEEM TICKS (driver side) — Takes the rider's ecash payments as they
//  arrive. For each tick (kind 30095) the driver has not answered yet:
//    1. open the token (sealed to the driver) and check it is from the mint
//       named in the agreed offer;
//    2. redeem it at the mint: the money becomes the driver's own ecash at once;
//    3. answer with a signed reply (kind 30096): "received", or a FINAL refusal
//       (a token the mint says is spent, from the wrong mint, or unreadable).
//  A token already redeemed for a DIFFERENT tick is a replay: refused, pays nothing.
//  If the mint cannot be reached the tick is tried again a little later and no reply
//  is sent: a rider is never told "refused" because of a bad connection.
//  Called every few seconds for the current drive.
//
//    redeemTicks({ request, user, ecash, publish, mint }) → { received, refused, waiting }
// ════════════════════════════════════════════════════════════

import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { rideDriver } from "../../lib/rides.js";
import { rideMint } from "../../lib/terms.js";
import { ticksOf, tickReplies, tickToken, tickReplyEvent } from "../../lib/payments.js";

const inFlight = new Set();
const retryAt = new Map(); // tick id → ms epoch
const RETRY_MS = 15000;

export async function redeemTicks({ request, user, ecash, publish, mint, nowMs = Date.now() }) {
  const out = { received: 0, refused: 0, waiting: 0 };
  if (!ecash || !mint) return out;
  const replies = tickReplies(request);
  for (const tick of ticksOf(request)) {
    if (replies.has(tick.id) || inFlight.has(tick.id)) continue;
    if ((retryAt.get(tick.id) || 0) > nowMs) { out.waiting++; continue; }
    inFlight.add(tick.id);
    const answer = (ok, receivedSats, reason) => {
      const ev = tickReplyEvent(request, tick.event, { ok, receivedSats, reason });
      publish(ev.kind, ev.content, ev.tags).catch(() => {});
    };
    try {
      const token = tickToken(tick, request, user);
      if (!token) { answer(false, 0, "The payment could not be opened."); out.refused++; continue; }
      const res = await ecash.redeem(token, { only: [mint], ref: tick.id });
      answer(true, res.sats, "");
      out.received += res.sats;
    } catch (e) {
      if (e?.code === "used" && e.ref === tick.id && e.sats > 0) {
        // We redeemed THIS payment before (the reply may have been lost): say so again, with what we received.
        answer(true, e.sats, "");
        out.received += e.sats;
      } else if (e?.code === "used") {
        // The same token inside another payment: a replay. It pays nothing.
        answer(false, 0, "This token was already used for another payment.");
        out.refused++;
      } else if (e?.definitive) {
        answer(false, 0, e.message || "The mint refused this payment.");
        out.refused++;
      } else {
        retryAt.set(tick.id, nowMs + RETRY_MS);
        out.waiting++;
      }
    } finally {
      inFlight.delete(tick.id);
    }
  }
  return out;
}

// Redeem the ticks of EVERY ride this driver has (a rider may pay what was missed long after the ride ended).
// Looks at the ticks addressed to the driver that have no answer yet and finds each one's ride.
export async function redeemAllFor({ user, ecash, publish, rideRequests }) {
  if (!ecash) return;
  const answered = new Set();
  relay.query({ kinds: [EVENT_KINDS.RIDE_TICK_REPLY], authors: [user.publicKey] }).forEach((e) => {
    try { answered.add(JSON.parse(e.content).tickId); } catch { /* ignore */ }
  });
  const rides = new Map();
  relay.query({ kinds: [EVENT_KINDS.RIDE_TICK], "#p": [user.publicKey] }).forEach((t) => {
    if (answered.has(t.id)) return;
    const eid = t.tags.filter((x) => x[0] === "e").map((x) => x[1]);
    const request = rideRequests.find((r) => eid.includes(r.id)) || eid.map((id) => relay.query({ kinds: [EVENT_KINDS.RIDE_REQUEST], ids: [id] })[0]).find(Boolean);
    if (request && request.pubkey === t.pubkey && rideDriver(request) === user.publicKey) rides.set(request.id, request);
  });
  for (const request of rides.values()) {
    const mint = rideMint(request);
    if (mint) await redeemTicks({ request, user, ecash, publish, mint });
  }
}
