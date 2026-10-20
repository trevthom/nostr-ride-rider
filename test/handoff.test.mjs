// Letting go of a token that sits in an event: only when the event is safe (saved in the outbox, or taken by a relay). Also the
// durable outbox write, the wallet lock between windows, and the in-flight entry that is not yet "waiting".
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;

// A browser storage that can be made to refuse writes.
const mem = {};
let storageFull = false;
globalThis.localStorage = {
  getItem: (k) => mem[k] ?? null,
  setItem: (k, v) => { if (storageFull) throw new Error("QuotaExceededError"); mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};
const { relay } = await import(`${R}/nostr/relay.js`);
const { releaseWhenSafe } = await import(`${R}/features/payments/handoff.js`);
const { holdWalletLock } = await import(`${R}/nostr/walletlock.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

// ── releaseWhenSafe ──
const wallet = () => { const settled = []; return { settled, settle: (id) => settled.push(id) }; };
const flush = () => new Promise((r) => setTimeout(r, 5));
{
  const w = wallet();
  releaseWhenSafe(w, "a", Object.assign(Promise.resolve(false), { stored: true }));
  assert.deepEqual(w.settled, ["a"], "saved in the outbox: released at once");
  releaseWhenSafe(w, "b", Object.assign(Promise.resolve(true), { stored: false }));
  assert.deepEqual(w.settled, ["a"], "not yet: the relays have not answered");
  await flush();
  assert.deepEqual(w.settled, ["a", "b"], "a relay took it: released");
  releaseWhenSafe(w, "c", Object.assign(Promise.resolve(false), { stored: false }));
  releaseWhenSafe(w, "d", Promise.reject(new Error("boom")));
  releaseWhenSafe(w, "e", undefined);
  await flush();
  assert.deepEqual(w.settled, ["a", "b"], "neither saved nor taken: the token stays pending (recoverPending returns it if it never left)");
}

// ── A durable publish writes the outbox BEFORE it sends ──
const rider = generateKeypair(), driver = generateKeypair();
const tick = () => buildSignedEvent(K.RIDE_TICK, { seq: 1, amountSats: 10, sealed: "x" }, [["e", "a".repeat(64)], ["p", driver.publicKey], ["d", "tick-" + Math.random()], ["t", "nostrride"]], rider.sk);
const savedWraps = () => (JSON.parse(mem.nostrride_outbox || "[]")).length;
{
  const releases = [];
  relay._send = () => new Promise((r) => { releases.push(r); });
  const sent = relay.publish(tick(), { durable: true });
  assert.equal(sent.stored, true, "both wraps (the rider's own copy and the driver's) are saved already");
  assert.equal(savedWraps(), 2, "on disk before any relay answered");
  assert.equal(relay.outbox.size, 2);
  assert.equal(relay.outboxSize(), 0, "a first try that is still running is not a waiting update: no banner");
  assert.equal(relay.oldestOutboxAge(), 0);
  releases.forEach((r) => r(true));
  assert.equal(await sent, true);
  assert.equal(relay.outbox.size, 0, "a relay took them: they leave the outbox");
  assert.equal(savedWraps(), 0);
}
{
  relay._send = async () => false;
  const sent = relay.publish(tick(), { durable: true });
  assert.equal(sent.stored, true);
  assert.equal(await sent, false);
  assert.equal(relay.outbox.size, 2, "no relay answered: they stay, to be sent again");
  assert.equal(relay.outboxSize(), 2, "and now they count as waiting");
  assert.ok([...relay.outbox.values()].every((o) => !o.sending && o.tries === 1));
  clearTimeout(relay._retryTimer); relay._retryTimer = null;
  relay.outbox.clear(); relay._saveOutbox();
}
{
  storageFull = true;
  relay._send = async () => true;
  const sent = relay.publish(tick(), { durable: true });
  assert.equal(sent.stored, false, "the browser would not save them: the caller must keep the token");
  assert.equal(await sent, true, "but the relay took it");
  storageFull = false;
  relay.outbox.clear();
}
{
  // A plain publish is unchanged: it queues only after the relays failed.
  relay._send = async () => false;
  const ev = buildSignedEvent(K.RIDE_ALIVE, { role: "rider" }, [["e", "b".repeat(64)], ["p", driver.publicKey], ["d", "alive-x"], ["t", "nostrride"]], rider.sk);
  const sent = relay.publish(ev);
  assert.equal(sent.stored, false);
  await sent;
  assert.equal(relay.outbox.size, 2);
  clearTimeout(relay._retryTimer); relay._retryTimer = null;
  relay.outbox.clear(); relay._saveOutbox();
}

// ── The wallet lock: one window at a time ──
{
  const held = new Set(), line = [];
  const next = (name) => { for (let i = 0; i < line.length; i++) if (line[i].name === name && !held.has(name)) { const [w] = line.splice(i, 1); w.go(); return; } };
  const locks = {
    request(name, a, b) {
      const opts = typeof a === "function" ? {} : a, cb = typeof a === "function" ? a : b;
      return new Promise((resolve, reject) => {
        const run = () => { held.add(name); Promise.resolve(cb({ name })).then(resolve, reject).finally(() => { held.delete(name); next(name); }); };
        if (opts.ifAvailable) { if (held.has(name)) Promise.resolve(cb(null)).then(resolve, reject); else run(); return; }
        if (!held.has(name)) return run();
        const entry = { name, go: run };
        line.push(entry);
        opts.signal?.addEventListener("abort", () => { const i = line.indexOf(entry); if (i >= 0) { line.splice(i, 1); reject(new Error("AbortError")); } });
      });
    },
  };
  Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true, writable: true });
  let waits = 0;
  const a = holdWalletLock("w", { onWait: () => waits++ });
  await a.ready;
  assert.equal(waits, 0, "the first window opens the wallet at once");
  let opened = false;
  const b = holdWalletLock("w", { onWait: () => waits++ });
  b.ready.then(() => { opened = true; });
  await flush();
  assert.equal(waits, 1, "the second window is told to wait");
  assert.equal(opened, false, "and does not open the wallet");
  a.release();
  await flush();
  assert.equal(opened, true, "it opens as soon as the first lets go");
  const c = holdWalletLock("w");
  let cOpened = false; c.ready.then(() => { cOpened = true; });
  await flush();
  assert.equal(cOpened, false);
  c.release(); // a window that closes while waiting leaves no lock behind
  b.release();
  await flush();
  assert.equal(held.size, 0, "everything is let go");
  // No Web Locks (an old browser): no waiting.
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  await holdWalletLock("w").ready;
}
console.log("handoff tests ok");
