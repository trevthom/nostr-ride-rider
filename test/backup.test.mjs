// The encrypted backup: what goes in, that only the owner's key opens it, that restoring puts it back, that nothing else is touched.
// Run with: npm test
import assert from "node:assert/strict";
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; }, key: (i) => Object.keys(mem)[i] ?? null, get length() { return Object.keys(mem).length; } };
const R = new URL("../src", import.meta.url).pathname;
const B = await import(`${R}/lib/backup.js`);
const { getSetting, setSetting, getRelays, setRelays } = await import(`${R}/config/relays.js`);
const { relay } = await import(`${R}/nostr/relay.js`);
const V = await import(`${R}/lib/vouches.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const me = generateKeypair(), other = generateKeypair(), friend = generateKeypair();
setSetting("blocked", [{ pubkey: other.publicKey, name: "Mallory", at: 1 }]);
setSetting("units", "km"); setSetting("currency", "EUR"); setSetting("dark", true); setSetting("requestRadius", 40);
setSetting("autoCashOut_" + me.publicKey.slice(0, 16), { amount: 25, code: "USD" });
setSetting("ecash_" + me.publicKey.slice(0, 16), ["SECRET-COINS"]); // must never be backed up
setSetting("prices", { prices: { USD: 1 }, at: 1 });
setSetting("riderDone", ["x"]);
setRelays(["wss://relay.one", "wss://relay.two"]);
relay._store(buildSignedEvent(K.VOUCH_LIST, { v: 1, count: 1 }, [["d", "vouches"], ["p", friend.publicKey], ["t", "nostrride"]], me.sk));

// ── What goes in ──
const data = B.collectBackup(me.publicKey, 1000);
assert.equal(data.v, 1); assert.equal(data.at, 1000);
assert.deepEqual(data.settings.blocked, [{ pubkey: other.publicKey, name: "Mallory", at: 1 }]);
assert.equal(data.settings.units, "km"); assert.equal(data.settings.currency, "EUR"); assert.equal(data.settings.dark, true);
assert.deepEqual(data.settings["autoCashOut_" + me.publicKey.slice(0, 16)], { amount: 25, code: "USD" });
assert.deepEqual(data.settings.relays, ["wss://relay.one", "wss://relay.two"]);
assert.deepEqual(data.vouches, [friend.publicKey]);
const flat = JSON.stringify(data);
assert.ok(!flat.includes("SECRET-COINS") && !Object.keys(data.settings).some((k) => k.startsWith("ecash_")), "ecash is never in the backup");
assert.ok(!("prices" in data.settings) && !("riderDone" in data.settings), "caches and leftovers stay out");

// ── Only the owner's key opens it; the relay sees nothing inside ──
const sealed = B.sealBackup(data, me.sk, me.publicKey);
assert.ok(!sealed.includes("Mallory") && !sealed.includes(friend.publicKey), "nothing readable in the note");
assert.deepEqual(B.openBackup(sealed, me.sk, me.publicKey), data);
assert.equal(B.openBackup(sealed, other.sk, me.publicKey), null, "another key cannot open it");
assert.equal(B.openBackup(sealed, other.sk, other.publicKey), null);
assert.equal(B.openBackup("garbage", me.sk, me.publicKey), null);
const ev = B.backupEvent(sealed);
assert.equal(ev.kind, K.SETTINGS_BACKUP); assert.deepEqual(ev.tags[0], ["d", "backup"]);

// ── A change shows in the digest; the time does not ──
const d1 = B.backupDigest(data);
assert.equal(B.backupDigest({ ...data, at: 99999 }), d1, "the time is not part of the content");
setSetting("units", "mi");
assert.notEqual(B.backupDigest(B.collectBackup(me.publicKey)), d1, "a setting changed");

// ── Restoring on a fresh device puts it back and touches nothing else ──
for (const k of Object.keys(mem)) delete mem[k];
setSetting("riderDone", ["keep me"]);
setRelays(["wss://other"]);
const set = B.applyBackup(data);
assert.ok(set.includes("blocked") && set.includes("relays") && set.includes("currency"));
assert.deepEqual(getSetting("blocked", []), [{ pubkey: other.publicKey, name: "Mallory", at: 1 }]);
assert.equal(getSetting("units", "mi"), "km"); assert.equal(getSetting("requestRadius", 0), 40);
assert.deepEqual(getRelays(), ["wss://relay.one", "wss://relay.two"]);
assert.deepEqual(getSetting("riderDone", []), ["keep me"], "settings outside the backup are left alone");
// a hostile or damaged backup cannot write anything it should not
B.applyBackup({ settings: { "ecash_x": ["stolen"], prices: 1, relays: ["javascript:alert(1)"], autoCashOut_ok: 1, blocked: [] } });
assert.equal(getSetting("ecash_x", null), null, "an unknown key is ignored");
assert.deepEqual(getRelays(), ["wss://relay.one", "wss://relay.two"], "a bad relay list is ignored");
assert.equal(getSetting("autoCashOut_ok", null), 1, "an allowed prefix is accepted");
assert.deepEqual(B.backupVouches({ vouches: [friend.publicKey, "nope", friend.publicKey, 5] }), [friend.publicKey]);
assert.deepEqual(B.applyBackup(null), []);
assert.equal(V.MAX_VOUCHES, 100);
console.log("backup tests ok");
