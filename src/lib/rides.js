// ════════════════════════════════════════════════════════════
//  RIDES — Shared helpers for ride expiry, ride state and trip counts.
//
//  Trust rules (relay events are signed, but ANYONE can sign one):
//   • A ride's versions are the requests with the same AUTHOR and
//     d-tag (the NIP-01 address kind:pubkey:d) — never d-tag alone.
//   • A finish counts only from the rider or the assigned driver.
//   • A completion (the driver finished at the destination) counts only from the assigned driver.
//   • A tick (payment) and a stop change count only from the ride's rider; a tick reply, a
//     waiver and a stop reply only from the assigned driver; "still riding / driving" from either.
//   • A stage marker (arrived / riding) counts only from the assigned driver.
//   • A confirmation (boarded / ended) and a payment record count only from the rider.
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { readFinish } from "./finish.js";

const HOUR = 3600000;
const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const dtagOf = (e) => (e.tags.find((t) => t[0] === "d") || [])[1];
const etagOf = (e) => (e.tags.find((t) => t[0] === "e") || [])[1];

// Screens call these helpers for every row on every render, so results
// are cached until the event cache changes (relay.version).
const memo = new Map();
let memoVersion = -1;
function cached(key, fn) {
  if (relay.version !== memoVersion) { memo.clear(); memoVersion = relay.version; }
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key);
}

// When an OPEN ride request (no driver chosen) expires (ms epoch). Everyone works this out from the signed
// request, so a request left behind by a closed app disappears for the rider AND the drivers by itself:
//  • ASAP   → 1 hour after it was created.
//  • Timed  → RESERVATION_TTL_MS (2 hours) after the scheduled pick-up time.
export const RESERVATION_TTL_MS = 2 * HOUR;
export function rideExpiryMs(content, createdAtSec) {
  if (content?.time && content.time !== "ASAP") {
    const t = Date.parse(content.time);
    if (!isNaN(t)) return t + RESERVATION_TTL_MS;
  }
  return createdAtSec * 1000 + HOUR;
}

export function isRideExpired(content, createdAtSec) {
  return Date.now() > rideExpiryMs(content, createdAtSec);
}

// A stable id for a ride across all its versions: "<rider>:<d-tag>".
export const rideKey = (request) => `${request.pubkey}:${dtagOf(request)}`;

// Every version of one ride (same author + d-tag), newest first.
export function rideVersions(request) {
  return cached("v:" + request.id, () => findVersions(request)).slice();
}
function findVersions(request) {
  const d = dtagOf(request);
  const found = d ? relay.query({ kinds: [EVENT_KINDS.RIDE_REQUEST], authors: [request.pubkey], "#d": [d] }) : [];
  if (!found.some((e) => e.id === request.id)) found.push(request);
  // Reverse first so a same-second tie goes to the most recently stored
  // version (the sort is stable), matching latestVersions().
  return found.reverse().sort((a, b) => b.created_at - a.created_at);
}

// The ride's version ids, rider, and assigned driver. Only the rider can
// author a version, so the driverPubkey they named is trustworthy.
function rideParties(request) {
  const versions = rideVersions(request);
  const driver = versions.map((e) => parse(e)?.driverPubkey).find(Boolean) || null;
  return { ids: new Set(versions.map((e) => e.id)), rider: request.pubkey, driver };
}

// What each person's app signs during a ride (kinds that prove they were there). Used for the silence rule.
export const RIDER_SIGNAL_KINDS = [EVENT_KINDS.RIDE_TICK, EVENT_KINDS.RIDE_CONFIRM, EVENT_KINDS.RIDE_ALIVE, EVENT_KINDS.RIDE_STOP_CHANGE, EVENT_KINDS.RIDE_PICKUP_CHANGE];
export const DRIVER_SIGNAL_KINDS = [EVENT_KINDS.RIDE_STAGE, EVENT_KINDS.RIDE_TICK_REPLY, EVENT_KINDS.RIDE_ALIVE, EVENT_KINDS.RIDE_WAIVER, EVENT_KINDS.RIDE_PICKUP_REPLY, EVENT_KINDS.RIDE_STOP_REPLY];

// The newest signed sign of life (ms) from either person before `finish` was signed; 0 if none.
function lastSignalMs({ ids, rider, driver }, finish) {
  let best = 0;
  relay.query({ kinds: [...RIDER_SIGNAL_KINDS, ...DRIVER_SIGNAL_KINDS], "#e": [...ids] }).forEach((e) => {
    if (e.id === finish.id || e.created_at > finish.created_at || !ids.has(etagOf(e))) return;
    const ok = (e.pubkey === rider && RIDER_SIGNAL_KINDS.includes(e.kind)) || (driver && e.pubkey === driver && DRIVER_SIGNAL_KINDS.includes(e.kind));
    if (ok) best = Math.max(best, e.created_at * 1000);
  });
  return best;
}

