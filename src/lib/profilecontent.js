// ════════════════════════════════════════════════════════════
//  PROFILE CONTENT — What a profile save (kind 0) writes. The profile is shared by every app of the same person: the Rider app, the Driver
//  app and any other Nostr app. An app may hold an OLD copy of it (it was opened before the other app saved), so a save writes only the
//  fields it CHANGES (the keys of `patch`); every other field keeps the value of the newest profile in hand (`base`). Only when the
//  newest profile lacks a field does the app's own copy fill it in (a first save).
//
//    profileContent(base, next, patch)   base = newest kind-0 content (or {}), next = the user after the patch, patch = what changed
// ════════════════════════════════════════════════════════════

import { sealVehicle } from "./privacy.js";

export function profileContent(base, next, patch) {
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  const sealed = () => sealVehicle(next.vehicle, next.sk, next.publicKey); // the plate is sealed to ourselves; riders get it privately in offers
  const out = {
    ...base,
    name: has("name") ? next.name : (base.name ?? next.name),
    about: base.about ?? "NostrRide user",
    communication: has("comm") ? (next.comm || []) : (base.communication ?? (next.comm || [])),
    picture: has("picture") ? (next.picture || "") : (base.picture ?? (next.picture || "")),
    vehicle: has("vehicle") ? sealed() : (base.vehicle ?? sealed()),
  };
  for (const k of ["lud16", "gender", "rates", "stats"]) if (has(k)) out[k] = patch[k]; // rates null = back to the app's rates
  return out;
}
