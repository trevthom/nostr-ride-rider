// ════════════════════════════════════════════════════════════
//  STRIKE SERVE (driver side) — Gets the driver paid straight into their own Strike account (lib/strikerail.js explains the steps).
//  For each Strike tick (kind 30095, rail "strike") the driver has not answered yet:
//    1. make ONE invoice at the driver's Strike for that amount, in the currency the driver chose (bitcoin: exactly the sats; dollars:
//       whole cents, Strike credits the dollars), and send it to the rider, sealed (kind 30102). The invoice is saved before it is sent,
//       so a crash never makes a second one;
//    2. watch that invoice at Strike. When Strike says it is PAID, answer the tick "received" (kind 30096). The answer comes only from
//       the driver's OWN Strike, never from what the rider says;
//    3. if the invoice runs out unpaid, answer with a final refusal so the rider is asked for the money again. (A payment that lands
//       late still counts: "received" replaces an earlier refusal.)
//  If Strike cannot be reached, the tick is tried again a little later and no refusal is sent: a rider is never told "no" because of
//  a bad connection. A tick the rider's app has already stopped counting is refused at once (lib/strikerail.js strikeTickLive).
//
//    serveStrikeTicks({ request, user, strike, publish, usdPrice, nowMs }) → { issued, received, refused, waiting }
//    serveAllStrike({ user, strike, publish, usdPrice, rideRequests })      every ride that has an unanswered Strike tick
// ════════════════════════════════════════════════════════════

import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { rideDriver } from "../../lib/rides.js";
import { ticksOf, tickReplies, tickReplyEvent } from "../../lib/payments.js";
import { rideRail, rideStrike, invoiceEvent, invoicesOf, issuedRecords, strikeTickLive, INVOICE_VALID_MS, INVOICE_GRACE_MS } from "../../lib/strikerail.js";
import { tickSlack } from "../../lib/strike.js";

const inFlight = new Set();
const retryAt = new Map();
const RETRY_MS = 8000;
const LATE_MS = 60 * 60000; // after a refusal, a late payment is still looked for this long
export const MAX_OPEN = 5;  // invoices waiting to be paid at once, per ride: a rider cannot make the driver's Strike issue invoices without end

