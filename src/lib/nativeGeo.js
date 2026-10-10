// ════════════════════════════════════════════════════════════
//  NATIVE GEO — Background location when the driver app runs inside a native
//  shell (Capacitor, see native/README.md). A web page cannot track location
//  once the screen is off or the app is in the background; a native shell
//  can, through a foreground service (Android) or background mode (iOS).
//
//  The plugin is looked up at RUN time (window.Capacitor), so the web build
//  has no dependency on it. In a plain browser isNative() is false and the
//  app uses the normal geolocation API (lib/useGeolocation.js).
//
//  Plugin: @capacitor-community/background-geolocation (addWatcher / removeWatcher).
// ════════════════════════════════════════════════════════════

const cap = () => (typeof window !== "undefined" ? window.Capacitor : undefined);

export const isNative = () => !!cap()?.isNativePlatform?.();

function plugin() {
  const c = cap();
  return c?.registerPlugin ? c.registerPlugin("BackgroundGeolocation") : c?.Plugins?.BackgroundGeolocation;
}

// Start watching. onFix gets { coords: { latitude, longitude, accuracy }, timestamp }
// (the same shape as the browser API); onError gets a PositionError-like { code, message }.
// Returns a function that stops the watcher.
export function startNativeWatch(onFix, onError, { title = "Driving with NostrRide", message = "Sharing your location with your rider." } = {}) {
  const bg = plugin();
  if (!bg) { onError({ code: 2, message: "Background location is not available in this app." }); return () => {}; }
  let id = null;
  let stopped = false;
  bg.addWatcher(
    { backgroundTitle: title, backgroundMessage: message, requestPermissions: true, stale: false, distanceFilter: 10 },
    (location, error) => {
      if (error) {
        onError({ code: error.code === "NOT_AUTHORIZED" ? 1 : 2, message: error.message || "" });
        return;
      }
      if (location) onFix({ coords: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy }, timestamp: location.time });
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