// The events that end a ride, earliest first: a finish by the rider or the assigned driver, or a
// completion by the assigned driver. When two arrive together (within 10 s) the one that costs the
// rider less goes first. Each is { kind, event, by, at, fin } (fin = the checked finish details).
function endings({ ids, rider, driver }) {
  const list = [];
  // The time a finish claims is believed only if it is close to the event's own time (a person cannot
  // back-date a finish to owe less, or post-date it). The one exception is "both phones were silent": the
  // charge then runs to the last signal, which is earlier than the event, but never earlier than a
  // signed event that proves someone was still there.
  const sane = (fin, e) => {
    if (!fin) return fin;
    const t = e.created_at * 1000;
    if (fin.reason === "silence") {
      const floor = lastSignalMs({ ids, rider, driver }, e);
      return { ...fin, at: fin.at != null ? Math.min(t, Math.max(fin.at, floor)) : floor || t };
    }
    return { ...fin, at: fin.at != null && fin.at >= t - 120000 && fin.at <= t + 5000 ? fin.at : t };
  };
  relay.query({ kinds: [EVENT_KINDS.RIDE_FINISH], "#e": [...ids] })
    .filter((c) => ids.has(etagOf(c)) && (c.pubkey === rider || (driver && c.pubkey === driver)))
    .forEach((c) => list.push({ kind: "finish", event: c, by: c.pubkey, at: c.created_at, fin: sane(readFinish(parse(c)), c) }));
  if (driver) {
    // Older apps ended a ride with RIDE_COMPLETE: the driver finished at the destination.
    relay.query({ kinds: [EVENT_KINDS.RIDE_COMPLETE], "#e": [...ids], authors: [driver] })
      .filter((c) => ids.has(etagOf(c)))
      .forEach((c) => list.push({ kind: "complete", event: c, by: c.pubkey, at: c.created_at, fin: sane(readFinish({ ...(parse(c) || {}), role: "driver", reason: "destination", atDestination: true }), c) }));
  }
  const cost = (e) => (e.fin && e.fin.miles != null ? e.fin.miles : Infinity);
  return list.sort((a, b) => (Math.abs(a.at - b.at) <= 10 ? cost(a) - cost(b) || a.at - b.at : a.at - b.at));
}

// Effective ride status:
//   requested → accepted → in_progress → completed | closed
// A ride ends by an explicit event (so the DRIVER can end a ride they don't "own"). It is
// "completed" if it had started (the driver marked "riding") and "closed" if it had not:
// nothing is owed for a ride that never started. An old "cancelled" request reads as "closed".
export function rideStatus(request) {
  return cached("s:" + request.id, () => computeStatus(request));
}
function computeStatus(request) {
  const base = parse(request)?.status || "requested";
  if (base === "cancelled" || base === "closed") return "closed";
  const first = endings(rideParties(request))[0];
  if (first) return first.kind === "complete" || rideStage(request) === "riding" ? "completed" : "closed";
  return base;
}

// Who ended the ride, when and how — for the screen of the other person and for the receipt.
//   { type: "completed" | "closed", by, at, fin }  (null while the ride runs)
export function rideEnding(request) {
  return cached("end:" + request.id, () => computeEnding(request));
}
function computeEnding(request) {
  const first = endings(rideParties(request))[0];
  if (!first) return null;
  return { type: rideStatus(request) === "completed" ? "completed" : "closed", by: first.by, at: first.at, fin: first.fin };
}

// The assigned driver's pubkey for a ride (null until the rider accepts one).
export function rideDriver(request) {
  return cached("drv:" + request.id, () => rideParties(request).driver);
}

// How far along an accepted ride is, from the assigned driver's markers:
// "enroute" (driving to the pickup) → "arrived" → "riding". Stages only move
// forward, so the furthest valid marker wins (no clock or ordering issues).
export const RIDE_STAGES = ["enroute", "arrived", "riding"];
export function rideStage(request) {
  return cached("stg:" + request.id, () => computeStage(request));
}
function computeStage(request) {
  const { ids, driver } = rideParties(request);
  if (!driver) return "enroute";
  let best = 0;
  relay.query({ kinds: [EVENT_KINDS.RIDE_STAGE], "#e": [...ids], authors: [driver] }).forEach((e) => {
    if (!ids.has(etagOf(e))) return;
    best = Math.max(best, RIDE_STAGES.indexOf(parse(e)?.stage));
  });
  // The driver alone cannot start the ride: "riding" counts only once the RIDER typed the start code.
  if (best === 2 && !riderStarted(request)) best = 1;
  return RIDE_STAGES[best];
}

