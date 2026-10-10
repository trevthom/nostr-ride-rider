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
