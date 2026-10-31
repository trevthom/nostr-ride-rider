// Trip sharing: link round trip, encryption only for link holders, safe parsing; contacts and sms links.
// Run with: npm test
import assert from "node:assert/strict";
const S = await import("../src/nostr/share.js");
const Safety = await import("../src/lib/safety.js");
const { verifyEvent } = await import("nostr-tools");

const token = S.newShareToken();
assert.match(token, /^[0-9a-f]{64}$/);
const link = S.shareLink("https://ride.example/track.html", token, ["wss://a.example", "wss://b.example", "wss://c.example", "wss://d.example"]);
const parsed = S.parseShareHash(new URL(link).hash);
assert.equal(parsed.token, token); assert.deepEqual(parsed.relays, ["wss://a.example", "wss://b.example", "wss://c.example"], "at most 3 relays in a link");

// The payload opens with the token and with nothing else.
const payload = { lat: 38.03, lng: -84.5, driver: "Dana", plate: "KY ABC123", stage: "riding" };
const ev = S.buildShareEvent(token, payload);
assert.ok(verifyEvent(ev), "signed by the throwaway key");
assert.equal(ev.kind, 30091); assert.ok(!ev.content.includes("ABC123"), "payload is encrypted");
assert.deepEqual(S.openShare(token, JSON.parse(ev.content).sealed), payload);
assert.equal(S.openShare(S.newShareToken(), JSON.parse(ev.content).sealed), null, "another key cannot read it");
// Updates for the same trip replace each other, in order.
const ev2 = S.buildShareEvent(token, payload);
assert.ok(ev2.created_at > ev.created_at);

// Hostile links give nothing / only safe relays.
assert.equal(S.parseShareHash("#k=zz"), null); assert.equal(S.parseShareHash(""), null);
assert.deepEqual(S.parseShareHash(`#k=${token}&r=javascript:alert(1),http://x,wss://ok.example`).relays, ["wss://ok.example"]);

// ── The shared position is the RIDER's own phone, not the car's, and goes out as often as the driver's pings ──
const fs = await import("node:fs");
const { LOCATION_PING_MS } = await import("../src/config/settings.js");
assert.equal(LOCATION_PING_MS, 6000);
// (Each exported app repository holds only its own app, so a file that is not there is skipped.)
const source = (rel) => { const u = new URL("../src/" + rel, import.meta.url); return fs.existsSync(u) ? fs.readFileSync(u, "utf8") : null; };
const driverSrc = source("driver/state/DriverContext.jsx"), riderSrc = source("rider/screens/OnTrip.jsx");
if (driverSrc) assert.ok(/const LOCATION_EVERY_MS = LOCATION_PING_MS/.test(driverSrc), "the driver's pings use the same constant");
if (riderSrc) assert.ok(/setInterval\(\(\) => send\(false\), LOCATION_PING_MS\)/.test(riderSrc), "and so does the shared trip");
const driveTripSrc = source("driver/screens/DriveTrip.jsx");
if (driveTripSrc) assert.ok(/setInterval\(\(\) => send\(false\), LOCATION_PING_MS\)/.test(driveTripSrc), "and so does the driver's shared trip");
const rider = { lat: 38.0406, lng: -84.5037, accuracy: 7.4 }, carAt = { lat: 38.05, lng: -84.51 };
const base = { name: "Rae", driver: "Dina", car: "2020 Toyota Prius", plate: "KY ABC123", from: { name: "A", lat: 1, lng: 2 }, to: { name: "B", lat: 3, lng: 4 }, eta: 4 };
const coming = Safety.sharePayload({ ...base, stage: "enroute", riderPos: rider, gps: "good", carLoc: carAt, now: 1000 });
assert.equal(coming.lat, rider.lat); assert.equal(coming.lng, rider.lng); assert.equal(coming.who, "rider");
assert.deepEqual(coming.carPos, carAt, "until the ride starts the car rides along");
assert.equal(coming.locTs, 1000); assert.equal(coming.acc, 7);
assert.notEqual(coming.lat, carAt.lat, "the position is the rider's, never the car's");
const riding = Safety.sharePayload({ ...base, stage: "riding", riderPos: rider, gps: "weak", carLoc: carAt, now: 2000 });
assert.equal(riding.carPos, undefined, "once they are in the car there is one position, the rider's");
assert.equal(riding.lat, rider.lat, "a weak fix still counts");
const stale = Safety.sharePayload({ ...base, stage: "riding", riderPos: rider, gps: "stale", carLoc: carAt, now: 3000 });
assert.equal(stale.lat, undefined, "a stale fix is not sent as if it were now"); assert.equal(stale.locTs, undefined);
assert.equal(Safety.sharePayload({ ...base, stage: "enroute", riderPos: null, gps: "searching", carLoc: null }).lat, undefined);
assert.equal(Safety.sharePayload({ ...base, stage: "enroute", riderPos: { lat: NaN, lng: 1 }, gps: "good" }).lat, undefined, "a broken position is not sent");
// Through the real encryption, to the viewer.
const sent = S.openShare(token, JSON.parse(S.buildShareEvent(token, coming).content).sealed);
assert.deepEqual(Safety.sharedPositions(sent), { rider: { lat: rider.lat, lng: rider.lng }, car: carAt });
assert.deepEqual(Safety.sharedPositions(riding), { rider: { lat: rider.lat, lng: rider.lng }, car: null });
assert.deepEqual(Safety.sharedPositions(stale), { rider: null, car: null }, "no position yet: the page says so");
assert.deepEqual(Safety.sharedPositions({ lat: 38.1, lng: -84.6, stage: "riding" }), { rider: null, car: { lat: 38.1, lng: -84.6 } }, "an update from an older app is the car, as before");
assert.deepEqual(Safety.sharedPositions({ ended: true, who: "rider", lat: 1, lng: 2 }), { rider: null, car: null });
assert.deepEqual(Safety.sharedPositions(null), { rider: null, car: null });

