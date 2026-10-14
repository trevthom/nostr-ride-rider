// ════════════════════════════════════════════════════════════
//  STRIKE RAIL — Paying a ride straight from the rider's Strike account into the driver's Strike account, with no ecash mint.
//  (The other way, ecash ticks, is lib/payments.js. A ride uses ONE of them, frozen when the rider chooses the driver.)
//
//  One tick, in four steps (each is a signed event; the money itself moves inside Strike):
//    1. rider  → driver  RIDE_TICK (30095) with rail "strike": "I owe you N sats" (public amount, no token)
//    2. driver → rider   RIDE_INVOICE (30102): the driver's Strike makes an invoice for N sats IN THE CURRENCY THE DRIVER CHOSE
//                        (bitcoin, or dollars), sealed to the rider
//    3. rider's Strike pays that invoice (the rider chose which balance pays)
//    4. driver → rider   RIDE_TICK_REPLY (30096): "received", sent only when the driver's OWN Strike says the invoice is PAID
//  A tick the driver cannot or does not answer in time stops counting as sent, so the rider asks again (nothing is owed twice).
//
//  This file holds the event builders and readers, the freezing of the rail, and the small local records that stop a payment
//  being made twice. It has no network code (features/payments/strikeTicks.js and strikeServe.js do the calling).
//    rideRail(request)    "strike" | "ecash"     rideStrike(request)  { currency } the driver is paid in, or null
//    invoicesOf(request)  Map(tickId → the driver's invoice)     strikeTickLive(tick, invoice, nowMs)
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { getSetting, setSetting } from "../config/relays.js";
import { rideDriver, rideVersions } from "./rides.js";
import { seal, unseal } from "./privacy.js";
import { acceptFor, offerFrom } from "./trips.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const etags = (e) => e.tags.filter((t) => t[0] === "e").map((t) => t[1]);
const CURRENCIES = new Set(["BTC", "USD"]);

export const INVOICE_VALID_MS = 5 * 60000; // an invoice the driver made is good for 5 minutes (shorter than Strike's own limit)
export const INVOICE_GRACE_MS = 90000;     // a payment in flight at the deadline still counts for this long
export const ASK_WAIT_MS = 3 * 60000;      // a tick the driver has not answered with an invoice for this long stops counting as sent

// ── The rail of a ride: the driver offered it, and the rider chose it in RIDE_ACCEPT ──
function agreed(request) {
  const driver = rideDriver(request);
  if (!driver) return { offer: null, accept: null };
  const accept = acceptFor(request, driver);
  const id = accept && parse(accept)?.offerId;
  const chosen = id ? relay.query({ kinds: [EVENT_KINDS.RIDE_OFFER], ids: [id] }).find((o) => o.pubkey === driver) : null;
  return { offer: parse(chosen || offerFrom(request, driver) || { content: "{}" }), accept: accept ? parse(accept) : null };
}
// The currency the driver is paid in when the ride goes through Strike: { currency: "BTC" | "USD" } (null if the driver did not offer it).
export function strikeOffer(offerContent) {
  const c = offerContent?.strike?.currency;
  return CURRENCIES.has(c) ? { currency: c } : null;
}
export function rideStrike(request) {
  const { offer } = agreed(request);
  return strikeOffer(offer);
}
// "strike" only when the rider asked for it AND the driver's offer carries it; everything else is ecash (every older ride too).
export function rideRail(request) {
  const { offer, accept } = agreed(request);
  return accept?.rail === "strike" && strikeOffer(offer) ? "strike" : "ecash";
}

