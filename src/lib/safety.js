// ════════════════════════════════════════════════════════════
//  SAFETY — Trusted contacts (kept on this device only) and the text /
//  links the safety sheet sends. Pure helpers, so they can be tested.
// ════════════════════════════════════════════════════════════

import { getSetting, setSetting } from "../config/relays.js";

const PHONE_RE = /^\+?[\d\s().-]{5,20}$/;

export const getContacts = () => getSetting("trustedContacts", []);
export const saveContacts = (list) => setSetting("trustedContacts", list.slice(0, 10));

// Add a contact; returns the new list (same list if the input is invalid or a duplicate).
export function addContact(list, name, phone) {
  const n = String(name || "").trim().slice(0, 40);
  const p = String(phone || "").trim();
  const digits = p.replace(/[^\d+]/g, "");
  if (!n || !PHONE_RE.test(p) || list.some((c) => c.phone === digits)) return list;
  return [...list, { name: n, phone: digits }];
}

// sms: link with the message filled in ("?&body=" works on both Android and iOS).
export function smsHref(phone, text) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  return digits ? `sms:${digits}?&body=${encodeURIComponent(text)}` : null;
}

// What the rider's phone sends to the people following a shared trip. The position is the RIDER's own (their phone), not the car's;
// the car, when it is not the same place yet (the driver is still coming), rides along as `car`. `who: "rider"` tells a viewer which it
// is (an older app put the car's position in lat/lng). A stale fix is left out: a friend must not see a position that is minutes old
// as if it were now. Needs { riderPos, gps: "good" | "weak" | "stale", carLoc, ... } — see rider/screens/OnTrip.jsx.
export function sharePayload({ name, driver, car, plate, stage, riderPos, gps, carLoc, eta, from, to, now = Date.now() }) {
  const here = riderPos && gps !== "stale" && Number.isFinite(riderPos.lat) && Number.isFinite(riderPos.lng) ? riderPos : null;
  const coach = carLoc && stage !== "riding" && Number.isFinite(carLoc.lat) && Number.isFinite(carLoc.lng) ? { lat: carLoc.lat, lng: carLoc.lng } : null;
  return {
    name, driver, car, plate, stage, eta,
    who: "rider",
    ...(here && { lat: here.lat, lng: here.lng, acc: Number.isFinite(here.accuracy) ? Math.round(here.accuracy) : undefined, locTs: now }),
    ...(coach && { carPos: coach }),
    from, to,
  };
}
// What the driver's phone sends to the people following a shared drive. The position is the DRIVER's own phone (the car);
// `who: "driver"` tells a viewer whose position it is. A stale fix is left out, as on the rider's side.
// Needs { name, car, plate, stage, pos, gps, eta, from, to } — see driver/screens/DriveTrip.jsx.
export function driverSharePayload({ name, car, plate, stage, pos, gps, eta, from, to, now = Date.now() }) {
  const here = pos && gps !== "stale" && Number.isFinite(pos.lat) && Number.isFinite(pos.lng) ? pos : null;
  return {
    name, car, plate, stage, eta,
    who: "driver",
    ...(here && { lat: here.lat, lng: here.lng, acc: Number.isFinite(here.accuracy) ? Math.round(here.accuracy) : undefined, locTs: now }),
    from, to,
  };
}
// What a viewer draws from a shared update: { rider, car } (each { lat, lng } or null). A driver's share puts their own
// phone (the car) in `car`; it is the dot to draw. An older app's update put the car's position in lat/lng too.
export function sharedPositions(p) {
  const pt = (x) => (x && Number.isFinite(x.lat) && Number.isFinite(x.lng) ? { lat: x.lat, lng: x.lng } : null);
  if (!p || p.ended) return { rider: null, car: null };
  if (p.who === "rider") return { rider: pt(p), car: pt(p.carPos) };
  return { rider: null, car: pt(p) }; // the driver's own phone, or an older app's car
}

export function tripMessage({ name, destination, link, sos = false }) {
  return sos
    ? `SOS from ${name}: I need help. Follow my trip live: ${link}`
    : `${name} is on a NostrRide trip${destination ? ` to ${destination}` : ""}. Follow along: ${link}`;
}
