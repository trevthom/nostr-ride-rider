// fetchHistory runs a few at a time so relays don't drop subscriptions.
// Run with: npm test
import assert from "node:assert/strict";
const { relay } = await import("../src/nostr/relay.js");
let open = 0, peak = 0;
relay.pool.querySync = async () => { open++; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 20)); open--; return []; };
await Promise.all(Array.from({ length: 50 }, (_, i) => relay.fetchHistory(String(i).padStart(64, "0"))));
assert.ok(peak <= 6, "peak concurrent queries " + peak); // 3 jobs x 2 parallel first-step queries
console.log("queue checks passed (peak " + peak + " concurrent queries for 50 riders)"); process.exit(0);
