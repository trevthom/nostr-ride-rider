// ════════════════════════════════════════════════════════════
//  RELAY — Stores and serves Nostr events for the whole app.
//
//  Connects to REAL Nostr relays (config/relays.js) via nostr-tools'
//  SimplePool, AND keeps a local in-memory cache. The cache lets the
//  rest of the app read events synchronously with query(); publish()
//  also broadcasts to the relays so OTHER devices see your events.
//
//  Two ingestion paths:
//    • _store  — TRUSTED: our own events (publish / publishLocal).
//    • _ingest — UNTRUSTED: events pulled from relays. These are
//      validated first, because kinds like 30078 are shared with other
//      Nostr apps (NIP-78); their content isn't our JSON. We accept a
//      relay event only if it carries our app tag AND has JSON content.
//
//  Safety: if relays are unreachable, publish()/query() still work
//  against the cache, so the app degrades to "local only". An event no relay
//  accepted goes into an OUTBOX (kept in localStorage) and is re-sent with
//  backoff, when the network returns, and after a reload, so a "trip
//  complete" is not lost to a bad signal.
// ════════════════════════════════════════════════════════════

import { SimplePool } from "nostr-tools/pool";
import { probeRelay } from "./reachable.js";
import { normalizeURL } from "nostr-tools/utils";
import { EVENT_KINDS, APP_TAG } from "./eventKinds.js";
import { getRelays, onRelaysChange } from "../config/relays.js";
import { GIFT_WRAP, SEALED_KINDS, wrap, unwrap, recipientsOf } from "./sealing.js";

// The app's kinds we sync from relays (NOT kind 0 / presence).
const APP_KINDS = [
  EVENT_KINDS.RIDE_REQUEST,
  EVENT_KINDS.RIDE_OFFER,
  EVENT_KINDS.RIDE_ACCEPT,
  EVENT_KINDS.RIDE_FINISH,
  EVENT_KINDS.RIDE_COMPLETE,
  EVENT_KINDS.RIDE_STAGE,
  EVENT_KINDS.RIDE_PAYMENT,
  EVENT_KINDS.RIDE_CONFIRM,
  EVENT_KINDS.RIDE_PICKUP_CHANGE,
  EVENT_KINDS.RIDE_PICKUP_REPLY,
  EVENT_KINDS.RIDE_TICK,
  EVENT_KINDS.RIDE_TICK_REPLY,
  EVENT_KINDS.RIDE_WAIVER,
  EVENT_KINDS.RIDE_ALIVE,
  EVENT_KINDS.RIDE_STOP_CHANGE,
  EVENT_KINDS.RIDE_STOP_REPLY,
  EVENT_KINDS.RIDE_OFFER_DECLINE,
  EVENT_KINDS.RIDE_DRIVER_DECLINE,
  EVENT_KINDS.VOUCH_LIST,
];

const nowSec = () => Math.floor(Date.now() / 1000);

// Only our events on shared relays: must carry the app tag and have
// JSON-parseable content.
function isOurs(event) {
  if (!event || !event.content) return false;
  try { JSON.parse(event.content); } catch { return false; }
  return (event.tags || []).some((t) => t[0] === "t" && t[1] === APP_TAG);
}

const PUBLISH_WAIT_MS = 15000; // how long a relay may take to answer a publish

