// ════════════════════════════════════════════════════════════
//  PAYMENTS (events) — The signed trail of the pay-as-you-ride payments, read
//  from the event cache. Writers build the content with the helpers here and
//  publish it with useApp().publish.
//
//    RIDE_TICK        rider → driver   one ecash payment. The token is sealed to the driver; the
//                                      amount is public (like a tip). d = tick-<rideKey>-<seq>-<nonce>
//    RIDE_TICK_REPLY  driver → rider   "received" (ok) or a final refusal. d = tick-reply-<tickId>
//    RIDE_WAIVER      driver → rider   part of the fare is waived: the unpaid part is forgiven, and/or
//                                      ecash is sent back (sealed to the rider)
//    RIDE_ALIVE       either person    "still riding" / "still driving": a signed sign of life
//
//  Who may write what (checked on every read, because anyone can sign an event):
//    ticks — only the ride's rider;  replies and waivers — only the assigned driver;
//    alive — the rider or the assigned driver.
//
//  paidSats(request)  = ticks the driver CONFIRMED (this is what counts as paid)
//  sentSats(request)  = every valid tick the rider sent (the rider's app uses it so it never pays twice). A tick the driver
//                       calls "refused" still counts, until the rider's app has taken the token back from the mint
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { rideDriver, rideKey, rideVersions, RIDER_SIGNAL_KINDS, DRIVER_SIGNAL_KINDS } from "./rides.js";
import { seal, unseal } from "./privacy.js";
import { getSetting, setSetting } from "../config/relays.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const etags = (e) => e.tags.filter((t) => t[0] === "e").map((t) => t[1]);
const sats = (x) => (typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 1e9 ? x : null);
const idsOf = (request) => new Set(rideVersions(request).map((e) => e.id));
const onRide = (e, ids) => etags(e).some((id) => ids.has(id));

// ── Building ──
export function tickEvent(request, driverPubkey, user, { seq, trigger, amountSats, mint, token, at = Date.now() }) {
  const nonce = Math.random().toString(36).slice(2, 8);
  const latest = rideVersions(request)[0] || request;
  return {
    kind: EVENT_KINDS.RIDE_TICK,
    content: { seq, trigger, amountSats, mint, at, sealed: seal(user.sk, driverPubkey, { token }) },
    tags: [["e", latest.id], ["p", driverPubkey], ["d", `tick-${rideKey(request)}-${seq}-${nonce}`], ["t", "ride-tick"]],
  };
}
export function tickReplyEvent(request, tickEventObj, { ok, receivedSats = 0, reason = "" }) {
  const latest = rideVersions(request)[0] || request;
  return {
    kind: EVENT_KINDS.RIDE_TICK_REPLY,
    content: { tickId: tickEventObj.id, ok: !!ok, receivedSats, reason: String(reason).slice(0, 200) },
    tags: [["e", latest.id], ["e", tickEventObj.id], ["p", request.pubkey], ["d", "tick-reply-" + tickEventObj.id], ["t", "ride-tick"]],
  };
}
export function waiverEvent(request, user, { forgivenSats, refundSats = 0, token = "", reason = "" }) {
  const latest = rideVersions(request)[0] || request;
  return {
    kind: EVENT_KINDS.RIDE_WAIVER,
    content: { forgivenSats, refundSats, reason: String(reason).slice(0, 300), ...(token && { sealed: seal(user.sk, request.pubkey, { token }) }) },
    tags: [["e", latest.id], ["p", request.pubkey], ["d", `waive-${rideKey(request)}-${Date.now()}`], ["t", "ride-waiver"]],
  };
}
// `forRole` = whom the sign of life is about: "rider" | "driver" (the person who taps vouches for the other).
export function aliveEvent(request, otherPubkey, role, forRole) {
  const latest = rideVersions(request)[0] || request;
  return {
    kind: EVENT_KINDS.RIDE_ALIVE,
    content: { role, forRole, at: Date.now() },
    tags: [["e", latest.id], ["p", otherPubkey], ["d", `alive-${rideKey(request)}-${role}`], ["t", "ride-alive"]],
  };
}

