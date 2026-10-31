// ════════════════════════════════════════════════════════════
//  TRIPS — Work out "what is happening right now" from the event
//  cache, for both apps. Nothing is kept in app memory: the current
//  ride is always derived from signed events, so a reload or a second
//  device shows the same screen.
//
//    activeRideFor(requests, me)   rider: my open or running request
//    activeDriveFor(requests, me)  driver: the ride I am driving now
//    offersForRide(request)        offers the rider can still pick (not stale)
//    onlyPreferredOffers(offers, pref)  keep the offers of drivers who declared the rider's preferred gender ("Female only" / "Male only")
//    isDirected(request)           the rider sent this request to chosen drivers only (browse list, map, or "notify nearest")
//    driverDeclines(request)       the drivers who turned this request down; driverDeclineEvent(request) is the event a driver sends
//    offerFrom(request, driver)    one driver's newest offer, however old
//    pendingOfferFor(me)           driver: my offer still waiting on a rider
//    acceptFor(request, driver)    the rider's RIDE_ACCEPT sent to this driver
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { latestVersions } from "../nostr/replaceable.js";
import { isRideExpired, rideStatus, rideVersions } from "./rides.js";
import { getProfile } from "../nostr/profiles.js";
import { OFFER_TTL_SECONDS } from "../config/settings.js";

const DAY = 86400000;
const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

// A ride still "in progress" a day after its last version was abandoned.
const fresh = (r) => Date.now() - r.created_at * 1000 < DAY;

// A request for a time well in the future is a reservation: it waits under
// "Upcoming" instead of taking over the rider's home screen.
const SOON_MS = 30 * 60000;
export function isScheduledLater(request) {
  const time = parse(request)?.time;
  if (!time || time === "ASAP") return false;
  const t = Date.parse(time);
  return !isNaN(t) && t - Date.now() > SOON_MS;
}

// Is this ride still open: waiting for a driver (not expired) or being driven?
export function isOpenRide(r) {
  const status = rideStatus(r);
  if (status === "requested") return !isRideExpired(parse(r), r.created_at);
  return (status === "accepted" || status === "in_progress") && fresh(r);
}

// The rider's current ride (newest first), or null when idle. Reservations
// more than 30 minutes away don't count until a driver is assigned.
export function activeRideFor(requests, me) {
  return (
    requests
      .filter((r) => r.pubkey === me && isOpenRide(r))
      .filter((r) => rideStatus(r) !== "requested" || !isScheduledLater(r))
      .sort((a, b) => b.created_at - a.created_at)[0] || null
  );
}

// The rider's reservations (open, scheduled for later), soonest first.
export function upcomingRidesFor(requests, me) {
  return requests
    .filter((r) => r.pubkey === me && rideStatus(r) === "requested" && isOpenRide(r) && isScheduledLater(r))
    .sort((a, b) => Date.parse(parse(a).time) - Date.parse(parse(b).time));
}

// A driver is on a ride only if they asked for it: they sent an offer for this request and the rider's
// signed accept names them. A request that merely NAMES a driver (anyone can sign one) is not a ride.
// Without this, a stranger could put any driver on a made-up ride, and the driver's app would start
// sending its live position to the stranger.
export function consentedDrive(request, me) {
  return request.pubkey !== me && !!offerFrom(request, me) && !!acceptFor(request, me); // never a ride with myself (one person has both faces)
}

// The ride this driver is driving right now (accepted and paid, not ended).
export function activeDriveFor(requests, me) {
  return (
    requests
      .filter((r) => parse(r)?.driverPubkey === me && rideStatus(r) === "in_progress" && fresh(r) && consentedDrive(r, me))
      .sort((a, b) => b.created_at - a.created_at)[0] || null
  );
}

// The drivers whose offer the rider turned down on this ride ("not this driver"). The request stays open for
// everyone else. Only the ride's own rider can decline: a decline from anyone else counts for nothing.
export function declinedDrivers(request) {
  const ids = rideVersions(request).map((e) => e.id);
  const out = new Set();
  relay.query({ kinds: [EVENT_KINDS.RIDE_OFFER_DECLINE], "#e": ids }).forEach((e) => {
    if (e.pubkey !== request.pubkey) return;
    const p = (e.tags.find((t) => t[0] === "p") || [])[1];
    if (p) out.add(p);
  });
  return out;
}

// The event that declines one driver's offer: { kind, content, tags } for publish().
export function declineEvent(request, offer) {
  const latest = rideVersions(request)[0] || request;
  return {
    kind: EVENT_KINDS.RIDE_OFFER_DECLINE,
    content: { requestId: latest.id, offerId: offer.id },
    tags: [["e", latest.id], ["e", offer.id], ["p", offer.pubkey], ["d", "decline-" + latest.id.slice(0, 16) + "-" + offer.pubkey.slice(0, 16)], ["t", "offer-decline"]],
  };
}

