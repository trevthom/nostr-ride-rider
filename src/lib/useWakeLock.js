// ════════════════════════════════════════════════════════════
//  useWakeLock — Keep the screen on while `active` is true. A web page
//  loses GPS and its relay connections when the phone sleeps, so a driver
//  who is online or on a trip needs the screen awake. Uses the Screen Wake
//  Lock API where the browser has it (Chrome, Safari 16.4+, Edge); does
//  nothing elsewhere. The browser drops the lock when the tab is hidden,
//  so it is asked for again when the tab comes back.
// ════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { isNative } from "./nativeGeo.js";

export function useWakeLock(active) {
  useEffect(() => {
    // The native shell keeps tracking with the screen off, so it does not need the screen awake.
    if (!active || isNative() || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel = null;
    let stopped = false;
    const acquire = async () => {
      try { sentinel = await navigator.wakeLock.request("screen"); } catch { /* denied (battery saver): carry on */ }
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
}
