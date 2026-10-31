// The native heartbeat (lib/heartbeat.js) with a fake Capacitor shell.
// Run with: npm test
import assert from "node:assert/strict";
const H = await import("../src/lib/heartbeat.js");

// ── A plain browser, and Node: no shell, so nothing to start ──
assert.equal(typeof H.BEAT_GLOBAL, "string");
const noShell = H.startHeartbeat(() => { throw new Error("must never be called"); });
assert.equal(typeof noShell, "function");
noShell(); noShell(); // idempotent
globalThis.window = {}; // a page without Capacitor
const stopNoCap = H.startHeartbeat(() => {});
stopNoCap();

// ── A shell ──
let startArgs, stops = 0, starts = 0;
const makeShell = () => {
  globalThis.window = {
    Capacitor: {
      isNativePlatform: () => true,
      registerPlugin: () => ({
        start: async (opts) => { starts += 1; startArgs = opts; return { intervalMs: opts.intervalMs }; },
        stop: async () => { stops += 1; },
      }),
    },
  };
};
const beat = () => globalThis.window.__nostrRideBeat;

makeShell();
const beats = [];
const stop = H.startHeartbeat(() => beats.push(1));
await new Promise((r) => setTimeout(r, 5));
assert.equal(starts, 1, "the native timer is started once");
assert.deepEqual(startArgs, { intervalMs: H.BEAT_INTERVAL_MS });
assert.equal(typeof beat(), "function", "the page installs the function the shell calls");
assert.equal(beats.length, 0, "nothing beats until the shell says so");
beat()();
assert.equal(beats.length, 1);

// ── Two screens, one native timer ──
const more = [];
const stop2 = H.startHeartbeat(() => more.push(1));
assert.equal(starts, 1, "a second listener reuses the running timer");
beat()();
assert.equal(beats.length, 2); assert.equal(more.length, 1);
// One listener that throws must not stop the other: two rides' worth of money must keep being paid.
const stopBad = H.startHeartbeat(() => { throw new Error("boom"); });
beat()();
assert.equal(beats.length, 3); assert.equal(more.length, 2);
stopBad();

// ── The last one out stops the native timer and takes the hook away ──
stop2();
assert.equal(stops, 0, "still one listener: keep beating");
assert.equal(typeof beat(), "function");
stop();
assert.equal(stops, 1, "the native timer is stopped");
assert.equal(beat(), undefined, "and the shell has nothing left to call");

// ── The interval is clamped the same way as native, so the two cannot disagree ──
makeShell();
const stopsBefore = stops;
const fast = H.startHeartbeat(() => {}, { intervalMs: 10 });
await new Promise((r) => setTimeout(r, 5));
assert.deepEqual(startArgs, { intervalMs: 2000 }, "never faster than 2 s");
fast();
const slow = H.startHeartbeat(() => {}, { intervalMs: 10 * 60 * 1000 });
await new Promise((r) => setTimeout(r, 5));
assert.deepEqual(startArgs, { intervalMs: 60000 }, "never slower than 60 s");
slow();
const junk = H.startHeartbeat(() => {}, { intervalMs: "soon" });
await new Promise((r) => setTimeout(r, 5));
assert.deepEqual(startArgs, { intervalMs: H.BEAT_INTERVAL_MS }, "junk falls back to the default");
junk();
assert.equal(stops, stopsBefore + 3);

// ── An older shell: the plugin is not registered, so start() rejects. The page must not care. ──
globalThis.window = {
  Capacitor: {
    isNativePlatform: () => true,
    registerPlugin: () => ({ start: async () => { throw new Error("not implemented"); }, stop: async () => { throw new Error("not implemented"); } }),
  },
};
const old = H.startHeartbeat(() => {});
await new Promise((r) => setTimeout(r, 10));
assert.equal(typeof beat(), "function", "the page hook stays installed");
assert.equal(typeof old, "function");
old(); // and stopping it does not throw either

// ── A plugin that throws synchronously (no bridge yet) is no worse ──
globalThis.window = {
  Capacitor: {
    isNativePlatform: () => true,
    registerPlugin: () => ({ start: () => { throw new Error("no bridge"); }, stop: () => { throw new Error("no bridge"); } }),
  },
};
const thrown = H.startHeartbeat(() => {});
thrown();

console.log("heartbeat checks passed");
process.exit(0);
