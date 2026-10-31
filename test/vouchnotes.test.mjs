// Private notes about vouches: saved locally, capped, cleared with the vouch, and carried by the encrypted backup.
// Run with: npm test
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

const R = new URL("../src", import.meta.url).pathname;
const V = await import(`${R}/lib/vouches.js`);
const B = await import(`${R}/lib/backup.js`);

const me = "aa".repeat(32);
const other = "bb".repeat(32);
const key = "vouchNotes_" + me.slice(0, 16);

assert.deepEqual(V.getVouchNotes(me), {}, "no notes at first");
V.setVouchNote(me, other, "  Good driver, always on time  ");
assert.deepEqual(V.getVouchNotes(me), { [other]: "Good driver, always on time" }, "trimmed and saved by pubkey");
assert.deepEqual(V.getVouchNotes("cc".repeat(32)), {}, "another account has its own notes");
assert.equal(V.vouchEvent([other]).tags.some((t) => t[0] === "note"), false, "a note never goes in the public vouch event");

V.setVouchNote(me, other, "x".repeat(400));
assert.equal(V.getVouchNotes(me)[other].length, 300, "a note is capped like a block note");

V.setVouchNote(me, "not-a-key", "ignored");
assert.deepEqual(V.getVouchNotes(me), { [other]: "x".repeat(300) }, "an invalid person changes nothing");

assert.equal(B.allowedKey(key), true, "the encrypted backup may carry the notes");
const data = B.collectBackup(me, 1000);
assert.deepEqual(data.settings[key], { [other]: "x".repeat(300) }, "collectBackup includes the notes");

V.setVouchNote(me, other, "  ");
assert.deepEqual(V.getVouchNotes(me), {}, "an empty note removes it");

console.log("vouch notes: ok");
process.exit(0);
