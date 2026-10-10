// ════════════════════════════════════════════════════════════
//  TRIPS — Work out "what is happening right now" from the event
//  cache, for both apps. Nothing is kept in app memory: the current
//  ride is always derived from signed events, so a reload or a second
//  device shows the same screen.
//
//    activeRideFor(requests, me)   rider: my open or running request
//    activeDriveFor(requests, me)  driver: the ride I am driving now
//    offersForRide(request)        offers the rider can still pick (not stale)
//    rankOffers(offers, pref)      put drivers of the rider's preferred gender first
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

// The ride this driver is driving right now (accepted and paid, not ended).
export function activeDriveFor(requests, me) {
  return (
    requests
      .filter((r) => parse(r)?.driverPubkey === me && rideStatus(r) === "in_progress" && fresh(r))
      .sort((a, b) => b.created_at - a.created_at)[0] || null
  );
}

// Every well-formed offer on a ride, newest per driver (no time limit).
function validOffers(request) {
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
      c && Number.isFinite(c.priceSats) && c.priceSats > 0 &&
      (c.upfrontSats || 0) >= 0 && (c.upfrontSats || 0) <= c.priceSats
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
// It is self-declared and optional, so it only orders the list; it never hides a driver.
export function offerGender(offer) {
  const g = parse(offer)?.gender;
  if (g === "male" || g === "female") return g;
  return getProfile(offer.pubkey)?.gender || "";
}

// Put drivers of the preferred gender ("male" | "female") first. Everyone else stays on the
// list, in the same order. With no preference the list is returned unchanged.
export function rankOffers(offers, pref) {
  if (pref !== "male" && pref !== "female") return offers;
  const rank = (o) => (offerGender(o) === pref ? 0 : 1);
  return offers.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map((x) => x.o);
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