// Did the rider type the start code shown on the driver's phone (lib/startcode.js)? Only the rider's own signed
// confirmation says so. A driver can sign a "riding" marker from anywhere; without this a marker would start the
// meter, and the rider's app would pay the base rate and every minute for a ride the rider never began.
export function riderStarted(request) {
  return !!rideConfirm(request).code?.ok;
}

// When each part of a drive began, in ms, from the signed events:
//   { confirmedAt, arrivedAt, startedAt } (each null until it happens).
// Stage markers are replaceable, so a relay keeps only the newest one. Each marker therefore
// also carries the earlier times (`at`, and `arrivedAt` on the "riding" marker). A time claimed in
// a marker is believed only if it is within 10 minutes of the event's own timestamp.
export function rideTimes(request) {
  return cached("tm:" + request.id, () => computeTimes(request));
}
function computeTimes(request) {
  const { ids, rider, driver } = rideParties(request);
  const out = { confirmedAt: null, arrivedAt: null, startedAt: null };
  if (!driver) return out;
  const accept = relay
    .query({ kinds: [EVENT_KINDS.RIDE_ACCEPT], authors: [rider], "#p": [driver], "#e": [...ids] })
    .sort((a, b) => a.created_at - b.created_at)[0];
  out.confirmedAt = accept ? accept.created_at * 1000 : null;
  const started = riderStarted(request);
  const near = (claim, e) => (Number.isFinite(claim) && Math.abs(claim - e.created_at * 1000) <= 600000 ? claim : null);
  const earliest = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));
  relay.query({ kinds: [EVENT_KINDS.RIDE_STAGE], "#e": [...ids], authors: [driver] }).forEach((e) => {
    if (!ids.has(etagOf(e))) return;
    const c = parse(e) || {};
    const own = near(c.at, e) ?? e.created_at * 1000;
    if (c.stage === "arrived") out.arrivedAt = earliest(out.arrivedAt, own);
    if (c.stage === "riding" && started) {
      out.startedAt = earliest(out.startedAt, own);
      // The time of arrival may be recalled inside the riding marker (it can be older than the event).
      if (Number.isFinite(c.arrivedAt) && c.arrivedAt <= own && own - c.arrivedAt <= 6 * HOUR) out.arrivedAt = earliest(out.arrivedAt, c.arrivedAt);
    }
  });
  return out;
}

// The rider's own confirmations of a ride, newest per phase:
// { boarded?, code?, ended?, problem? }, each {ok, note, at}. ("problem" = reported mid-trip;
// "code" = the rider typed the 4-digit start code shown on the driver's phone, lib/startcode.js.)
// Only the rider's count.
export function rideConfirm(request) {
  return cached("cfm:" + request.id, () => computeConfirm(request));
}
function computeConfirm(request) {
  const { ids, rider } = rideParties(request);
  const out = {};
  relay.query({ kinds: [EVENT_KINDS.RIDE_CONFIRM], "#e": [...ids], authors: [rider] })
    .filter((e) => ids.has(etagOf(e)))
    .sort((a, b) => a.created_at - b.created_at)
    .forEach((e) => {
      const c = parse(e);
      if (c && (c.phase === "boarded" || c.phase === "code" || c.phase === "ended" || c.phase === "problem")) {
        out[c.phase] = { ok: c.ok !== false, note: typeof c.note === "string" ? c.note.slice(0, 500) : "", at: e.created_at };
      }
    });
  return out;
}

// How many trips one pubkey has completed, by role: { rides (as rider), drives (as driver) }. A plain count of signed, finished
// rides. (There are no star ratings or reviews: they are too easy to fake. Trust comes from vouches, lib/vouches.js.)
// Reads the local cache (already synced from relays).
export function tripCounts(pubkey) {
  return cached("trips:" + pubkey, () => computeTripCounts(pubkey));
}
const addrOf = (e) => `${e.pubkey}:${dtagOf(e)}`;

// All requests by id, and the newest version per address — built once
// per cache change and shared by every tripCounts() call.
function requestIndex() {
  return cached("reqIndex", () => {
    const byId = {};
    const latestByAddr = {}; // "pubkey:d" -> newest version
    relay.query({ kinds: [EVENT_KINDS.RIDE_REQUEST] }).forEach((e) => {
      byId[e.id] = e;
      if (!dtagOf(e)) return;
      const a = addrOf(e);
      if (!latestByAddr[a] || e.created_at > latestByAddr[a].created_at) latestByAddr[a] = e;
    });
    return { byId, latestByAddr, latest: Object.values(latestByAddr) };
  });
}

function computeTripCounts(pubkey) {
  const { latest } = requestIndex();
  const rides = latest.filter((e) => e.pubkey === pubkey && rideStatus(e) === "completed").length;
  const drives = latest.filter((e) => parse(e)?.driverPubkey === pubkey && rideStatus(e) === "completed").length;
  return { rides, drives };
}