class NostrRelay {
  constructor() {
    // enableReconnect: a dropped relay socket reconnects and re-sends its subscriptions.
    // maxWaitForConnection: the library's default (3 s) gives up on a slow start (a phone on a weak
    // network) and DROPS the relay from the pool for good, so the app looked disconnected until a reload.
    this.pool = new SimplePool({ enablePing: true, enableReconnect: true, maxWaitForConnection: 15000 });
    this.outbox = new Map(); // event id -> { event, tries, at } for events no relay accepted yet
    this.retryDelays = [3000, 8000, 20000, 45000, 90000, 180000]; // ms, by number of tries
    this.outboxListeners = new Set();
    this._retryTimer = null;
    this.events = [];
    this.seen = new Set(); // event ids, for de-duping
    // Indexes so query() doesn't scan every event: by kind, and by the
    // e/d/p tag values ("e:<id>" -> events). `order` keeps insertion order.
    this.byKind = new Map();
    this.byTag = new Map();
    this.order = new Map(); // id -> insertion index
    this.version = 0; // bumped on every store; lets callers memoize reads
    this.recentSince = 0; // fetchRecent watermark (seconds)
    this.health = new Map(); // url -> { ok, at } from the last connection probe
    this.probing = new Set();
    this.listeners = new Set();
    this.me = null; // { sk, pk }: who may open the wraps addressed to this device (setIdentity)
    this.seenWraps = new Set(); // wrap ids already opened (or found unreadable); the oldest are forgotten past wrapLimits.seenMax
    // Anyone can send a wrap to any key, and opening one costs a key agreement and a decryption. A flood of them must not freeze the app:
    // `budget` are opened at once per `windowMs`, the rest wait in a queue (at most `queueMax`, then they are dropped) and are
    // opened `batch` at a time every 250 ms.
    this.wrapLimits = { budget: 300, windowMs: 5000, queueMax: 3000, seenMax: 30000, batch: 100 };
    this.wrapWindowAt = 0;
    this.wrapsInWindow = 0;
    this.wrapQueue = [];
    this._wrapTimer = null;
    this.sub = null;
    this.wrapSub = null;
    this.syncing = false;
    this.historyAt = new Map(); // pubkey -> ms of last fetchHistory
    this.historyJobs = []; // queued fetchHistory runs (see _queue)
    this.historyRunning = 0;
    // If the relay list changes (added/removed in-app), reconnect.
    onRelaysChange(() => { if (this.syncing) this._resubscribe(); });
  }

  // Connect to the real relays and stream the app's events into the
  // cache. Safe to call once at startup.
  startSync() {
    if (this.syncing) return;
    this.syncing = true;
    this._resubscribe();
    this._loadOutbox();
  }

  _resubscribe() {
    try { this.sub && this.sub.close(); } catch { /* ignore */ }
    try {
      this.sub = this.pool.subscribeMany(
        getRelays(),
        { kinds: APP_KINDS, "#t": [APP_TAG], since: nowSec() - 86400 }, // only our events, last 24h (ONE filter object, not an array)
        { onevent: (ev) => this._ingest(ev) }
      );
    } catch (e) {
      console.error("Relay sync failed (running local-only):", e);
    }
    try { this.wrapSub && this.wrapSub.close(); } catch { /* ignore */ }
    this.wrapSub = null;
    if (!this.me) return;
    try {
      this.wrapSub = this.pool.subscribeMany(
        getRelays(),
        { kinds: [GIFT_WRAP], "#p": [this.me.pk], since: nowSec() - 86400 },
        { onevent: (ev) => this._ingest(ev) }
      );
    } catch (e) {
      console.error("Wrap sync failed:", e);
    }
  }

  // Who this device opens wraps for. Called at login (and with null at logout). Opens the wrap subscription.
  setIdentity(sk, pk) {
    const same = this.me && pk && this.me.pk === pk;
    this.me = sk && pk ? { sk, pk } : null;
    if (!same) { this.seenWraps = new Set(); this.wrapQueue = []; }
    if (this.syncing && !same) this._resubscribe();
  }

  // Put an event fetched from the relays into the cache (the same checks as the live subscription). True if it was new.
  ingest(event) { return this._ingest(event); }

  // Pull one user's profile (kind 0) from relays into the cache, so we
  // can show their display name (we don't sync the global kind-0 firehose).
  async fetchProfile(pubkey) {
    if (!pubkey) return;
    try {
      const events = await this.pool.querySync(getRelays(), { kinds: [EVENT_KINDS.METADATA], authors: [pubkey] });
      events.forEach((e) => this._ingest(e)); // METADATA is exempt from the app-tag check
    } catch {
      /* ignore */
    }
  }

  // A user's FULL ride history (the live sync only covers 24 h): what
  // they wrote, what was addressed to them, every version of the rides
  // those events point at, and the finishes/payments on those
  // rides. Feeds Past Rides and trip counts. At most once per 5 min per
  // pubkey unless `force`. Resolves when done (never rejects).
  async fetchHistory(pubkey, { force = false } = {}) {
    if (!pubkey) return;
    if (!force && Date.now() - (this.historyAt.get(pubkey) || 0) < 300000) return;
    this.historyAt.set(pubkey, Date.now());
    return this._queue(() => this._history(pubkey));
  }

