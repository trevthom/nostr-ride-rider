// ════════════════════════════════════════════════════════════
//  CASH OUT TO — Where this device sends money when the person cashes out. The cash out location (a Lightning address) is also
//  the `lud16` of the public profile (kind 0): riders tip it. A profile can be changed by anything that holds the person's nsec. If a
//  leaked nsec could change where THIS device sends the wallet's money, the 12-word wallet would be no safer than the nsec. So
//  money goes only to the address the person confirmed ON THIS DEVICE (typed it in Account → Wallets, or tapped "Yes, it is mine"):
//  the pinned address. It stays on this device. It is not in the settings backup and not in any event.
//
//    getCashOutTo(pk) / setCashOutTo(pk, address)   the pinned address ("" when none)
//    cashOutState({ profile, pinned })              "none" | "unconfirmed" | "changed" | "ok"
//        none         no address at all
//        unconfirmed  the profile has an address, this device never confirmed it (a new phone, or an older version of the app)
//        changed      the profile now says something other than the pinned address (changed elsewhere)
//        ok           the pinned address is the profile's (or the profile has none)
//    onCashOutToChange(fn)                          hear about a change (screens and the automatic cash out)
//  Only "ok" lets the automatic cash out run. A tap on Cash out in the "unconfirmed" state asks first.
// ════════════════════════════════════════════════════════════

import { getSetting, setSetting } from "../config/relays.js";

const key = (pk) => "cashoutTo_" + String(pk).slice(0, 16);
const listeners = new Set();

export const cleanAddress = (a) => String(a ?? "").trim().toLowerCase();

export function getCashOutTo(pk) {
  const v = getSetting(key(pk), "");
  return typeof v === "string" ? cleanAddress(v) : "";
}

export function setCashOutTo(pk, address) {
  const a = cleanAddress(address);
  setSetting(key(pk), a || null);
  listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}

export function cashOutState({ profile, pinned }) {
  const p = cleanAddress(profile), t = cleanAddress(pinned);
  if (!t) return p ? "unconfirmed" : "none";
  return p && p !== t ? "changed" : "ok";
}

export function onCashOutToChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