export async function serveStrikeTicks({ request, user, strike, publish, usdPrice, nowMs = Date.now() }) {
  const out = { issued: 0, received: 0, refused: 0, waiting: 0 };
  const client = strike?.client;
  if (!client || rideDriver(request) !== user.publicKey) return out;
  const cfg = rideRail(request) === "strike" ? rideStrike(request) : null;
  const replies = tickReplies(request);
  const invoices = invoicesOf(request);
  let open = ticksOf(request).filter((t) => t.rail === "strike" && !replies.get(t.id) && issuedRecords.get(t.id)).length;
  for (const tick of ticksOf(request)) {
    if (tick.rail !== "strike" || replies.get(tick.id)?.ok || inFlight.has(tick.id)) continue;
    const had = issuedRecords.get(tick.id);
    if (replies.get(tick.id)?.ok === false && (!had || nowMs > had.expiresAt + LATE_MS)) continue; // refused, and nothing of ours can still be paid: done
    if ((retryAt.get(tick.id) || 0) > nowMs) { out.waiting++; continue; }
    inFlight.add(tick.id);
    const answer = (ok, receivedSats, reason) => {
      const ev = tickReplyEvent(request, tick.event, { ok, receivedSats, reason });
      publish(ev.kind, ev.content, ev.tags).catch(() => {});
    };
    try {
      let rec = issuedRecords.get(tick.id);
      if (!cfg) { if (!replies.has(tick.id)) { answer(false, 0, "This ride is not paid with Strike."); out.refused++; } continue; }
      if (!rec) {
        // The rider's app has stopped counting this tick (we were too slow): do not make an invoice for it.
        if (!strikeTickLive(tick, null, replies.get(tick.id), nowMs)) { if (!replies.has(tick.id)) { answer(false, 0, "The request ran out before an invoice was made."); out.refused++; } continue; }
        if (open >= MAX_OPEN) { out.waiting++; continue; }
        open++;
        const made = await client.receiveInvoice({ sats: tick.amountSats, currency: cfg.currency, usdPerBtc: usdPrice, description: "NostrRide fare" });
        rec = { invoiceId: made.invoiceId, bolt11: made.bolt11, sats: made.sats, currency: cfg.currency, receive: made.receive, expiresAt: nowMs + Math.min(INVOICE_VALID_MS, made.expiresInSec * 1000), sent: false };
        issuedRecords.set(tick.id, rec); // saved BEFORE it is sent: a crash now cannot make a second invoice
        out.issued++;
      }
      if (!rec.sent || !invoices.get(tick.id)) {
        const ev = invoiceEvent(request, tick.event, user, { bolt11: rec.bolt11, sats: rec.sats, currency: rec.currency, receive: rec.receive, expiresAt: rec.expiresAt });
        publish(ev.kind, ev.content, ev.tags).catch(() => {});
        issuedRecords.set(tick.id, { ...rec, sent: true });
      }
      const state = await client.invoiceState(rec.invoiceId);
      if (state === "PAID") {
        // Credit the whole tick when the invoice is the tick to within the cent-sized steps of a dollar invoice; otherwise what it was for.
        const whole = Math.abs(rec.sats - tick.amountSats) <= (rec.currency === "USD" ? tickSlack(tick.amountSats, usdPrice) : 0);
        const got = whole ? tick.amountSats : rec.sats;
        answer(true, got, "");
        out.received += got;
      } else if (state === "CANCELLED" || nowMs > rec.expiresAt + INVOICE_GRACE_MS) {
        if (!replies.has(tick.id)) { answer(false, 0, "The invoice ran out before it was paid."); out.refused++; }
        else retryAt.set(tick.id, nowMs + 60000); // already refused: only a late payment could change it
      } else {
        retryAt.set(tick.id, nowMs + RETRY_MS);
        out.waiting++;
      }
    } catch (e) {
      // A key or permission problem, or an invoice Strike made for the wrong amount, will not mend in seconds: look again later.
      retryAt.set(tick.id, nowMs + RETRY_MS * (e?.code === "scope" || e?.code === "key" || e?.code === "amount" ? 8 : 1));
      out.waiting++;
    } finally {
      inFlight.delete(tick.id);
    }
  }
  return out;
}

// The Strike ticks of EVERY ride this driver has that have no "received" yet (a rider may pay long after the ride ended).
export async function serveAllStrike({ user, strike, publish, usdPrice, rideRequests, nowMs = Date.now() }) {
  if (!strike?.client) return;
  const got = new Set();
  relay.query({ kinds: [EVENT_KINDS.RIDE_TICK_REPLY], authors: [user.publicKey] }).forEach((e) => {
    try { const c = JSON.parse(e.content); if (c.ok === true) got.add(c.tickId); } catch { /* ignore */ }
  });
  const rides = new Map();
  relay.query({ kinds: [EVENT_KINDS.RIDE_TICK], "#p": [user.publicKey] }).forEach((t) => {
    if (got.has(t.id)) return;
    let c; try { c = JSON.parse(t.content); } catch { return; }
    if (c?.rail !== "strike") return;
    const eid = t.tags.filter((x) => x[0] === "e").map((x) => x[1]);
    const request = rideRequests.find((r) => eid.includes(r.id)) || eid.map((id) => relay.query({ kinds: [EVENT_KINDS.RIDE_REQUEST], ids: [id] })[0]).find(Boolean);
    if (request && request.pubkey === t.pubkey && rideDriver(request) === user.publicKey) rides.set(request.id, request);
  });
  for (const request of rides.values()) await serveStrikeTicks({ request, user, strike, publish, usdPrice, nowMs });
}
