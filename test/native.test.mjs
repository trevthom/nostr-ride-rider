// Native background-location adapter, tested with a fake Capacitor plugin.
// Run with: npm test
import assert from "node:assert/strict";
const N = await import("../src/lib/nativeGeo.js");

assert.equal(N.isNative(), false, "plain browser/Node: not native");
let added, removed = [], cb;
globalThis.window = { Capacitor: { isNativePlatform: () => true, registerPlugin: () => ({
  addWatcher: async (opts, fn) => { added = opts; cb = fn; return "w1"; },
  removeWatcher: async ({ id }) => { removed.push(id); },
}) } };
assert.equal(N.isNative(), true);
const fixes = [], errors = [];
const stop = N.startNativeWatch((f) => fixes.push(f), (e) => errors.push(e));
await new Promise((r) => setTimeout(r, 5));
assert.equal(added.requestPermissions, true); assert.equal(added.stale, false); assert.ok(added.backgroundMessage && added.backgroundTitle, "needs a foreground notification");
cb({ latitude: 38.03, longitude: -84.5, accuracy: 12, time: 123 });
assert.deepEqual(fixes[0], { coords: { latitude: 38.03, longitude: -84.5, accuracy: 12 }, timestamp: 123 }, "same shape as the browser API");
cb(undefined, { code: "NOT_AUTHORIZED" }); assert.equal(errors[0].code, 1, "permission error maps to PositionError code 1");
stop(); await new Promise((r) => setTimeout(r, 5));
assert.deepEqual(removed, ["w1"], "stopping removes the watcher");
// Stopped before the watcher id came back: it is removed as soon as it arrives.
removed = [];
const stop2 = N.startNativeWatch(() => {}, () => {}); stop2(); await new Promise((r) => setTimeout(r, 5));
assert.deepEqual(removed, ["w1"]);
// No plugin: a clear error, not a crash.
globalThis.window = { Capacitor: { isNativePlatform: () => true } };
const errs = []; N.startNativeWatch(() => {}, (e) => errs.push(e)); assert.equal(errs[0].code, 2);
console.log("native checks passed");
process.exit(0);