// ── Reading ──
// The valid ticks of a ride, oldest first: [{ id, seq, trigger, amountSats, mint, at, createdAt }].
export function ticksOf(request) {
  const ids = idsOf(request), driver = rideDriver(request);
  if (!driver) return [];
  return relay
    .query({ kinds: [EVENT_KINDS.RIDE_TICK], authors: [request.pubkey], "#p": [driver] })
    .filter((e) => onRide(e, ids))
    .map((e) => ({ e, c: parse(e) }))
    .filter(({ c }) => c && sats(c.amountSats) && typeof c.sealed === "string")
    .map(({ e, c }) => ({ id: e.id, event: e, seq: Number(c.seq) || 0, trigger: String(c.trigger || ""), amountSats: c.amountSats, mint: String(c.mint || ""), at: Number(c.at) || e.created_at * 1000, createdAt: e.created_at }))
    .sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
}

// The driver's answers by tick id: Map(id → { ok, receivedSats, reason, at }). Only the assigned driver counts;
// a refusal never overrides an earlier "received".
export function tickReplies(request) {
  const ids = idsOf(request), driver = rideDriver(request);
  const out = new Map();
  if (!driver) return out;
  relay
    .query({ kinds: [EVENT_KINDS.RIDE_TICK_REPLY], authors: [driver], "#p": [request.pubkey] })
    .filter((e) => onRide(e, ids))
    .sort((a, b) => a.created_at - b.created_at)
    .forEach((e) => {
      const c = parse(e);
      if (!c || typeof c.tickId !== "string") return;
      if (out.get(c.tickId)?.ok) return;
      out.set(c.tickId, { ok: c.ok === true, receivedSats: sats(c.receivedSats) || 0, reason: typeof c.reason === "string" ? c.reason : "", at: e.created_at });
    });
  return out;
}

// How many of this ride's payments the driver's app REFUSED (the mint would not give the driver the money: a token already
// spent, from the wrong mint, or unreadable). A rider's app that takes its own token back from the mint before the driver redeems
// it causes this. The driver sees it at once and may finish the ride, without waiting for two missed payments.
export function refusedTicks(request) {
  let n = 0;
  for (const r of tickReplies(request).values()) if (!r.ok) n++;
  return n;
}

// A confirmed tick counts for what the driver says they received, never more than the tick claims
// (2 sats of slack for a mint's fee).
export function paidSats(request) {
  const replies = tickReplies(request);
  return ticksOf(request).reduce((s, t) => {
    const r = replies.get(t.id);
    return s + (r?.ok ? Math.min(t.amountSats, (r.receivedSats || t.amountSats) + 2) : 0);
  }, 0);
}
export function sentSats(request) {
  // A tick counts as sent unless the rider's own app got its money back. The driver's word "refused" is NOT enough: a
  // driver could redeem the token, say "refused", and have the rider pay the same tick again and again. The rider's app
  // takes the token back from the mint (features/payments/recoverRefused.js); only if that works was the tick unpaid.
  return ticksOf(request).reduce((s, t) => s + (tickVerdict(t.id) === "recovered" ? 0 : t.amountSats), 0);
}

// What the rider's app found out about a tick the driver called refused: "recovered" (the token was still unspent
// and is back in the wallet: the tick was not paid) or "spent" (the mint says the driver took it: the tick was paid).
// Kept on this device, a few hundred at most.
const VERDICTS = "tickRefusal";
export function tickVerdict(tickId) {
  const all = getSetting(VERDICTS, {});
  const v = all && typeof all === "object" ? all[tickId] : null;
  return v === "r" ? "recovered" : v === "s" ? "spent" : null;
}
export function setTickVerdict(tickId, verdict) {
  const all = getSetting(VERDICTS, {}) || {};
  setSetting(VERDICTS, Object.fromEntries(Object.entries({ ...all, [tickId]: verdict === "recovered" ? "r" : "s" }).slice(-300)));
}

