// ════════════════════════════════════════════════════════════
//  SESSION — The signed-in session of THIS TAB, so a reload does not log the person out and lands them on the same
//  screen. Kept in sessionStorage only: it is gone when the tab or window closes, and it is never written to
//  localStorage (the only long-lived copy of the key there is the encrypted "remember me" key, nostr/keystore.js).
//  Logging out clears it (AppContext).
//
//  What this costs: while the tab is open, a copy of the secret key sits in this tab's sessionStorage. The key is
//  already in the page's memory while the app runs, but a browser that restores the previous session after a crash
//  may bring this copy back too. On a shared device, log out before handing the phone over.
//
//    saveSession(user)                  keep the key + the profile fields the app draws
//    loadSession()                      the user object, or null
//    clearSession()                     forget the session, the tab and the Account screen (log out)
//    saveView/loadView                  the tab on screen (Ride / Activity / Account …)
//    saveAccountPage/loadAccountPage    the Account screen last open
// ════════════════════════════════════════════════════════════

import { keypairFromSecretKey } from "../nostr/keys.js";

const SESSION_KEY = "nostrride_session";
const VIEW_KEY = "nostrride_view";
const PAGE_KEY = "nostrride_account";

const read = (key) => {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
};
const write = (key, value) => {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* a browser that refuses storage: the person stays signed in for this page load only */ }
};

export function saveSession(user) {
  if (!user?.sk || user.sk.length !== 32) return;
  write(SESSION_KEY, {
    sk: Array.from(user.sk),
    profile: {
      name: user.name || "Anonymous",
      comm: user.comm || [],
      picture: user.picture || "",
      lud16: user.lud16 || "",
      gender: user.gender || "",
      rates: user.rates || null,
      vehicle: user.vehicle || null,
      stats: user.stats || null,
    },
  });
}

export function loadSession() {
  const saved = read(SESSION_KEY);
  if (!saved || !Array.isArray(saved.sk) || saved.sk.length !== 32) return null;
  try {
    return { ...keypairFromSecretKey(new Uint8Array(saved.sk)), ...(saved.profile || {}) };
  } catch {
    return null;
  }
}

// Log out: the encrypted "remember me" key is removed separately (nostr/keystore.js forgetKey).
export function clearSession() {
  write(SESSION_KEY, null);
  write(VIEW_KEY, null);
  write(PAGE_KEY, null);
}

export const saveView = (view) => write(VIEW_KEY, view);
export const loadView = (fallback) => read(VIEW_KEY) || fallback;
export const saveAccountPage = (page) => write(PAGE_KEY, page);
export const loadAccountPage = () => read(PAGE_KEY) || "home";
