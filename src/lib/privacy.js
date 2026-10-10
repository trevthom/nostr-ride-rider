// ════════════════════════════════════════════════════════════
//  PRIVACY — Keep exact addresses and license plates off the public
//  relays.
//
//   • A ride request publishes only a COARSE pickup/dropoff (area name +
//     a ~1 km grid point). The exact points are sealed (NIP-44) to the
//     rider's own key in `sealed`, so only the rider can read them.
//   • When the rider pays, RIDE_ACCEPT carries the exact points sealed
//     to the chosen driver. exactTrip() reads whichever copy you may.
//   • The driver's plate is sealed to their own key in their profile
//     (vehicle.sealedPlate) and sent sealed to the rider in each offer.
//   • The driver's license photo is sealed to their own key in its own event
//     (kind 30092). It is never sent to a rider.
// ════════════════════════════════════════════════════════════

import { nip44 } from "nostr-tools";
import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { getMetadata, getProfile } from "../nostr/profiles.js";
import { rideVersions } from "./rides.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const round2 = (n) => Math.round(n * 100) / 100; // ~1 km grid
const str = (v) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

// The public, coarse version of a picked place.
export function publicPlace(loc) {
  return { name: loc.area || "Approximate area", lat: round2(loc.lat), lng: round2(loc.lng), approx: true };
}

// Encrypt a JSON value so only `toPubkey` (and the sender) can read it.
export function seal(sk, toPubkey, value) {
  return nip44.encrypt(JSON.stringify(value), nip44.getConversationKey(sk, toPubkey));
}

// Decrypt a sealed value from `fromPubkey` (null if we can't). Cached
// per reader key (so a later login on this tab can't hit an earlier
// user's results), because screens re-read it on every render.
const opened = new WeakMap(); // sk -> Map("from:text" -> value)
export function unseal(sk, fromPubkey, text) {
  if (typeof text !== "string") return null;
  let cache = opened.get(sk);
  if (!cache) opened.set(sk, (cache = new Map()));
  const key = fromPubkey + ":" + text;
  if (cache.has(key)) return cache.get(key);
  let value = null;
  try { value = JSON.parse(nip44.decrypt(text, nip44.getConversationKey(sk, fromPubkey))); } catch { /* not for us */ }
  cache.set(key, value);
  return value;
}

const place = (p) =>
  p && typeof p.lat === "number" && typeof p.lng === "number" ? { name: str(p.name), lat: p.lat, lng: p.lng } : null;

// The exact {pickup, dropoff} of a ride, if `user` may see it: the rider
// (own sealed copy) or the driver the rider accepted. Old requests that
// published exact points in public return those. Else null.
export function exactTrip(request, user) {
  const c = parse(request);
  if (!c) return null;
  let trip = null;
  if (!c.sealed) trip = c; // legacy request: points are already public
  else if (!user) return null;
  else if (request.pubkey === user.publicKey) trip = unseal(user.sk, user.publicKey, c.sealed);
  else {
    const ids = rideVersions(request).map((e) => e.id);
    const accept = relay
      .query({ kinds: [EVENT_KINDS.RIDE_ACCEPT], authors: [request.pubkey], "#p": [user.publicKey], "#e": ids })
      .sort((a, b) => b.created_at - a.created_at)[0];
    const sealed = accept && parse(accept)?.sealed;
    if (sealed) trip = unseal(user.sk, request.pubkey, sealed);
  }
  const pickup = place(trip?.pickup), dropoff = place(trip?.dropoff);
  return pickup && dropoff ? { pickup, dropoff } : null;
}

// Split a vehicle into its public part + the plate sealed to ourselves.
export function sealVehicle(vehicle, sk, pubkey) {
  const { plateState, plateNumber, sealedPlate: _old, ...pub } = vehicle || {};
  return plateNumber ? { ...pub, sealedPlate: seal(sk, pubkey, { plateState, plateNumber }) } : pub;
}

// Our own vehicle from our profile, with the sealed plate opened.
export function myVehicle(pubkey, sk) {
  const v = getProfile(pubkey)?.vehicle;
  if (!v) return null;
  const plate = unseal(sk, pubkey, getMetadata(pubkey)?.vehicle?.sealedPlate);
  return plate ? { ...v, plateState: str(plate.plateState), plateNumber: str(plate.plateNumber) } : v;
}

// The plate a driver sent us (sealed) in an offer; legacy public plate
// from their profile as a fallback. Returns { plateState, plateNumber } or null.
export function offerPlate(offerEvent, user) {
  const sealed = offerEvent && parse(offerEvent)?.plate;
  const p = sealed && user ? unseal(user.sk, offerEvent.pubkey, sealed) : null;
  if (p?.plateNumber) return { plateState: str(p.plateState), plateNumber: str(p.plateNumber) };
  const v = offerEvent ? getProfile(offerEvent.pubkey)?.vehicle : null;
  return v?.plateNumber ? { plateState: v.plateState, plateNumber: v.plateNumber } : null;
}

// The event content for a license photo (a data URL), sealed to ourselves.
// An empty photo makes an empty record, which replaces the old one.
export function sealLicense(picture, sk, pubkey) {
  return picture ? { sealed: seal(sk, pubkey, { picture }) } : {};
}

// Our own license photo (a data URL), or "" if there is none. Reads the newest record.
export function myLicense(pubkey, sk) {
  const newest = relay
    .query({ kinds: [EVENT_KINDS.DRIVER_LICENSE], authors: [pubkey] })
    .reduce((a, b) => (!a || b.created_at >= a.created_at ? b : a), null);
  const c = newest && parse(newest);
  const opened = c?.sealed ? unseal(sk, pubkey, c.sealed) : null;
  return typeof opened?.picture === "string" && opened.picture.startsWith("data:image/") ? opened.picture : "";
}
