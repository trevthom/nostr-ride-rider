// ════════════════════════════════════════════════════════════
//  EVIDENCE — The signed record of a ride that helps settle a dispute
//  (there is no escrow, so there must be a trail):
//    • the rider's ecash ticks (kind 30095) and the driver's answers (30096),
//      waivers (30097) and signs of life (30098) — see lib/payments.js. The
//      token inside a tick is sealed to the driver; the amounts are public.
//    • the rider's Lightning payment records (kind 30086) — now only tips (older rides
//      also have a deposit and "rest"). The proof — invoice, preimage, LUD-21 verify URL —
//      is sealed to the driver, so only the two of them can read it.
//    • the rider's confirmations (kind 30087): "boarded", "code" and "ended".
//    • the driver's stage markers and the finish events (already in rides.js).
//  • tips: a payment record with phase "tip". The rider may send any number of
//    them, at any time after the ride is completed (optional, never required).
//  Only the RIDE'S RIDER can author a payment record or a confirmation.
//  When two signed accounts disagree, the one that costs the rider less wins. No third party.
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { rideVersions, rideDriver, rideStatus } from "./rides.js";
import { ticksOf, tickReplies, waiversOf } from "./payments.js";
import { stopChanges } from "./stops.js";
import { unseal } from "./privacy.js";
import { preimageMatches } from "./bolt11.js";
import { invoiceAmountMsat, invoiceStatus } from "./lnurl.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const etagOf = (e) => (e.tags.find((t) => t[0] === "e") || [])[1];

// How strongly the RIDER'S OWN app saw the payment succeed:
//   preimage  the payment preimage matches the invoice (cryptographic)
//   wallet    their wallet said the payment went through
//   verify    the Lightning server said the invoice is settled (LUD-21)
//   claimed   they tapped "I've paid" and nothing could check it
export function proofLevel({ via, pr, preimage }) {
  if (preimage && preimageMatches(pr, preimage)) return "preimage";
  return via === "wallet" ? "wallet" : via === "verify" ? "verify" : "claimed";
}

// The payment records on a ride, readable by the rider and the driver
// ([] for anyone else): [{ phase, amountSats, level, at, detail }] oldest first.
// `detail` is the sealed proof ({ pr, preimage, verify }) or null.
export function paymentRecords(request, user) {
  const ids = new Set(rideVersions(request).map((e) => e.id));
  const driver = rideDriver(request);
  const counterparty = user.publicKey === request.pubkey ? driver : request.pubkey;
  if (!counterparty) return [];
  return relay
    .query({ kinds: [EVENT_KINDS.RIDE_PAYMENT], "#e": [...ids], authors: [request.pubkey] })
    .filter((e) => ids.has(etagOf(e)))
    .sort((a, b) => a.created_at - b.created_at)
    .map((e) => {
      const c = parse(e) || {};
      const detail = c.sealed ? unseal(user.sk, counterparty, c.sealed) : null;
      return { phase: c.phase, amountSats: Number(c.amountSats) || 0, level: c.level || "claimed", at: e.created_at, detail };
    })
    .filter((r) => r.phase === "deposit" || r.phase === "rest" || r.phase === "tip");
}

// The tips the rider sent for a ride: [{ sats, at }] oldest first. Needs no keys: the
// amount is in the public part of the record, and only the ride's rider can author one.
// A tip only counts on a ride that was completed.
export function tipsOf(request) {
  const ids = new Set(rideVersions(request).map((e) => e.id));
  const driver = rideDriver(request);
  if (!driver || rideStatus(request) !== "completed") return [];
  return relay
    .query({ kinds: [EVENT_KINDS.RIDE_PAYMENT], "#e": [...ids], authors: [request.pubkey] })
    .filter((e) => ids.has(etagOf(e)) && e.tags.some((t) => t[0] === "p" && t[1] === driver))
    .sort((a, b) => a.created_at - b.created_at)
    .map((e) => ({ c: parse(e) || {}, at: e.created_at }))
    .filter(({ c }) => c.phase === "tip" && Number.isFinite(c.amountSats) && c.amountSats > 0 && c.amountSats <= 1e9)
    .map(({ c, at }) => ({ sats: Math.round(c.amountSats), at }));
}

// The DRIVER's own check of a payment record (never trust the rider's word):
//   confirmed   the driver's Lightning server (same host as their lud16) says it is settled
//   consistent  the invoice has the right amount and the preimage matches it; confirm in your wallet
//   unverified  nothing checks out
export async function verifyPayment(record, lud16) {
  const d = record.detail;
  if (!d?.pr) return "unverified";
  const amountOk = invoiceAmountMsat(d.pr) === record.amountSats * 1000;
  try {
    const host = String(lud16 || "").split("@")[1];
    const url = d.verify ? new URL(d.verify) : null;
    if (url && url.protocol === "https:" && host && url.hostname === host.toLowerCase() && amountOk) {
      const st = await invoiceStatus(d.verify);
      if (st.settled) return "confirmed";
    }
  } catch { /* fall through to the offline check */ }
  return amountOk && d.preimage && preimageMatches(d.pr, d.preimage) ? "consistent" : "unverified";
}

// Everything this person can show about a ride, as plain data (for copying to
// whoever settles a dispute). It holds only what the signed events say.
export function disputeRecord(request, user) {
  const ids = rideVersions(request).map((e) => e.id);
  const mine = (kind) => relay.query({ kinds: [kind], "#e": ids }).filter((e) => ids.includes(etagOf(e)));
  const brief = (e) => ({ id: e.id, by: e.pubkey, at: e.created_at, content: parse(e) });
  return {
    ride: { rider: request.pubkey, driver: rideDriver(request), versions: ids },
    stages: mine(EVENT_KINDS.RIDE_STAGE).filter((e) => e.pubkey === rideDriver(request)).map(brief),
    complete: mine(EVENT_KINDS.RIDE_COMPLETE).filter((e) => e.pubkey === rideDriver(request)).map(brief),
    finishes: mine(EVENT_KINDS.RIDE_FINISH).map(brief),
    ticks: ticksOf(request).map((t) => ({ id: t.id, trigger: t.trigger, amountSats: t.amountSats, mint: t.mint, at: t.createdAt, reply: tickReplies(request).get(t.id) || null })),
    waivers: waiversOf(request).map((w) => ({ forgivenSats: w.forgivenSats, refundSats: w.refundSats, reason: w.reason, at: w.at })),
    stopChanges: stopChanges(request).map((c) => ({ id: c.id, mode: c.mode, status: c.status, at: c.at })),
    signsOfLife: mine(EVENT_KINDS.RIDE_ALIVE).map(brief),
    confirmations: mine(EVENT_KINDS.RIDE_CONFIRM).filter((e) => e.pubkey === request.pubkey).map(brief),
    payments: paymentRecords(request, user).map((r) => ({ phase: r.phase, amountSats: r.amountSats, level: r.level, at: r.at, invoice: r.detail?.pr || null, preimage: r.detail?.preimage || null, verify: r.detail?.verify || null })),
  };
}
