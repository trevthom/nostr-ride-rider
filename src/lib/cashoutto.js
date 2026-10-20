// ════════════════════════════════════════════════════════════
//  CASH OUT TO — Where this device sends money when the person cashes out. The cash out location (a Lightning address) is also
//  the `lud16` of the public profile (kind 0): riders tip it. A profile can be changed by anything that holds the person's nsec. If a
//  leaked nsec could change where THIS device sends the wallet's money, the 12-word wallet would be no safer than the nsec. So
//  money goes only to the address pinned ON THIS DEVICE (the person typed it and pressed Save in Account → Wallets, or this device had none and
//  took the profile's): the pinned address. It stays on this device. It is not in the settings backup and not in any event.
//
//    getCashOutTo(pk) / setCashOutTo(pk, address)   the pinned address ("" when none)
//    cashOutState({ profile, pinned })              "none" | "unconfirmed" | "changed" | "ok"
//        none         no address at all
//        unconfirmed  the profile has an address and this device has no pin yet. Nobody is asked: adoptProfileAddress pins it at once
//        changed      the profile now says something other than the pinned address (changed elsewhere)
//        ok           the pinned address is the profile's (or the profile has none)
//    onCashOutToChange(fn)                          hear about a change (screens and the automatic cash out)
//  Only "ok" lets the automatic cash out run. Nothing asks the person to confirm an address: Save pins it, and a device with no pin adopts the profile's.
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

// A device with NO pin yet takes the profile's address as its own, without asking (a new phone, an older version of the app). From then on the
// address is pinned and a later change of the profile is only a notice ("changed"). Returns the pinned address ("" when there is none).
export function adoptProfileAddress(pk, profile) {
  const have = getCashOutTo(pk);
  if (have) return have;
  const a = cleanAddress(profile);
  if (a) setCashOutTo(pk, a);
  return a;
}

export function cashOutState({ profile, pinned }) {
  const p = cleanAddress(profile), t = cleanAddress(pinned);
  if (!t) return p ? "unconfirmed" : "none";
  return p && p !== t ? "changed" : "ok";
}

export function onCashOutToChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