  // Relays cap open subscriptions per connection, and the Drive screen
  // asks for many riders at once, so run at most 3 history loads at a time.
  _queue(job) {
    return new Promise((resolve) => {
      this.historyJobs.push(async () => {
        try { await job(); } finally { this.historyRunning--; this._drain(); resolve(); }
      });
      this._drain();
    });
  }

  _drain() {
    while (this.historyRunning < 3 && this.historyJobs.length) {
      this.historyRunning++;
      this.historyJobs.shift()();
    }
  }

  async _history(pubkey) {
    const q = (f) => this.pool.querySync(getRelays(), { "#t": [APP_TAG], limit: 500, ...f }).catch(() => []);
    const take = (evs) => evs.forEach((e) => this._ingest(e));
    const chunks = (arr, n = 100) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    const tagVals = (evs, name) => [...new Set(evs.flatMap((e) => e.tags.filter((t) => t[0] === name).map((t) => t[1])))];
    try {
      // 1) Everything they wrote, and everything addressed to them.
      const first = (await Promise.all([q({ kinds: APP_KINDS, authors: [pubkey] }), q({ kinds: APP_KINDS, "#p": [pubkey] })])).flat();
      take(first);
      // Our own sealed jobs: the wraps addressed to us. (Another person's wraps are not ours to open.)
      if (this.me && pubkey === this.me.pk) {
        take(await this.pool.querySync(getRelays(), { kinds: [GIFT_WRAP], "#p": [pubkey], limit: 1000 }).catch(() => []));
      }
      // 2) The rides those events point at, then every version of each.
      const missing = tagVals(first, "e").filter((id) => !this.seen.has(id));
      for (const ids of chunks(missing)) take(await q({ ids }));
      const refs = new Set([...tagVals(first, "e"), ...first.map((e) => e.id)]);
      const rides = this.query({ kinds: [EVENT_KINDS.RIDE_REQUEST] }).filter((e) => refs.has(e.id));
      const authors = [...new Set(rides.map((e) => e.pubkey))];
      for (const ds of chunks(tagVals(rides, "d"))) {
        if (authors.length) take(await q({ kinds: [EVENT_KINDS.RIDE_REQUEST], authors, "#d": ds }));
      }
      // 3) How each ride ended, and what was paid.
      const dset = new Set(tagVals(rides, "d"));
      const versionIds = this.query({ kinds: [EVENT_KINDS.RIDE_REQUEST], authors })
        .filter((e) => dset.has((e.tags.find((t) => t[0] === "d") || [])[1]))
        .map((e) => e.id);
      for (const ids of chunks(versionIds)) {
        take(await q({ kinds: APP_KINDS.filter((k) => k !== EVENT_KINDS.RIDE_REQUEST && k !== EVENT_KINDS.RIDE_OFFER && k !== EVENT_KINDS.RIDE_ACCEPT), "#e": ids }));
      }
    } catch (e) {
      console.error("History fetch failed:", e);
    }
  }

  // Pull of recent app events from the relays into the cache. Used by
  // the Refresh buttons and the screens' polls. The first call asks for
  // 24 h; later calls ask only for what's new since the last one (minus
  // 2 min for clock skew), so polls don't re-download the whole day.
  async fetchRecent() {
    const started = nowSec();
    const since = Math.max(started - 86400, this.recentSince - 120);
    try {
      const events = await this.pool.querySync(getRelays(), {
        kinds: APP_KINDS,
        "#t": [APP_TAG],
        since,
      });
      this.recentSince = started;
      let added = 0;
      if (this.me) {
        const wraps = await this.pool.querySync(getRelays(), { kinds: [GIFT_WRAP], "#p": [this.me.pk], since }).catch(() => []);
        wraps.forEach((w) => { if (this._ingest(w)) added++; });
      }
      events.forEach((e) => { if (this._ingest(e)) added++; });
      return added;
    } catch (e) {
      console.error("Relay fetch failed:", e);
      return 0;
    }
  }

  // Publish: cache (trusted) + broadcast to relays. Resolves to true as
  // soon as ANY relay accepts the event, or false once all have failed.
  // Every relay's promise gets a handler, so a dead relay never throws an
  // unhandled rejection.
  //
  // `durable` (a job event that carries money, such as a tick): the wraps are written to the outbox BEFORE the first send, and leave it
  // only when a relay accepts them. The returned promise then has `.stored`: true when every wrap is safely saved on this device. Until
  // then the caller must not let go of the ecash the event carries (features/payments/handoff.js).
  publish(event, { to = [], durable = false } = {}) {
    this._store(event);
    if (SEALED_KINDS.has(event.kind)) return this._publishSealed(event, recipientsOf(event, to), durable);
    return this._send(event).then((ok) => {
      if (!ok) this._enqueue(event);
      return ok;
    });
  }