// The ecash token inside a tick, for the RIDER who sent it (null if it can't be opened).
export function ownTickToken(tick, request, user) {
  const driver = rideDriver(request);
  if (!driver || user.publicKey !== request.pubkey) return null;
  const v = unseal(user.sk, driver, parse(tick.event)?.sealed);
  return typeof v?.token === "string" ? v.token : null;
}

// The driver's waivers, oldest first: [{ id, forgivenSats, refundSats, reason, at, hasToken, event }].
export function waiversOf(request) {
  const ids = idsOf(request), driver = rideDriver(request);
  if (!driver) return [];
  return relay
    .query({ kinds: [EVENT_KINDS.RIDE_WAIVER], authors: [driver], "#p": [request.pubkey] })
    .filter((e) => onRide(e, ids))
    .map((e) => ({ e, c: parse(e) }))
    .filter(({ c }) => c && Number.isInteger(c.forgivenSats) && c.forgivenSats >= 0 && Number.isInteger(c.refundSats || 0) && (c.refundSats || 0) >= 0)
    .map(({ e, c }) => ({ id: e.id, forgivenSats: c.forgivenSats, refundSats: c.refundSats || 0, reason: typeof c.reason === "string" ? c.reason : "", at: e.created_at, hasToken: typeof c.sealed === "string", event: e }))
    .sort((a, b) => a.at - b.at);
}
export const forgivenSats = (request) => waiversOf(request).reduce((s, w) => s + w.forgivenSats, 0);

// The ecash a rider can claim from a waiver (null if it has none or it can't be opened).
export function waiverToken(w, request, user) {
  if (!w.hasToken || user.publicKey !== request.pubkey) return null;
  const driver = rideDriver(request);
  const v = driver ? unseal(user.sk, driver, parse(w.event)?.sealed) : null;
  return typeof v?.token === "string" ? v.token : null;
}

// The ecash token inside a tick, for the driver (null if it can't be opened).
export function tickToken(tick, request, user) {
  if (user.publicKey !== rideDriver(request)) return null;
  const v = unseal(user.sk, request.pubkey, parse(tick.event)?.sealed);
  return typeof v?.token === "string" ? v.token : null;
}

// What is still owed: what the ride earned, minus what the driver confirmed and what they forgave.
export const outstandingSats = (request, owed) => Math.max(0, owed - paidSats(request) - forgivenSats(request));

// The time (ms) of each person's last signed signal about this ride, from the events the cache holds.
// (The apps add the live ones — location, meter — that relays do not keep.) { riderAt, driverAt } or null each.
const RIDER_KINDS = [...RIDER_SIGNAL_KINDS, EVENT_KINDS.RIDE_FINISH];
const DRIVER_KINDS = [...DRIVER_SIGNAL_KINDS, EVENT_KINDS.RIDE_FINISH, EVENT_KINDS.RIDE_COMPLETE];
export function signalTimes(request) {
  const ids = idsOf(request), driver = rideDriver(request);
  let riderAt = null, driverAt = null;
  const seen = relay.query({ kinds: [...new Set([...RIDER_KINDS, ...DRIVER_KINDS])], "#e": [...ids] }).filter((e) => onRide(e, ids));
  for (const e of seen) {
    const t = e.created_at * 1000;
    if (e.pubkey === request.pubkey && RIDER_KINDS.includes(e.kind)) riderAt = Math.max(riderAt ?? 0, t);
    if (driver && e.pubkey === driver && DRIVER_KINDS.includes(e.kind)) driverAt = Math.max(driverAt ?? 0, t);
    // A sign of life ("still riding / still driving") vouches for the other person as well.
    if (e.kind === EVENT_KINDS.RIDE_ALIVE && (e.pubkey === request.pubkey || (driver && e.pubkey === driver))) {
      const c = parse(e);
      if (c?.forRole === "rider") riderAt = Math.max(riderAt ?? 0, t);
      if (c?.forRole === "driver") driverAt = Math.max(driverAt ?? 0, t);
    }
  }
  return { riderAt, driverAt };
}