// ── A driver shares the same way: the DRIVER's own phone (the car), and it is the dot to draw ──
const drive = Safety.driverSharePayload({ name: "Dina", car: "2020 Toyota Prius", plate: "KY ABC123", stage: "riding", pos: carAt, gps: "good", eta: 3, from: base.from, to: base.to, now: 4000 });
assert.equal(drive.who, "driver");
assert.equal(drive.lat, carAt.lat); assert.equal(drive.lng, carAt.lng); assert.equal(drive.locTs, 4000);
assert.equal(drive.name, "Dina"); assert.equal(drive.driver, undefined, "the sharer is the driver: no second driver field");
assert.deepEqual(Safety.sharedPositions(drive), { rider: null, car: carAt }, "the driver's own phone is the dot to draw");
assert.equal(Safety.driverSharePayload({ ...drive, pos: carAt, gps: "stale", now: 5000 }).lat, undefined, "a stale fix is not sent as if it were now");
assert.equal(Safety.driverSharePayload({ name: "Dina", pos: null, gps: "searching" }).lat, undefined);
assert.equal(Safety.driverSharePayload({ name: "Dina", pos: { lat: NaN, lng: 1 }, gps: "good" }).lat, undefined, "a broken position is not sent");
// Through the real encryption, to the viewer.
const driveSent = S.openShare(token, JSON.parse(S.buildShareEvent(token, drive).content).sealed);
assert.deepEqual(Safety.sharedPositions(driveSent), { rider: null, car: carAt });

// Contacts and messages.
let c = [];
c = Safety.addContact(c, "Mom", "+1 (555) 014-2222");
assert.deepEqual(c, [{ name: "Mom", phone: "+15550142222" }]);
assert.equal(Safety.addContact(c, "Mom again", "+15550142222"), c, "duplicate phone ignored");
assert.equal(Safety.addContact(c, "", "+15550142222"), c); assert.equal(Safety.addContact(c, "X", "abc"), c, "bad phone ignored");
assert.equal(Safety.smsHref("+1 555 0142", "hi there"), "sms:+15550142?&body=hi%20there");
assert.equal(Safety.smsHref("", "x"), null);
assert.match(Safety.tripMessage({ name: "Riley", destination: "Rupp Arena", link: "L" }), /Riley is on a NostrRide trip to Rupp Arena. Follow along: L/);
assert.match(Safety.tripMessage({ name: "Riley", link: "L", sos: true }), /^SOS from Riley/);
console.log("share checks passed");
process.exit(0);