  // A job event goes out ONLY inside gift wraps, one for each person who must read it (nostr/sealing.js). True when any wrap was accepted.
  _publishSealed(inner, recipients, durable = false) {
    const wraps = recipients.map((pk) => wrap(inner, pk));
    let stored = durable && wraps.length > 0;
    if (durable) for (const w of wraps) if (!this._enqueue(w, inner, { sending: true })) stored = false;
    const sent = Promise.all(wraps.map((w) => this._sendWrap(inner, w, durable))).then((r) => r.some(Boolean));
    sent.stored = stored;
    return sent;
  }

  async _sendWrap(inner, w, durable = false) {
    const ok = await this._send(w);
    const waiting = this.outbox.get(w.id);
    if (ok) {
      if (waiting) { this.outbox.delete(w.id); this._saveOutbox(); }
    } else if (durable && waiting) {
      waiting.sending = false; // the first try failed: it is an ordinary waiting update now
      waiting.tries++;
      this._saveOutbox();
      this._schedule();
    } else if (!durable) {
      this._enqueue(w, inner);
    }
    return ok;
  }

  // Send a job event that was already published to more people (a driver who came online after the request, say).
  sealTo(inner, recipients) {
    if (!SEALED_KINDS.has(inner.kind)) return Promise.resolve(false);
    return this._publishSealed(inner, recipients.filter((pk) => pk !== inner.pubkey));
  }

  // ── Outbox: events no relay has accepted yet ──
  // An entry whose FIRST send is still running (`sending`, a durable publish) is not "waiting" yet: it is counted and aged only once that try failed.
  outboxSize() { let n = 0; for (const o of this.outbox.values()) if (!o.sending) n++; return n; }
  // How long (ms) this event has been waiting in the outbox; 0 if it is not waiting (sent, or never failed).
  // `id` is a plain event's id or the id of a sealed event (the oldest of its waiting wraps counts).
  outboxAge(id) {
    let at = 0;
    for (const [k, o] of this.outbox) if (!o.sending && (k === id || o.inner?.id === id) && (!at || o.at < at)) at = o.at;
    return at ? Date.now() - at : 0;
  }
  oldestOutboxAge() { let m = 0; for (const o of this.outbox.values()) if (!o.sending) m = Math.max(m, Date.now() - o.at); return m; }
  onOutbox(fn) { this.outboxListeners.add(fn); return () => this.outboxListeners.delete(fn); }

  // Returns true when the event is saved in the outbox on this device (false: an ephemeral event, or the browser would not save it).
  _enqueue(event, inner = null, { sending = false } = {}) {
    if (event.kind >= 20000 && event.kind < 30000) return false; // ephemeral: stale by the time it could be re-sent
    if (!this.outbox.has(event.id)) this.outbox.set(event.id, { event, inner, tries: 0, at: Date.now(), sending });
    const saved = this._saveOutbox();
    if (!sending) this._schedule();
    return saved;
  }

  _schedule() {
    const waiting = [...this.outbox.values()].filter((o) => !o.sending);
    if (this._retryTimer || !waiting.length) return;
    const tries = Math.min(...waiting.map((o) => o.tries));
    const delay = this.retryDelays[Math.min(tries, this.retryDelays.length - 1)];
    this._retryTimer = setTimeout(() => { this._retryTimer = null; this.flushOutbox(); }, delay);
  }

  // Try every waiting event now (also called when the network returns).
  async flushOutbox() {
    const day = 86400000;
    for (const [id, o] of this.outbox) if (Date.now() - o.at > day) this.outbox.delete(id);
    await Promise.all(
      [...this.outbox.values()].filter((o) => !o.sending).map(async (o) => {
        o.tries++;
        if (await this._send(o.event)) this.outbox.delete(o.event.id);
      })
    );
    this._saveOutbox();
    this._schedule();
  }

