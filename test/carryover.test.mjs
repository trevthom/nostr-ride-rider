// People data is not trapped in the rider app. The rider and driver apps are separate pages with separate storage:
// the profile (kind 0) carries contact methods, the public vouch list carries vouches, and the encrypted settings
// backup carries blocked users and trusted contacts. A sign-in in the driver app reads all four.
// Run with: npm test
import assert from "node:assert/strict";
const mem = {};
globalThis.localStorage = {
  getItem: (k) => mem[k] ?? null,
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
  key: (i) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length; },
};
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { getProfile } = await import(`${R}/nostr/profiles.js`);
const V = await import(`${R}/lib/vouches.js`);
const B = await import(`${R}/lib/backup.js`);
const { getSetting, setSetting } = await import(`${R}/config/relays.js`);

const me = generateKeypair(), friend = generateKeypair(), blocked = generateKeypair();
const comm = [{ platform: "Signal", handle: "@sam" }];
relay._store(buildSignedEvent(K.METADATA, { name: "Sam", communication: comm }, [], me.sk));
const list = V.vouchEvent([friend.publicKey]);
relay._store(buildSignedEvent(list.kind, list.content, [...list.tags, ["t", "nostrride"]], me.sk));
setSetting("blocked", [{ pubkey: blocked.publicKey, name: "Mallory", at: 1 }]);
setSetting("trustedContacts", [{ name: "Ana", phone: "+15550100" }]);

const data = B.collectBackup(me.publicKey, 1000);
assert.deepEqual(data.vouches, [friend.publicKey]);
const sealed = B.sealBackup(data, me.sk, me.publicKey);

// A fresh driver app has its own empty storage; signing in reads what the rider saved.
for (const k of Object.keys(mem)) delete mem[k];
const opened = B.openBackup(sealed, me.sk, me.publicKey);
assert.ok(opened, "the owner's key opens the backup");
B.applyBackup(opened);
assert.deepEqual(getProfile(me.publicKey)?.comm, comm, "contact methods come from the shared profile");
assert.deepEqual(V.vouchList(me.publicKey), [friend.publicKey], "vouches come from the public vouch list");
assert.deepEqual(getSetting("blocked", []), [{ pubkey: blocked.publicKey, name: "Mallory", at: 1 }], "blocked users come from the backup");
assert.deepEqual(getSetting("trustedContacts", []), [{ name: "Ana", phone: "+15550100" }], "trusted contacts come from the backup");
console.log("carryover tests ok");
process.exit(0);
