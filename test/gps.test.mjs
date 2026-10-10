// GPS quality: good / weak / stale, and readable messages.
// Run with: npm test
import assert from "node:assert/strict";
const { gpsStatus, gpsMessage, geoErrorText, GOOD_FIX_METERS, STALE_FIX_MS } = await import("../src/lib/gps.js");
const now = 1_000_000;
const fix = (accuracy) => ({ lat: 1, lng: 1, accuracy });
assert.equal(gpsStatus({ pos: null, seenAt: 0, error: "" }, now), "searching");
assert.equal(gpsStatus({ pos: null, seenAt: 0, error: "blocked" }, now), "error");
assert.equal(gpsStatus({ pos: fix(15), seenAt: now - 2000 }, now), "good");
assert.equal(gpsStatus({ pos: fix(GOOD_FIX_METERS), seenAt: now }, now), "good", "the limit itself is good");
assert.equal(gpsStatus({ pos: fix(1500), seenAt: now }, now), "weak", "an IP/Wi-Fi fix is weak");
assert.equal(gpsStatus({ pos: fix(15), seenAt: now - STALE_FIX_MS - 1 }, now), "stale", "an old fix is stale, even if it was accurate");
assert.equal(gpsMessage("good", fix(5), ""), "");
assert.match(gpsMessage("weak", fix(1500), ""), /1\.5 km/);
assert.match(gpsMessage("weak", fix(80 + 200), ""), /280 m/);
assert.match(geoErrorText({ code: 1 }), /blocked/i);
assert.match(geoErrorText({ code: 3 }), /too long/i);
assert.equal(geoErrorText({ message: "boom" }), "boom");
console.log("gps checks passed");
process.exit(0);
