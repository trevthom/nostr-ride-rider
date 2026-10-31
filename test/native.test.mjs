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
// A foreground watcher: no background message (the plugin reads its presence to decide whether
// the app may keep running in the background), and the distance filter is passed straight through.
// distanceFilter 0 is what a `heartbeat` watcher asks for: every fix, so a hidden page still runs.
added = undefined;
const stopFg = N.startNativeWatch(() => {}, () => {}, { background: false, distanceFilter: 0 });
stopFg();
await new Promise((r) => setTimeout(r, 5));
assert.equal(added.backgroundMessage, undefined, "no message = no background mode");
assert.equal(added.backgroundTitle, undefined);
assert.equal(added.distanceFilter, 0, "0 = every fix");
// A background watcher keeps the message and the title it was given (the rider's own wording).
let bgOpts;
globalThis.window = { Capacitor: { isNativePlatform: () => true, registerPlugin: () => ({
  addWatcher: async (opts, fn) => { bgOpts = opts; cb = fn; return "w2"; },
  removeWatcher: async () => {},
}) } };
N.startNativeWatch(() => {}, () => {}, { background: true, title: "NostrRide", message: "Measuring this ride." });
await new Promise((r) => setTimeout(r, 5));
assert.equal(bgOpts.backgroundTitle, "NostrRide");
assert.equal(bgOpts.backgroundMessage, "Measuring this ride.");
assert.equal(bgOpts.distanceFilter, 10, "the default filter");
// Every fix reaches the heartbeat listeners BEFORE the map's move filter, even one that is ignored.
const heard = [];
const off = N.subscribeNativeFixes((f) => heard.push(f));
cb({ latitude: 1, longitude: 2, accuracy: 3, time: 5 });
assert.equal(heard.length, 1); assert.equal(heard[0].coords.latitude, 1);
off();
cb({ latitude: 1, longitude: 2, accuracy: 3, time: 6 });
assert.equal(heard.length, 1, "unsubscribed listeners stop hearing fixes");
// One listener that throws must not stop the others (the payment loop must keep being woken).
const offBad = N.subscribeNativeFixes(() => { throw new Error("boom"); });
const heard2 = [];
const offGood = N.subscribeNativeFixes(() => heard2.push(1));
cb({ latitude: 1, longitude: 2, accuracy: 3, time: 7 });
assert.equal(heard2.length, 1);
offBad(); offGood();
// No plugin: a clear error, not a crash.
globalThis.window = { Capacitor: { isNativePlatform: () => true } };
const errs = []; N.startNativeWatch(() => {}, (e) => errs.push(e)); assert.equal(errs[0].code, 2);
console.log("native checks passed");
process.exit(0);
