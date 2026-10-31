// The Ride / Drive face of the one app: saved per account, not shared between accounts, and the tab rules.
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
const R = new URL("../src", import.meta.url).pathname;
const M = await import(`${R}/lib/mode.js`);
const A = await import(`${R}/config/app.js`);
const { consentedDrive } = await import(`${R}/lib/trips.js`);

const a = "a".repeat(64), b = "b".repeat(64);
assert.equal(M.getMode(a), "ride", "a new account starts in Ride");
M.saveMode(a, "drive");
assert.equal(M.getMode(a), "drive");
assert.equal(M.getMode(b), "ride", "another account on the same device is not touched");
assert.equal(mem.get("nostrride_mode_" + a.slice(0, 16)), '"drive"', "saved under the account's short key");
M.saveMode(a, "nonsense");
assert.equal(M.getMode(a), "ride", "anything but drive is Ride");
assert.equal(M.getMode(undefined), "ride");

assert.equal(M.roleOf("drive"), "driver");
assert.equal(M.roleOf("ride"), "rider");

// The tab on screen must belong to the face; Account is in both.
assert.equal(M.viewFor("drive", "home"), "drive");
assert.equal(M.viewFor("ride", "earnings"), "home");
assert.equal(M.viewFor("drive", "account"), "account");
assert.equal(M.viewFor("ride", "activity"), "activity");
assert.deepEqual(M.TABS.ride, ["home", "activity", "account"]);
assert.deepEqual(M.TABS.drive, ["drive", "earnings", "account"]);

// config/app.js: the role is a live binding that setAppRole moves (a screen reads it while it draws).
assert.equal(A.APP_ROLE, "rider"); assert.equal(A.IS_DRIVER_APP, false);
A.setAppRole("driver");
assert.equal(A.APP_ROLE, "driver"); assert.equal(A.IS_DRIVER_APP, true);
const live = await import(`${R}/config/app.js`);
assert.equal(live.IS_DRIVER_APP, true, "every importer sees the new value");
A.setAppRole("rider");
assert.equal(A.IS_DRIVER_APP, false);
A.setAppRole("whatever");
assert.equal(A.APP_ROLE, "rider", "anything but driver is the rider");
assert.equal(A.APP_NAME, "NostrRide");

// One person has both faces: a request they wrote is never a drive of their own.
assert.equal(consentedDrive({ id: "x", pubkey: a, tags: [], content: "{}" }, a), false);
console.log("mode ok");