  // Writes the outbox to the browser's storage. Returns false when the browser would not save it (a full or blocked storage).
  _saveOutbox() {
    let saved = true;
    try { localStorage.setItem("nostrride_outbox", JSON.stringify([...this.outbox.values()].map((o) => ({ event: o.event, inner: o.inner, at: o.at })))); } catch { saved = false; }
    this.outboxListeners.forEach((fn) => { try { fn(this.outboxSize()); } catch { /* ignore */ } });
    return saved;
  }

  _loadOutbox() {
    try {
      const saved = JSON.parse(localStorage.getItem("nostrride_outbox") || "[]");
      saved.forEach((s) => {
        if (!s?.event?.id) return;
        this._store(s.inner || s.event); // a wrap carries its inner event: that is what the screens read
        this.outbox.set(s.event.id, { event: s.event, inner: s.inner || null, tries: 0, at: s.at || Date.now() });
      });
      if (this.outbox.size) setTimeout(() => this.flushOutbox(), 1500);
    } catch { /* no storage or bad data */ }
  }

  // Send to the relays; resolves true once any accepts, false if none do.
  // A relay has PUBLISH_WAIT_MS to answer "OK" (the library's own 4.4 s is too short on a slow network: the send
  // "failed" although the relay was fine, and the app warned about it).
  _send(event) {
    try {
      this.pool.relays?.forEach?.((r) => { r.publishTimeout = PUBLISH_WAIT_MS; });
      const sends = this.pool.publish(getRelays(), event);
      return new Promise((resolve) => {
        let left = sends.length;
        if (!left) resolve(false);
        sends.forEach((p) => p.then(() => resolve(true), () => { if (--left === 0) resolve(false); }));
      });
    } catch (e) {
      console.error("Relay publish failed (kept locally):", e);
      return Promise.resolve(false);
    }
  }

  // Cache only (demo data / our own events that shouldn't hit relays).
  publishLocal(event) {
    this._store(event);
  }

  // Synchronous read from the local cache. Starts from the smallest
  // index the filter allows, then checks the full filter.
  query(filter) {
    let candidates = this.events;
    const tagKey = ["#e", "#d", "#p"].find((k) => filter[k]);
    if (tagKey) {
      const lists = filter[tagKey].map((v) => this.byTag.get(tagKey[1] + ":" + v) || []);
      candidates = lists.length === 1 ? lists[0] : this._merge(lists);
    } else if (filter.kinds) {
      const lists = filter.kinds.map((k) => this.byKind.get(k) || []);
      candidates = lists.length === 1 ? lists[0] : this._merge(lists);
    }
    return candidates.filter((e) => this._matches(e, filter));
  }

  // Union of index lists, de-duplicated, in insertion order.
  _merge(lists) {
    const byId = new Map();
    lists.forEach((l) => l.forEach((e) => byId.set(e.id, e)));
    return [...byId.values()].sort((a, b) => this.order.get(a.id) - this.order.get(b.id));
  }

  _index(map, key, event) {
    const list = map.get(key);
    if (list) list.push(event);
    else map.set(key, [event]);
  }

  // Kept for API compatibility; returns current cache matches.
  subscribe(_id, filter) {
    return this.query(filter);
  }

  // Connection state of one relay: "connected" | "failed" | "connecting".
  // The pool forgets relays that fail to connect, so we test them ourselves (at most every 15 s,
  // with a separate socket, see nostr/reachable.js). Only a RECENT failed test counts as "failed":
  // an old one is out of date, so the answer stays "connecting" while a new test runs.
  relayState(url) {
    let key;
    try { key = normalizeURL(url); } catch { return "failed"; }
    if (this.pool.listConnectionStatus().get(key)) return "connected";
    const h = this.health.get(key);
    const age = h ? Date.now() - h.at : Infinity;
    if (age > 15000) this._probe(key);
    return h && !h.ok && age <= 15000 ? "failed" : "connecting";
  }

  // Is at least one relay connected right now? (Used to leave relay outages out of the silence clock.)
  linkUp() {
    try {
      for (const up of this.pool.listConnectionStatus().values()) if (up) return true;
    } catch { /* no pool state */ }
    return false;
  }

  async _probe(key) {
    if (this.probing.has(key)) return;
    this.probing.add(key);
    try {
      const ok = await probeRelay(key, 10000);
      this.health.set(key, { ok, at: Date.now() });
      // The relay answers, but our own connection to it is gone (a slow start, a sleep, a network change):
      // connect again now instead of waiting for the library's slow retries.
      if (ok && !this.pool.listConnectionStatus().get(key)) this._heal();
    } finally {
      this.probing.delete(key);
    }
  }

