// ════════════════════════════════════════════════════════════
//  useGeolocation — React hook around the browser's GPS.
//  While `enabled` is true it watches the device location and returns
//    { pos: {lat,lng,accuracy} | null, error: string, status }
//  `status` (see lib/gps.js) says whether the fix is good, weak or stale.
//  It is re-checked every 10 s, so a lost signal turns "stale" on its own.
//
//  Notes:
//   • The browser shows a permission prompt the first time.
//   • Geolocation only works on https:// or http://localhost
//     (so `npm run dev` is fine; a deployed site needs HTTPS).
//   • Browsers pause GPS while the tab is hidden (see useWakeLock). Inside the
//     native shell (native/README.md) the same hook uses background location.
//
//  Inside the shell, options say what the watcher is for:
//     useGeolocation(true, { background, heartbeat, title, message })
//       background  keep receiving fixes with the app in the background ("Always" on iOS)
//       heartbeat   while in the background, take EVERY fix (~1/s) instead of one per 10 m:
//                   each fix is a sign the page is running, which is how a pocketed phone
//                   keeps paying the ride's ticks (RiderContext). Foreground keeps 10 m.
//   The returned `setBackground(bool)` turns background mode on or off; changing it restarts
//   the watcher, which is how the rider asks for "Always" only while a ride runs.
// ════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { haversineDistance } from "./geo.js";
import { gpsStatus, geoErrorText } from "./gps.js";
import { isNative, startNativeWatch } from "./nativeGeo.js";

const MIN_MOVE_METERS = 5; // smaller moves are GPS jitter: skip the re-render

export function useGeolocation(enabled, { background: back = true, heartbeat = false, title, message, distanceFilter = 10 } = {}) {
  const [pos, setPos] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("searching");
  const [background, setBackground] = useState(back); // the rider turns this on for the ride
  const raw = useRef({ pos: null, seenAt: 0, error: "" }); // latest fix, even if not re-rendered

  useEffect(() => {
    if (!enabled) {
      raw.current = { pos: null, seenAt: 0, error: "" };
      setPos(null);
      setError("");
      setStatus("searching");
      return;
    }
    if (!isNative() && !("geolocation" in navigator)) {
      setError("This browser doesn't support location.");
      setStatus("error");
      return;
    }

    // GPS fires about once a second even when standing still; every new
    // position re-renders the whole app, so ignore jitter.
    let last = null;
    const refresh = () => setStatus(gpsStatus(raw.current));
    const onFix = (p) => {
      const next = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      raw.current = { pos: next, seenAt: Date.now(), error: "" };
      setError(""); // a fix arrived; clear any old error (no re-render if already "")
      refresh();
      const moved = last ? haversineDistance(last.lat, last.lng, next.lat, next.lng) * 1609.344 : Infinity;
      if (moved < MIN_MOVE_METERS && Math.abs(next.accuracy - last.accuracy) < MIN_MOVE_METERS) return;
      last = next;
      setPos(next);
    };
    const onError = (e) => {
      const text = geoErrorText(e);
      raw.current = { ...raw.current, error: text };
      setError(text);
      refresh();
    };
    // Native shell: background-capable watcher. Browser: the normal geolocation API.
    let stop;
    if (isNative()) {
      stop = startNativeWatch(onFix, onError, { background, distanceFilter: heartbeat && background ? 0 : distanceFilter, ...(title ? { title, message } : {}) });
    } else {
      const id = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
      stop = () => navigator.geolocation.clearWatch(id);
    }
    const timer = setInterval(refresh, 10000); // a silent GPS must turn "stale"

    return () => { stop(); clearInterval(timer); };
  }, [enabled, background]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pos, error, status, setBackground };
}
