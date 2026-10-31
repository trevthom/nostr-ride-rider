// ════════════════════════════════════════════════════════════
//  NATIVE GEO — Background location inside a native shell (Capacitor, see
//  native/README.md). A web page cannot track location once the screen is off
//  or the app is in the background; a native shell can, through a foreground
//  service (Android) or a background mode (iOS).
//
//  The plugin is looked up at RUN time (window.Capacitor), so the web build
//  has no dependency on it. In a plain browser isNative() is false and the
//  app uses the normal geolocation API (lib/useGeolocation.js).
//
//  Plugin: @capacitor-community/background-geolocation (addWatcher / removeWatcher).
//
//  BACKGROUND IS NOT JUST FOR DRIVERS. On iOS an app that holds a running location
//  session is not suspended: the same mechanism that keeps the driver's phone
//  reporting the car keeps the RIDER's page alive with the screen locked, which is
//  what lets the rider's payment loop keep paying ticks (features/payments/rideTicks.js).
//  A watcher started with `background: false` asks only for "While Using" permission
//  and stops with the app; one started with `background: true` asks for "Always" and
//  keeps running. So a watcher is started in the background only when it is wanted.
// ════════════════════════════════════════════════════════════

const cap = () => (typeof window !== "undefined" ? window.Capacitor : undefined);

export const isNative = () => !!cap()?.isNativePlatform?.();

export const isIos = () => cap()?.getPlatform?.() === "ios";

function plugin() {
  const c = cap();
  return c?.registerPlugin ? c.registerPlugin("BackgroundGeolocation") : c?.Plugins?.BackgroundGeolocation;
}

// ── Every fix, for whoever needs a heartbeat ──
// The location callbacks are the one thing the native side delivers even while the page is
// hidden: the rider's payment loop hangs off them (see useGeolocation's `heartbeat`), so a
// pocketed phone still pays what the ride has earned. Fixes are delivered to these listeners
// BEFORE the map's move filter, so a stationary heartbeat still counts.
const fixListeners = new Set();
export function subscribeNativeFixes(fn) {
  fixListeners.add(fn);
  return () => fixListeners.delete(fn);
}
const announce = (fix) => { for (const fn of fixListeners) { try { fn(fix); } catch { /* one listener must not stop the others */ } } };

// Start watching. onFix gets { coords: { latitude, longitude, accuracy }, timestamp }
// (the same shape as the browser API); onError gets a PositionError-like { code, message }.
//   title, message   the Android notification, and — because a message is what turns background
//                    mode ON in the plugin — whether this watcher runs in the background at all
//   background       false: foreground only, "While Using" permission (the default here is true
//                    for older callers; useGeolocation decides per screen)
//   distanceFilter   metres between fixes (0 = every fix, ~1/s, which is a heartbeat)
// Returns a function that stops the watcher.
export function startNativeWatch(onFix, onError, { title = "Driving with NostrRide", message = "Sharing your location with your rider.", background = true, distanceFilter = 10 } = {}) {
  const bg = plugin();
  if (!bg) { onError({ code: 2, message: "Background location is not available in this app." }); return () => {}; }
  let id = null;
  let stopped = false;
  bg.addWatcher(
    {
      // No message = no background mode (the plugin reads its presence), and no notification.
      ...(background ? { backgroundTitle: title, backgroundMessage: message } : {}),
      requestPermissions: true,
      stale: false,
      distanceFilter,
    },
    (location, error) => {
      if (error) {
        onError({ code: error.code === "NOT_AUTHORIZED" ? 1 : 2, message: error.message || "" });
        return;
      }
      if (!location) return;
      const fix = { coords: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy }, timestamp: location.time };
      announce(fix);
      onFix(fix);
    }
  ).then((watcherId) => {
    if (stopped) bg.removeWatcher({ id: watcherId }).catch(() => {});
    else id = watcherId;
  }).catch((e) => onError({ code: 2, message: e?.message || "" }));
  return () => {
    stopped = true;
    if (id !== null) bg.removeWatcher({ id }).catch(() => {});
  };
}
