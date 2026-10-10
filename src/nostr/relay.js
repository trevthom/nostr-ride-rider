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
import { normalizeURL } from "nostr-tools/utils";
import { EVENT_KINDS, APP_TAG } from "./eventKinds.js";
import { getRelays, onRelaysChange } from "../config/relays.js";

// The app's kinds we sync from relays (NOT kind 0 / presence).
const APP_KINDS = [
  EVENT_KINDS.RIDE_REQUEST,
  EVENT_KINDS.RIDE_OFFER,
  EVENT_KINDS.RIDE_ACCEPT,
  EVENT_KINDS.RIDE_CANCEL,
  EVENT_KINDS.RIDE_COMPLETE,
  EVENT_KINDS.RIDE_STAGE,
  EVENT_KINDS.RIDE_PAYMENT,
  EVENT_KINDS.RIDE_CONFIRM,
  EVENT_KINDS.RATING,
];

const nowSec = () => Math.floor(Date.now() / 1000);

// Only our events on shared relays: must carry the app tag and have
// JSON-parseable content.
function isOurs(event) {
  if (!event || !event.content) return false;
  try { JSON.parse(event.content); } catch { return false; }
  return (event.tags || []).some((t) => t[0] === "t" && t[1] === APP_TAG);
}

class NostrRelay {
  constructor() {
    // enableReconnect: a dropped relay socket reconnects and re-sends its subscriptions.
    this.pool = new SimplePool({ enablePing: true, enableReconnect: true });
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
    this.sub = null;
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
        [{ kinds: APP_KINDS, "#t": [APP_TAG], since: nowSec() - 86400 }], // only our events, last 24h
        { onevent: (ev) => this._ingest(ev) }
      );
    } catch (e) {
      console.error("Relay sync failed (running local-only):", e);
    }
  }

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
  // those events point at, and the cancels/completions/ratings on those
  // rides. Feeds Past Rides and reputation. At most once per 5 min per
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
      // 2) The rides those events point at, then every version of each.
      const missing = tagVals(first, "e").filter((id) => !this.seen.has(id));
      for (const ids of chunks(missing)) take(await q({ ids }));
      const refs = new Set([...tagVals(first, "e"), ...first.map((e) => e.id)]);
      const rides = this.query({ kinds: [EVENT_KINDS.RIDE_REQUEST] }).filter((e) => refs.has(e.id));
      const authors = [...new Set(rides.map((e) => e.pubkey))];
      for (const ds of chunks(tagVals(rides, "d"))) {
        if (authors.length) take(await q({ kinds: [EVENT_KINDS.RIDE_REQUEST], authors, "#d": ds }));
      }
      // 3) How each ride ended, and its ratings.
      const dset = new Set(tagVals(rides, "d"));
      const versionIds = this.query({ kinds: [EVENT_KINDS.RIDE_REQUEST], authors })
        .filter((e) => dset.has((e.tags.find((t) => t[0] === "d") || [])[1]))
        .map((e) => e.id);
      for (const ids of chunks(versionIds)) {
        take(await q({ kinds: [EVENT_KINDS.RIDE_CANCEL, EVENT_KINDS.RIDE_COMPLETE, EVENT_KINDS.RIDE_STAGE, EVENT_KINDS.RIDE_PAYMENT, EVENT_KINDS.RIDE_CONFIRM, EVENT_KINDS.RATING], "#e": ids }));
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
    try {
      const events = await this.pool.querySync(getRelays(), {
        kinds: APP_KINDS,
        "#t": [APP_TAG],
        since: Math.max(started - 86400, this.recentSince - 120),
      });
      this.recentSince = started;
      let added = 0;
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
  publish(event) {
    this._store(event);
    return this._send(event).then((ok) => {
      if (!ok) this._enqueue(event);
      return ok;
    });
  }

  // ── Outbox: events no relay has accepted yet ──
  outboxSize() { return this.outbox.size; }
  onOutbox(fn) { this.outboxListeners.add(fn); return () => this.outboxListeners.delete(fn); }

  _enqueue(event) {
    if (event.kind >= 20000 && event.kind < 30000) return; // ephemeral: stale by the time it could be re-sent
    if (!this.outbox.has(event.id)) this.outbox.set(event.id, { event, tries: 0, at: Date.now() });
    this._saveOutbox();
    this._schedule();
  }

  _schedule() {
    if (this._retryTimer || !this.outbox.size) return;
    const tries = Math.min(...[...this.outbox.values()].map((o) => o.tries));
    const delay = this.retryDelays[Math.min(tries, this.retryDelays.length - 1)];
    this._retryTimer = setTimeout(() => { this._retryTimer = null; this.flushOutbox(); }, delay);
  }

  // Try every waiting event now (also called when the network returns).
  async flushOutbox() {
    const day = 86400000;
    for (const [id, o] of this.outbox) if (Date.now() - o.at > day) this.outbox.delete(id);
    await Promise.all(
      [...this.outbox.values()].map(async (o) => {
        o.tries++;
        if (await this._send(o.event)) this.outbox.delete(o.event.id);
      })
    );
    this._saveOutbox();
    this._schedule();
  }

  _saveOutbox() {
    try { localStorage.setItem("nostrride_outbox", JSON.stringify([...this.outbox.values()].map((o) => ({ event: o.event, at: o.at })))); } catch { /* no storage */ }
    this.outboxListeners.forEach((fn) => { try { fn(this.outbox.size); } catch { /* ignore */ } });
  }

  _loadOutbox() {
    try {
      const saved = JSON.parse(localStorage.getItem("nostrride_outbox") || "[]");
      saved.forEach((s) => { if (s?.event?.id) { this._store(s.event); this.outbox.set(s.event.id, { event: s.event, tries: 0, at: s.at || Date.now() }); } });
      if (this.outbox.size) setTimeout(() => this.flushOutbox(), 1500);
    } catch { /* no storage or bad data */ }
  }

  // Send to the relays; resolves true once any accepts, false if none do.
  _send(event) {
    try {
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
  // The pool forgets relays that fail to connect, so we probe them
  // ourselves (at most every 15 s) and remember the result.
  relayState(url) {
    let key;
    try { key = normalizeURL(url); } catch { return "failed"; }
    if (this.pool.listConnectionStatus().get(key)) return "connected";
    const h = this.health.get(key);
    if (!h || Date.now() - h.at > 15000) this._probe(key);
    return h && !h.ok ? "failed" : "connecting";
  }

  async _probe(key) {
    if (this.probing.has(key)) return;
    this.probing.add(key);
    try {
      await this.pool.ensureRelay(key, { connectionTimeout: 5000 });
      this.health.set(key, { ok: true, at: Date.now() });
    } catch {
      this.health.set(key, { ok: false, at: Date.now() });
    } finally {
      this.probing.delete(key);
    }
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
    if (this.seen.has(event.id)) return false;
    if (event.kind !== EVENT_KINDS.METADATA && !isOurs(event)) return false;
    return this._store(event);
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
