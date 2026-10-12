// Relay connection health: the reachability test, the "failed" state, and self-healing.
// A slow relay, or one that is reconnecting after a sleep, must not be reported as down. Run with: npm test
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
const { probeRelay } = await import("../src/nostr/reachable.js");
const { relay } = await import("../src/nostr/relay.js");

// A tiny server that completes the WebSocket handshake (nothing more).
const ok = http.createServer();
ok.on("upgrade", (req, socket) => {
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
});
// A server that accepts the connection and never answers.
const silent = net.createServer(() => {});
await Promise.all([new Promise((r) => ok.listen(0, "127.0.0.1", r)), new Promise((r) => silent.listen(0, "127.0.0.1", r))]);
const okUrl = `ws://127.0.0.1:${ok.address().port}`;
const silentUrl = `ws://127.0.0.1:${silent.address().port}`;

try {
  // ── The test connection ──
  assert.equal(await probeRelay(okUrl, 2000), true, "a relay that answers is reachable");
  assert.equal(await probeRelay(silentUrl, 300), false, "a relay that never answers is not");
  assert.equal(await probeRelay("ws://127.0.0.1:1", 1000), false, "a closed port is not");
  assert.equal(await probeRelay("not a url", 1000), false, "a bad address is not");

  // ── A slow start must not drop the relay: the pool waits longer than the library's 3 s default ──
  assert.ok(relay.pool.maxWaitForConnection >= 10000, "the pool waits for a slow connection: " + relay.pool.maxWaitForConnection);

  // ── relayState: only a RECENT failed test says "failed" ──
  const key = new URL(okUrl).origin.replace("http", "ws") + "/";
  const probes = [];
  relay._probe = async (k) => { probes.push(k); };
  relay.pool.listConnectionStatus = () => new Map();
  relay.health.set(key, { ok: false, at: Date.now() - 1000 });
  assert.equal(relay.relayState(okUrl), "failed", "a fresh failed test counts");
  relay.health.set(key, { ok: false, at: Date.now() - 20000 });
  assert.equal(relay.relayState(okUrl), "connecting", "an old failed test is out of date: not 'failed' while a new test runs");
  assert.ok(probes.includes(key), "an old result starts a new test");
  relay.pool.listConnectionStatus = () => new Map([[key, true]]);
  assert.equal(relay.relayState(okUrl), "connected");
  delete relay._probe;

  // ── Self-healing: reachable, but our own connection is gone → connect again (not more than once per 10 s) ──
  let resubscribed = 0;
  relay.syncing = true;
  relay._resubscribe = () => { resubscribed++; };
  relay.pool.listConnectionStatus = () => new Map([[key, false]]);
  relay.healedAt = 0;
  await relay._probe(key);
  assert.equal(relay.health.get(key).ok, true);
  assert.equal(resubscribed, 1, "a reachable relay with no live connection is reconnected");
  await relay._probe(key);
  assert.equal(resubscribed, 1, "…but not again within 10 seconds");
  relay.pool.listConnectionStatus = () => new Map([[key, true]]);
  relay.healedAt = 0;
  await relay._probe(key);
  assert.equal(resubscribed, 1, "a connected relay needs no healing");

  // ── A long sleep or a network change closes the old sockets and connects fresh ──
  let closed = null;
  relay.pool.close = (urls) => { closed = urls; };
  relay.health.set(key, { ok: false, at: Date.now() });
  relay.refreshConnections();
  assert.ok(Array.isArray(closed), "all sockets are closed");
  assert.equal(relay.health.size, 0, "old test results are forgotten");
  assert.equal(resubscribed, 2, "and the subscription is opened again");
} finally {
  ok.close(); silent.close();
}
console.log("relay health tests ok");
process.exit(0);