// ── Invoices (driver → rider) ──
export function invoiceEvent(request, tickEventObj, user, { ok = true, bolt11 = "", sats = 0, currency = "BTC", receive = null, expiresAt = 0, reason = "" }) {
  const latest = rideVersions(request)[0] || request;
  return {
    kind: EVENT_KINDS.RIDE_INVOICE,
    content: { tickId: tickEventObj.id, ok: !!ok, sats, currency, receive, expiresAt, reason: String(reason).slice(0, 200), ...(ok && { sealed: seal(user.sk, request.pubkey, { bolt11 }) }) },
    tags: [["e", latest.id], ["e", tickEventObj.id], ["p", request.pubkey], ["d", "invoice-" + tickEventObj.id], ["t", "ride-invoice"]],
  };
}
// The driver's invoices by tick id, newest wins: Map(id → { ok, sats, currency, receive, expiresAt, reason, event }). Only the assigned driver counts.
export function invoicesOf(request) {
  const ids = new Set(rideVersions(request).map((e) => e.id)), driver = rideDriver(request);
  const out = new Map();
  if (!driver) return out;
  relay
    .query({ kinds: [EVENT_KINDS.RIDE_INVOICE], authors: [driver], "#p": [request.pubkey] })
    .filter((e) => etags(e).some((id) => ids.has(id)))
    .sort((a, b) => a.created_at - b.created_at)
    .forEach((e) => {
      const c = parse(e);
      if (!c || typeof c.tickId !== "string") return;
      out.set(c.tickId, {
        ok: c.ok !== false, sats: Number.isInteger(c.sats) ? c.sats : 0, currency: CURRENCIES.has(c.currency) ? c.currency : "BTC",
        receive: c.receive && typeof c.receive.amount === "string" ? { currency: String(c.receive.currency), amount: c.receive.amount } : null,
        expiresAt: Number.isFinite(c.expiresAt) ? c.expiresAt : 0, reason: typeof c.reason === "string" ? c.reason : "", event: e,
      });
    });
  return out;
}
// The Lightning invoice inside, for the rider (null if it cannot be opened).
export function invoiceBolt(invoice, request, user) {
  if (user.publicKey !== request.pubkey) return null;
  const driver = rideDriver(request);
  const v = driver ? unseal(user.sk, driver, parse(invoice.event)?.sealed) : null;
  return typeof v?.bolt11 === "string" ? v.bolt11 : null;
}

// Does this Strike tick still count as sent (so the rider does not ask again)? Once the driver is paid it always does. Before that: while the
// driver has not answered, for ASK_WAIT_MS; once an invoice exists, until it has run out (and its grace). A refused tick never counts.
export function strikeTickLive(tick, invoice, reply, nowMs = Date.now()) {
  if (reply?.ok === true) return true;
  if (reply?.ok === false) return false;
  if (!invoice) return nowMs - tick.at < ASK_WAIT_MS;
  if (invoice.ok === false) return false;
  return nowMs < (invoice.expiresAt || 0) + INVOICE_GRACE_MS;
}

// ── Local records, so a payment is never made twice and an invoice is never made twice ──
const cap = (m, n = 300) => { const keys = Object.keys(m); if (keys.length > n) keys.sort((a, b) => (m[a].at || 0) - (m[b].at || 0)).slice(0, keys.length - n).forEach((k) => delete m[k]); return m; };
function store(name) {
  return {
    get: (id) => getSetting(name, {})[id] || null,
    set: (id, v) => { const m = getSetting(name, {}); m[id] = { ...v, at: v.at || Date.now() }; setSetting(name, cap(m)); },
  };
}
// Rider: what was done with each invoice: "paying" (sent to Strike, outcome not known) | "paid" | "retry" (Strike said no; try again at retryAt) | "bad" (never pay).
export const payRecords = store("strikePaid");
// Driver: the invoice made for each tick: { invoiceId, bolt11, sats, currency, receive, expiresAt, sent }.
export const issuedRecords = store("strikeIssued");

// ── Funds ──
// Can the rider's Strike account pay `sats` from the `source` balance? true | false | null (not known: balances unreadable or no price).
// Dollars carry a spread and a fee, so a little extra is asked for.
export function strikeCanPay(balances, source, sats, usdPerBtc) {
  if (!balances || balances[source] == null || !(sats >= 0)) return null;
  if (source === "BTC") return balances.BTC * 1e8 >= sats;
  if (!(usdPerBtc > 0)) return null;
  return balances[source] >= (sats / 1e8) * usdPerBtc * 1.02 + 0.01;
}
