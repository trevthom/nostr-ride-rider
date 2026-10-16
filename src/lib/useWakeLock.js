// ════════════════════════════════════════════════════════════
//  useWakeLock — Keep the screen on while `active` is true. A web page
//  loses GPS and its relay connections when the phone sleeps, and its timers
//  stop: a RIDER's phone that sleeps stops paying the ride's ticks (the driver
//  then sees missed payments although the wallet is full), and a driver who is
//  online or on a trip stops sending position. Uses the Screen Wake Lock API
//  where the browser has it (Chrome, Safari 16.4+, Edge); does nothing elsewhere.
//  The browser drops the lock when the tab is hidden, so it is asked for again
//  when the tab comes back.
//
//    const unavailable = useWakeLock(active)
//      true when the page asked for the lock and does not hold it (no browser support, refused by
//      battery saver, released): the screen may go dark, so the app should tell the person to keep it on.
//      Always false in the native shell, which keeps working with the screen off.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { isNative } from "./nativeGeo.js";

export function useWakeLock(active) {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    // The native shell keeps tracking with the screen off, so it does not need the screen awake.
    if (!active || isNative()) { setUnavailable(false); return undefined; }
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) { setUnavailable(true); return undefined; }
    let sentinel = null;
    let stopped = false;
    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
        if (stopped) { sentinel.release().catch(() => {}); return; }
        setUnavailable(false);
        sentinel.addEventListener?.("release", () => { if (!stopped) setUnavailable(true); });
      } catch {
        /* denied (battery saver): carry on */
        if (!stopped) setUnavailable(true);
      }
    };
    const onVisible = () => { if (!stopped && document.visibilityState === "visible") acquire(); };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      try { sentinel?.release().catch(() => {}); } catch { /* ignore */ }
    };
  }, [active]);
  return active && unavailable;
}
