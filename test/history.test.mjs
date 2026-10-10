// fetchHistory loads rides, endings, and ratings older than 24 h from relays.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const { reputation, rideStatus } = await import(`${R}/lib/rides.js`);
const { matchFilter } = await import("nostr-tools");
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);
// A fake relay holding OLD events (a month ago), none in the cache yet.
const remote = []; let n = 0; const old = Math.floor(Date.now() / 1000) - 30 * 86400;
const ev = (kind, pubkey, content, tags) => { const e = { id: "h" + ++n, pubkey, kind, created_at: old + n, tags: [...tags, ["t", "nostrride"]], content: JSON.stringify(content) }; remote.push(e); return e; };
const rider = "a".repeat(64), driver = "b".repeat(64);
const r = ev(K.RIDE_REQUEST, rider, { status: "requested", pickup: {}, dropoff: {} }, [["d", "ride-old"]]);
const r2 = ev(K.RIDE_REQUEST, rider, { status: "in_progress", driverPubkey: driver, pickup: {}, dropoff: {} }, [["d", "ride-old"]]); // legacy: no p tag
ev(K.RIDE_ACCEPT, rider, {}, [["e", r.id], ["p", driver]]);
ev(K.RIDE_COMPLETE, driver, {}, [["e", r2.id], ["p", rider]]);
ev(K.RATING, rider, { rating: 4 }, [["e", r2.id], ["p", driver]]);
let calls = 0;
relay.pool.querySync = async (_relays, f) => { calls++; return remote.filter((e) => matchFilter(f, e)); };
await relay.fetchHistory(driver);
const latest = relay.query({ kinds: [K.RIDE_REQUEST] }).sort((a, b) => b.created_at - a.created_at)[0];
assert.equal(rideStatus(latest), "completed");
const rep = reputation(driver);
assert.equal(rep.drives, 1); assert.equal(rep.driverReviews.count, 1); assert.equal(rep.driverReviews.avg, 4);
const before = calls; await relay.fetchHistory(driver); assert.equal(calls, before, "throttled");
console.log("history checks passed (" + before + " relay queries)");
process.exit(0);
