// Signed events: replaceable updates inside one second must still be ordered.
// Run with: npm test
import assert from "node:assert/strict";
const { buildSignedEvent } = await import("../src/nostr/events.js");
const { generateKeypair } = await import("../src/nostr/keys.js");
const me = generateKeypair(), other = generateKeypair();

const a = buildSignedEvent(0, { name: "a" }, [], me.sk);
const b = buildSignedEvent(0, { name: "b" }, [], me.sk);
const c = buildSignedEvent(0, { name: "c" }, [], me.sk);
assert.ok(a.created_at < b.created_at && b.created_at < c.created_at, "kind 0 updates are strictly ordered");

// Addressable: ordered per d-tag, independent across d-tags and authors.
const r1 = buildSignedEvent(30078, {}, [["d", "ride-1"]], me.sk);
const r2 = buildSignedEvent(30078, {}, [["d", "ride-1"]], me.sk);
const s1 = buildSignedEvent(30078, {}, [["d", "ride-2"]], me.sk);
const o1 = buildSignedEvent(30078, {}, [["d", "ride-1"]], other.sk);
assert.ok(r2.created_at > r1.created_at, "same address: later is newer");
assert.ok(s1.created_at <= r2.created_at, "a different d-tag is not pushed forward");
assert.ok(o1.created_at <= r2.created_at, "another author is not pushed forward");

// Regular events keep the real clock.
const now = Math.floor(Date.now() / 1000);
const n1 = buildSignedEvent(1, "hi", [], me.sk);
const n2 = buildSignedEvent(1, "hi", [], me.sk);
assert.ok(Math.abs(n1.created_at - now) <= 1 && n2.created_at === n1.created_at, "non-replaceable events are not shifted");
console.log("events checks passed");
process.exit(0);