  // Open the live subscription again (at most once every 10 s).
  _heal() {
    const now = Date.now();
    if (!this.syncing || now - (this.healedAt || 0) < 10000) return;
    this.healedAt = now;
    this._resubscribe();
  }

  // After a long sleep or a network change the sockets can be dead without telling us (the library
  // notices only after a ping times out, up to ~50 s). Close them all and connect fresh.
  refreshConnections() {
    if (!this.syncing) return;
    try { this.pool.close(getRelays()); } catch { /* nothing to close */ }
    this.health.clear();
    this.healedAt = Date.now();
    this._resubscribe();
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // TRUSTED add (our own events). Always stored.
  _store(event) {
    if (this.seen.has(event.id)) return false;
    this.seen.add(event.id);
    this.order.set(event.id, this.events.length);
    this.events.push(event);
    this._index(this.byKind, event.kind, event);
    const tagged = new Set();
    for (const t of event.tags || []) {
      if ((t[0] === "e" || t[0] === "d" || t[0] === "p") && typeof t[1] === "string" && !tagged.has(t[0] + ":" + t[1])) {
        tagged.add(t[0] + ":" + t[1]);
        this._index(this.byTag, t[0] + ":" + t[1], event);
      }
    }
    this.version++;
    this.listeners.forEach((fn) => { try { fn("__all__", event); } catch { /* ignore */ } });
    return true;
  }

  // UNTRUSTED add (relay-sourced). Validated before storing so other
  // apps' events on the same kinds can never reach the screens.
  _ingest(event) {
    if (event.kind === GIFT_WRAP) return this._ingestWrap(event);
    if (this.seen.has(event.id)) return false;
    if (event.kind !== EVENT_KINDS.METADATA && !isOurs(event)) return false;
    return this._store(event);
  }

  // A gift wrap from a relay: open it with our key; the inner event goes through the same checks as any relay event.
  _ingestWrap(w) {
    if (!this.me || this.seenWraps.has(w.id)) return false;
    if (!(w.tags || []).some((t) => t[0] === "p" && t[1] === this.me.pk)) return false; // not addressed to us: not worth a decryption
    const now = Date.now();
    if (now - this.wrapWindowAt > this.wrapLimits.windowMs) { this.wrapWindowAt = now; this.wrapsInWindow = 0; }
    if (this.wrapsInWindow >= this.wrapLimits.budget) { this._queueWrap(w); return false; }
    this.wrapsInWindow++;
    return this._openWrap(w);
  }
  _openWrap(w) {
    this.seenWraps.add(w.id);
    if (this.seenWraps.size > this.wrapLimits.seenMax) {
      let drop = Math.ceil(this.wrapLimits.seenMax / 6);
      for (const id of this.seenWraps) { if (drop-- <= 0) break; this.seenWraps.delete(id); }
    }
    const inner = unwrap(w, this.me.sk);
    return inner ? this._ingest(inner) : false;
  }
  _queueWrap(w) {
    if (this.wrapQueue.length >= this.wrapLimits.queueMax) return; // a flood: the rest is dropped
    this.wrapQueue.push(w);
    if (!this._wrapTimer) { this._wrapTimer = setTimeout(() => this._drainWraps(), 250); this._wrapTimer.unref?.(); }
  }
  _drainWraps() {
    this._wrapTimer = null;
    if (!this.me) { this.wrapQueue = []; return; }
    for (const w of this.wrapQueue.splice(0, this.wrapLimits.batch)) if (!this.seenWraps.has(w.id)) this._openWrap(w);
    if (this.wrapQueue.length) { this._wrapTimer = setTimeout(() => this._drainWraps(), 250); this._wrapTimer.unref?.(); }
  }

  _matches(event, filter) {
    if (filter.ids && !filter.ids.includes(event.id)) return false;
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
    for (const tag of ["e", "d", "p"]) {
      const key = "#" + tag;
      if (filter[key]) {
        const values = event.tags.filter((t) => t[0] === tag).map((t) => t[1]);
        if (!filter[key].some((v) => values.includes(v))) return false;
      }
    }
    return true;
  }
}

export const relay = new NostrRelay();
