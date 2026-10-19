// ════════════════════════════════════════════════════════════
//  APPEARANCE — Light or dark look, saved on this device the moment it is changed. Two separate choices:
//    • the APPLICATION (`dark`): the screens, buttons and the phone's bar color. It does not touch the map.
//    • the MAP (`darkMap`): only the map tiles and the map's credit line. It does not touch the screens.
//  Both start light.
//    isDark() / isDarkMap()        the saved choices
//    setDark(on) / setDarkMap(on)  save and apply at once (no reload, no Save button)
//    applyAppearance()             put the choices on the page: the `dark` class and the `dark-map` class on <html> (the colors
//                                  are CSS variables, see src/index.css and tailwind.config.js) and the phone's bar color
//    useDark() / useDarkMap()      [value, setter] for a screen (re-renders when it changes, also from another tab)
//  public/theme-init.js applies the same choices before the first paint, so a reload does not flash white.
//  The keys are the ones getSetting("dark") and getSetting("darkMap") read (nostrride_dark, nostrride_darkMap).
// ════════════════════════════════════════════════════════════

import { useSyncExternalStore } from "react";
import { getSetting, setSetting } from "../config/relays.js";

const KEY = "dark";
const MAP_KEY = "darkMap";
export const BAR_COLORS = { light: "#ffffff", dark: "#0a0a0a" }; // <meta name="theme-color">

export const isDark = () => getSetting(KEY, false) === true;
export const isDarkMap = () => getSetting(MAP_KEY, false) === true;

export function applyAppearance(dark = isDark(), map = isDarkMap()) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", !!dark);
  document.documentElement.classList.toggle("dark-map", !!map);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? BAR_COLORS.dark : BAR_COLORS.light);
}

const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());
export function setDark(on) {
  setSetting(KEY, !!on);
  applyAppearance(!!on, isDarkMap());
  changed();
}
export function setDarkMap(on) {
  setSetting(MAP_KEY, !!on);
  applyAppearance(isDark(), !!on);
  changed();
}

// Another tab of the same app changed it: follow.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("storage", (e) => {
    if (e.key === "nostrride_" + KEY || e.key === "nostrride_" + MAP_KEY) { applyAppearance(); changed(); }
  });
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useDark = () => [useSyncExternalStore(subscribe, isDark, () => false), setDark];
export const useDarkMap = () => [useSyncExternalStore(subscribe, isDarkMap, () => false), setDarkMap];
