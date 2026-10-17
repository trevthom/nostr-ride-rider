// ════════════════════════════════════════════════════════════
//  APPEARANCE — Light or dark look, saved on this device the moment it is changed.
//    isDark()          the saved choice (light until the person turns dark on)
//    setDark(on)       save it and apply it at once (no reload, no Save button)
//    applyAppearance() put the choice on the page: the `dark` class on <html> (the colors are CSS
//                      variables, see src/index.css and tailwind.config.js) and the phone's bar color
//    useDark()         [dark, setDark] for a screen (re-renders when it changes, also from another tab)
//  public/theme-init.js applies the same choice before the first paint, so a reload does not flash white.
//  The key is the same one getSetting("dark") reads (nostrride_dark).
// ════════════════════════════════════════════════════════════

import { useSyncExternalStore } from "react";
import { getSetting, setSetting } from "../config/relays.js";

const KEY = "dark";
export const BAR_COLORS = { light: "#ffffff", dark: "#0a0a0a" }; // <meta name="theme-color">

export const isDark = () => getSetting(KEY, false) === true;

export function applyAppearance(dark = isDark()) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", !!dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? BAR_COLORS.dark : BAR_COLORS.light);
}

const listeners = new Set();
export function setDark(on) {
  setSetting(KEY, !!on);
  applyAppearance(!!on);
  listeners.forEach((fn) => fn());
}

// Another tab of the same app changed it: follow.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("storage", (e) => {
    if (e.key === "nostrride_" + KEY) { applyAppearance(); listeners.forEach((fn) => fn()); }
  });
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useDark = () => [useSyncExternalStore(subscribe, isDark, () => false), setDark];
