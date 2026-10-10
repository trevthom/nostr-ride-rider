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

export function tripMessage({ name, destination, link, sos = false }) {
  return sos
    ? `SOS from ${name}: I need help. Follow my trip live: ${link}`
    : `${name} is on a NostrRide trip${destination ? ` to ${destination}` : ""}. Follow along: ${link}`;
}