// Every well-formed offer on a ride, newest per driver (no time limit), except from drivers the rider declined.
function validOffers(request) {
  const declined = declinedDrivers(request);
  const ids = rideVersions(request).map((e) => e.id);
  const newest = new Map(); // a driver who re-offers replaces their earlier offer
  latestVersions(relay.query({ kinds: [EVENT_KINDS.RIDE_OFFER], "#e": ids })).forEach((o) => {
    const prev = newest.get(o.pubkey);
    if (!prev || o.created_at >= prev.created_at) newest.set(o.pubkey, o);
  });
  return [...newest.values()].filter((o) => {
    const c = parse(o);
    return (
      o.pubkey !== request.pubkey &&
      !declined.has(o.pubkey) &&
      c && Number.isFinite(c.priceSats) && c.priceSats > 0
    );
  });
}

// Offers the rider can still pick, best (soonest) first. For a ride needed
// now an offer is good for OFFER_TTL_SECONDS, so a driver is never chosen on
// a stale promise. (Once a driver is chosen, offerFrom() still finds theirs.)
export function offersForRide(request) {
  const oldest = isScheduledLater(request) ? 0 : Math.floor(Date.now() / 1000) - OFFER_TTL_SECONDS;
  return validOffers(request)
    .filter((o) => o.created_at >= oldest)
    .sort((a, b) => (parse(a).etaMinutes || 0) - (parse(b).etaMinutes || 0) || a.created_at - b.created_at);
}

// The gender a driver declared: in their offer, else in their profile. "" if none.
// It is self-declared and optional. A rider who asks for "Female only" or "Male only" sees only drivers who declared that gender.
export function offerGender(offer) {
  const g = parse(offer)?.gender;
  if (g === "male" || g === "female") return g;
  return getProfile(offer.pubkey)?.gender || "";
}

// With a preference ("male" | "female") only the offers of drivers who declared that gender stay; a driver with no declared gender is
// not shown. With no preference the list is returned unchanged.
export function onlyPreferredOffers(offers, pref) {
  if (pref !== "male" && pref !== "female") return offers;
  return offers.filter((o) => offerGender(o) === pref);
}

// ── A request sent to chosen drivers only ──
// The rider picked drivers from the list or the map (or ticked "Notify nearest driver immediately"). Such a request carries `directed: true`;
// it reaches only the drivers the rider named (lib/audienceStore.js), and AudienceSync does not spread it to others.
export const isDirected = (request) => parse(request)?.directed === true;

const dOf = (e) => (e.tags.find((t) => t[0] === "d") || [])[1];

// The drivers who turned the request down. A decline counts only from the driver who signed it (it can only take THAT driver off the list).
export function driverDeclines(request) {
  const ids = rideVersions(request).map((e) => e.id);
  const out = new Set();
  relay.query({ kinds: [EVENT_KINDS.RIDE_DRIVER_DECLINE], "#e": ids }).forEach((e) => {
    if (e.pubkey !== request.pubkey) out.add(e.pubkey);
  });
  return out;
}

// The event a driver sends to say no to a request that was sent to them: { kind, content, tags } for publish(). The rider's app shows it.
export function driverDeclineEvent(request) {
  const latest = rideVersions(request)[0] || request;
  return {
    kind: EVENT_KINDS.RIDE_DRIVER_DECLINE,
    content: { requestId: latest.id },
    tags: [["e", latest.id], ["p", request.pubkey], ["d", "driver-decline-" + dOf(request)], ["t", "driver-decline"]],
  };
}

// One driver's newest offer on a ride, however old (the price and plate of
// the driver who was chosen). null if they made none.
export function offerFrom(request, driverPubkey) {
  if (!driverPubkey) return null;
  return validOffers(request).find((o) => o.pubkey === driverPubkey) || null;
}

// The driver's newest offer that is still waiting on its rider: the ride is
// open and the offer is within its time to live. { offer, request } or null.
export function pendingOfferFor(me) {
  const oldest = Math.floor(Date.now() / 1000) - OFFER_TTL_SECONDS;
  const mine = relay
    .query({ kinds: [EVENT_KINDS.RIDE_OFFER], authors: [me] })
    .filter((o) => o.created_at >= oldest)
    .sort((a, b) => b.created_at - a.created_at);
  for (const offer of mine) {
    const reqId = (offer.tags.find((t) => t[0] === "e") || [])[1];
    const seen = relay.query({ kinds: [EVENT_KINDS.RIDE_REQUEST], ids: [reqId] })[0];
    if (!seen) continue;
    const request = rideVersions(seen)[0];
    if (declinedDrivers(request).has(me)) continue; // the rider turned this offer down: nothing left to wait for
    if (rideStatus(request) === "requested" && !isRideExpired(parse(request), request.created_at)) return { offer, request };
  }
  return null;
}

// The rider's RIDE_ACCEPT addressed to this driver (newest), or null.
export function acceptFor(request, driverPubkey) {
  const ids = rideVersions(request).map((e) => e.id);
  return (
    relay
      .query({ kinds: [EVENT_KINDS.RIDE_ACCEPT], authors: [request.pubkey], "#p": [driverPubkey], "#e": ids })
      .sort((a, b) => b.created_at - a.created_at)[0] || null
  );
}
