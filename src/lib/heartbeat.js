// ════════════════════════════════════════════════════════════
//  HEARTBEAT — a clock the native shell hands to the page.
//
//  The rider's payment loop lives in the page (features/payments/rideTicks.js) and runs on
//  a 3 s timer. Two things stop that timer from meaning anything with the phone in a pocket:
//  iOS and Android throttle a hidden page's timers, and the background-location fixes that
//  used to wake the page dry up when the phone stops moving — a red light, a tunnel, a phone
//  laid on a seat, which is exactly when a long ride runs.
//
//  So the shell keeps its own clock: native/plugins/heartbeat (Swift + Kotlin) fires a timer
//  and evaluates one line of JavaScript, `window.__nostrRideBeat()`, which resumes the page
//  and lets the payment pass pay what fell due. It is only a clock — no key, no coin, no
//  wallet code and no signing move into native code; the page still pays the ride.
//
//  Looked up at RUN time (window.Capacitor), like nativeGeo.js, so the web build has no
//  dependency on it. In a browser startHeartbeat() does nothing and returns a no-op stop.
// ════════════════════════════════════════════════════════════

const cap = () => (typeof window !== "undefined" ? window.Capacitor : undefined);

// The name the Swift and Kotlin plugins call. Change it in all three places, or not at all.
export const BEAT_GLOBAL = "__nostrRideBeat";

// 15 s. A minute tick is at most this late, and a beat only costs a mint round trip when money
// is actually due (payDue pays nothing otherwise). Waking the page more often buys nothing.
export const BEAT_INTERVAL_MS = 15000;

// The same bounds the native side clamps to, so the two never disagree.
const MIN_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 60000;

function plugin() {
  const c = cap();
  return c?.registerPlugin ? c.registerPlugin("NostrRideHeartbeat") : c?.Plugins?.NostrRideHeartbeat;
}

// Who to tell when native says "now". A Set, so two screens asking for the same beat share
// one native timer instead of starting two.
const listeners = new Set();
const noop = () => {};
let started = false;

function fire() {
  for (const fn of [...listeners]) {
    try { fn(); } catch { /* one listener must not stop the others */ }
  }
}

function install() {
  if (typeof window === "undefined") return;
  window[BEAT_GLOBAL] = fire;
}

function uninstall() {
  if (typeof window === "undefined") return;
  if (window[BEAT_GLOBAL] === fire) delete window[BEAT_GLOBAL];
}

// Start waking `onBeat` from the shell's clock. Returns a function that stops it; the native
// timer is stopped when the LAST listener goes. Outside the native shell this does nothing:
// resolve to a no-op stop, never an error, so a browser and an older shell both keep working.
export function startHeartbeat(onBeat, { intervalMs = BEAT_INTERVAL_MS } = {}) {
  const c = cap();
  const native = c?.isNativePlatform?.() ? plugin() : null;
  if (typeof onBeat !== "function" || !native) return noop;

  listeners.add(onBeat);
  install();
  if (!started) {
    started = true;
    const asked = Number(intervalMs);
    const wait = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Number.isFinite(asked) ? asked : BEAT_INTERVAL_MS));
    // A shell built before this plugin existed rejects "not implemented": nothing to do, the
    // fixes and the 3 s timer still pay the ride.
    try { Promise.resolve(native.start({ intervalMs: wait })).catch(noop); } catch { /* no bridge */ }
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    listeners.delete(onBeat);
    if (listeners.size) return;
    started = false;
    uninstall();
    try { Promise.resolve(native.stop()).catch(noop); } catch { /* no bridge */ }
  };
}
