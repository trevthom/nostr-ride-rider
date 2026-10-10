// relay.publish resolves on the first relay ack, false if all fail, no unhandled rejections.
// Run with: npm test
import assert from "node:assert/strict";
const { relay } = await import("../src/nostr/relay.js");
const delay = (ms, ok) => new Promise((res, rej) => setTimeout(() => (ok ? res("ok") : rej(new Error("connection failed"))), ms));
let n = 0; const ev = () => ({ id: "x" + ++n, pubkey: "a", kind: 30078, created_at: 1, tags: [], content: "{}" });
let unhandled = 0; process.on("unhandledRejection", () => unhandled++);
relay.pool.publish = () => [delay(50, false), delay(20, true), delay(5000, true)];
let t = Date.now(); assert.equal(await relay.publish(ev()), true); assert.ok(Date.now() - t < 1000, "resolves on first ack, not the slowest relay");
relay.pool.publish = () => [delay(10, false), delay(30, false)];
assert.equal(await relay.publish(ev()), false);
relay.pool.publish = () => [];
assert.equal(await relay.publish(ev()), false);
await new Promise((r) => setTimeout(r, 100));
assert.equal(unhandled, 0, "no unhandled rejections");

// An event no relay accepts waits in the outbox and is re-sent until one does.
relay.outbox.clear(); clearTimeout(relay._retryTimer); relay._retryTimer = null;
relay.retryDelays = [20];
let attempts = 0;
relay.pool.publish = () => (++attempts < 3 ? [delay(5, false)] : [delay(5, true)]);
const stuck = ev(); stuck.kind = 30084;
assert.equal(await relay.publish(stuck), false); assert.equal(relay.outboxSize(), 1, "queued after failing");
for (let i = 0; i < 40 && relay.outboxSize() > 0; i++) await new Promise((r) => setTimeout(r, 25));
assert.equal(relay.outboxSize(), 0, "sent once a relay accepted"); assert.equal(attempts, 3);
// Ephemeral events (live location) are never queued: they would be stale.
relay.pool.publish = () => [delay(5, false)];
const live = ev(); live.kind = 21100; await relay.publish(live);
assert.equal(relay.outboxSize(), 0, "ephemeral events are not queued");
console.log("publish checks passed"); process.exit(0);
