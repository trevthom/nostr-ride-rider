// ════════════════════════════════════════════════════════════
//  NOTIFY — System notifications and the service worker.
//    registerServiceWorker()  once at start (production builds only)
//    showSystemNotification() shows one through the service worker, which
//                             works on phones; falls back to `new Notification`.
//  Notifications appear only while the app is open (even in a background
//  tab). Getting one with the app CLOSED needs a push server.
// ════════════════════════════════════════════════════════════

export function registerServiceWorker() {
  // Not inside the native shell: it ships its own files and has no use for the cache.
  if (typeof window === "undefined" || !import.meta.env?.PROD || !("serviceWorker" in navigator) || window.Capacitor?.isNativePlatform?.()) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn("Service worker failed:", e));
  });
}

export async function showSystemNotification(title, body) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) {
      await reg.showNotification(title, {
        body,
        tag: "nostrride",
        renotify: true,
        icon: new URL("icon-192.png", window.location.href).href,
        vibrate: [200, 100, 200],
      });
      return;
    }
  } catch { /* fall through */ }
  try { new Notification(title, { body }); } catch { /* not allowed here */ }
}
