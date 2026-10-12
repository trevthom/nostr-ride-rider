// ════════════════════════════════════════════════════════════
//  STOPS — The rider adds a stop or changes the destination while the ride
//  is under way. It works like the pickup change (lib/pickup.js):
//    • the rider asks (kind 30099, the new place sealed to the driver and to
//      the rider — only the ride's rider may ask);
//    • the assigned driver accepts (kind 30100). The driver's other choice is
//      to finish the ride (the normal "Finish ride").
//
//  When a change is accepted:
//    • a "stop" is added before the destination; a "destination" replaces it;
//    • a FLAT price becomes the driver's normal fare, counted from the START of
//      the ride (not from the stop); the rider is told before asking and again
//      when the driver accepts (lib/ticks.js convertToMetered);
//    • a ride that was already on the driver's normal fare keeps being charged
//      by time and distance at the driver's rates.
//
//    stopChanges(request)              all asks with their answer: [{ id, mode, at, status, event, c }]
//    stopTrip(request, user)           { stops, dropoff } after the accepted changes, as `user` may read them
//    fullTrip(request, user)           { pickup, dropoff, stops } with those changes applied
//    hasAcceptedStop(request)          true once any change was accepted (flat → normal fare)
//    nextStop(stops, dropoff, passed)  the place the driver is heading to now
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { rideDriver, rideKey, rideVersions } from "./rides.js";
import { seal, unseal, exactTrip } from "./privacy.js";

export const STOP_NOTE_FLAT =
  "Adding a stop or changing the destination turns a flat price into the driver's normal fare (a base rate, plus each mile and each minute), counted from the start of the ride.";
export const STOP_NOTE_METERED = "You keep paying the driver's normal fare for the extra distance and time.";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const etag = (e) => (e.tags.find((t) => t[0] === "e") || [])[1];
const place = (p) => (p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { name: String(p.name || "Stop").slice(0, 200), lat: p.lat, lng: p.lng } : null);

export function stopRequestEvent(request, user, driverPubkey, { mode, place: p }) {
  const latest = rideVersions(request)[0] || request;
  const changeId = String(Date.now());
  const body = { place: { name: p.name, lat: p.lat, lng: p.lng } };
  return {
    kind: EVENT_KINDS.RIDE_STOP_CHANGE,
    content: { changeId, mode: mode === "destination" ? "destination" : "stop", sealedDriver: seal(user.sk, driverPubkey, body), sealedSelf: seal(user.sk, user.publicKey, body) },
    tags: [["e", latest.id], ["p", driverPubkey], ["d", `stop-${rideKey(latest)}-${changeId}`], ["t", "ride-stop"]],
  };
}
export function stopReplyEvent(request, changeId, accepted) {
  const latest = rideVersions(request)[0] || request;
  return {
    kind: EVENT_KINDS.RIDE_STOP_REPLY,
    content: { changeId, accepted: !!accepted },
    tags: [["e", latest.id], ["p", request.pubkey], ["d", "stop-reply-" + changeId], ["t", "ride-stop"]],
  };
}

// Every ask, oldest first, with the driver's answer. Only the ride's rider can ask; only its driver can answer.
export function stopChanges(request) {
  const ids = new Set(rideVersions(request).map((e) => e.id));
  const driver = rideDriver(request);
  const replies = driver
    ? relay.query({ kinds: [EVENT_KINDS.RIDE_STOP_REPLY], authors: [driver] }).filter((e) => ids.has(etag(e))).map((e) => ({ c: parse(e), at: e.created_at }))
    : [];
  return relay
    .query({ kinds: [EVENT_KINDS.RIDE_STOP_CHANGE], authors: [request.pubkey] })
    .filter((e) => ids.has(etag(e)))
    .map((event) => ({ event, c: parse(event) }))
    .filter(({ c }) => c && typeof c.changeId === "string" && typeof c.sealedDriver === "string" && typeof c.sealedSelf === "string")
    .sort((a, b) => a.event.created_at - b.event.created_at || (a.c.changeId < b.c.changeId ? -1 : 1))
    .map(({ event, c }) => {
      const r = replies.filter((x) => x.c && x.c.changeId === c.changeId && typeof x.c.accepted === "boolean").sort((a, b) => b.at - a.at)[0];
      return { id: c.changeId, mode: c.mode === "destination" ? "destination" : "stop", at: event.created_at, status: r ? (r.c.accepted ? "accepted" : "declined") : "pending", event, c };
    });
}

// The place an ask names, if `user` may read it (the rider, or the assigned driver).
export function readStop(change, request, user) {
  if (!user) return null;
  const v = user.publicKey === request.pubkey
    ? unseal(user.sk, user.publicKey, change.c.sealedSelf)
    : user.publicKey === rideDriver(request) ? unseal(user.sk, request.pubkey, change.c.sealedDriver) : null;
  return place(v?.place);
}

export const hasAcceptedStop = (request) => stopChanges(request).some((c) => c.status === "accepted");

// The trip after every accepted change, oldest first: { stops: [place…], dropoff } (dropoff null = unchanged).
export function stopTrip(request, user) {
  const out = { stops: [], dropoff: null };
  for (const c of stopChanges(request)) {
    if (c.status !== "accepted") continue;
    const p = readStop(c, request, user);
    if (!p) continue;
    if (c.mode === "destination") out.dropoff = p;
    else out.stops.push(p);
  }
  return out;
}

// Where the car is heading while the rider is on board: the first stop not yet reached, else the destination.
export function nextStop(stops, dropoff, passed = 0) {
  return stops[Math.max(0, passed)] || dropoff;
}

// The whole trip as `user` may see it: { pickup, dropoff, stops } with the accepted changes applied (null if the
// exact trip is not readable yet).
export function fullTrip(request, user) {
  const t = exactTrip(request, user);
  if (!t) return null;
  const { stops, dropoff } = stopTrip(request, user);
  return { pickup: t.pickup, dropoff: dropoff || t.dropoff, stops };
}
