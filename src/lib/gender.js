// ════════════════════════════════════════════════════════════
//  GENDER — The rider's optional "Driver preference" (Account-free: it sits on the ride screen, kept on this device only, never published):
//  No preference | Female only | Male only. With "Female only" or "Male only" the rider sees ONLY the drivers who declared that gender
//  (kind 0 `gender`, also copied into presence and offers). A driver who never declared a gender is not shown to a rider who asked.
//
//    genderOfDriver(entry)       the gender a driver declared: in their presence / offer, else in their profile; "" if none
//    matchesGender(pref, g)      true when the preference is empty, or g is the preferred gender
//    onlyPreferred(drivers, pref)  the presence entries that match
// ════════════════════════════════════════════════════════════

import { getProfile } from "../nostr/profiles.js";

const ok = (g) => (g === "male" || g === "female" ? g : "");

// `entry`: a presence entry { pubkey, gender? } (or anything with those two fields).
export function genderOfDriver(entry) {
  if (!entry) return "";
  return ok(entry.gender) || ok(getProfile(entry.pubkey)?.gender);
}

export function matchesGender(pref, gender) {
  if (pref !== "male" && pref !== "female") return true;
  return ok(gender) === pref;
}

export function onlyPreferred(drivers, pref) {
  if (pref !== "male" && pref !== "female") return drivers;
  return (drivers || []).filter((d) => matchesGender(pref, genderOfDriver(d)));
}
