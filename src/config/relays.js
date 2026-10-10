// ════════════════════════════════════════════════════════════
//  RELAY CONFIG — The single source of truth for which Nostr relays
//  the app talks to. Saved to the browser (localStorage) so changes
//  persist across navigation and reloads, and broadcast to listeners
//  (relay.js, live.js) so they can re-connect immediately.
//
//  Edit DEFAULT_RELAYS to change the out-of-the-box list.
// ════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
];

const RELAY_KEY = "nostrride_relays";
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(RELAY_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_RELAYS.slice();
}

let current = typeof window !== "undefined" ? load() : DEFAULT_RELAYS.slice();

export function getRelays() {
  return current;
}

export function setRelays(list) {
  current = list.slice();
  try {
    localStorage.setItem(RELAY_KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => { try { fn(current); } catch { /* ignore */ } });
}

// Re-open every relay subscription (after the network came back, or the tab woke up).
export function reconnectAll() {
  listeners.forEach((fn) => { try { fn(current); } catch { /* ignore */ } });
}

export function onRelaysChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// React hook: returns the current relay list and re-renders on change.
export function useRelays() {
  const [list, setList] = useState(getRelays());
  useEffect(() => onRelaysChange(setList), []);
  return list;
}

// ── Tiny generic settings persistence (e.g. driver notify prefs) ──
export function getSetting(key, fallback) {
  try {
    const raw = localStorage.getItem("nostrride_" + key);
    if (raw != null) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return fallback;
}

export function setSetting(key, value) {
  try {
    localStorage.setItem("nostrride_" + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
