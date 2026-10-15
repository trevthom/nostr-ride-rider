// The recovery phrase (src/lib/recovery.js) and where it is kept (src/nostr/seedbox.js):
//   • a phrase is 12 valid BIP39 words, made from secure random; messy typing is cleaned; mistakes are named
//   • the three words the person must type back are different and in order
//   • the seed follows the Cashu NUT-13 recipe (the spec's own test vector)
//   • the phrase is saved ENCRYPTED under its own key; another key cannot open it; the words never appear in the saved text
// Run with: npm test
import assert from "node:assert/strict";

// A browser's localStorage, for Node.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };

const R = new URL("../src", import.meta.url).pathname;
const Rec = await import(`${R}/lib/recovery.js`);
const { makeSeedBox, loadOrCreate } = await import(`${R}/nostr/seedbox.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { deriveSecretAndBlindingFactor } = await import("@cashu/cashu-ts");
const { nip44 } = await import("nostr-tools");
const hex = (b) => Buffer.from(b).toString("hex");

// ── Making and checking a phrase ──
const p = Rec.newPhrase();
assert.equal(p.split(" ").length, 12);
assert.deepEqual(Rec.checkPhrase(p), { phrase: p });
assert.notEqual(Rec.newPhrase(), p, "two phrases are never the same");
assert.equal(Rec.cleanPhrase("  1. Half   DEPART\nobvious,\tquality "), "half depart obvious quality", "numbers, capitals, commas and spaces are cleaned");
assert.deepEqual(Rec.checkPhrase(" " + p.toUpperCase().split(" ").map((w, i) => `${i + 1}. ${w}`).join("\n") + " "), { phrase: p }, "a phrase pasted with numbers and capitals is fine");
assert.match(Rec.checkPhrase("one two three").error, /12 words/);
assert.match(Rec.checkPhrase(p.replace(/^\w+/, "zzzzz")).error, /"zzzzz" is not a word/, "an unknown word is named");
const words = p.split(" ");
// Two words in the wrong order: a fixed phrase, because a random one passes the 4-bit checksum by chance 1 time in 16.
const fixed = "half depart obvious quality work element tank gorilla view sugar picture humble";
const swapped = fixed.split(" "); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
assert.match(Rec.checkPhrase(swapped.join(" ")).error, /do not fit together/, "words in the wrong order fail the checksum");
assert.ok(Rec.checkPhrase("").error && Rec.checkPhrase(null).error);

// ── The check words ──
for (let i = 0; i < 50; i++) {
  const places = Rec.pickCheckPositions(3);
  assert.equal(places.length, 3);
  assert.equal(new Set(places).size, 3, "three different places");
  assert.deepEqual([...places].sort((a, b) => a - b), places, "in order");
  assert.ok(places.every((x) => x >= 0 && x < 12));
}
let pickN = 0;
assert.deepEqual(Rec.pickCheckPositions(3, (max) => [5, 5, 1, 9][pickN++ % 4] % max), [1, 5, 9], "a repeat is skipped");
const places = [2, 6, 11];
assert.ok(Rec.checkAnswers(p, places, [words[2], words[6].toUpperCase(), ` ${words[11]} `]), "capitals and spaces do not matter");
assert.ok(!Rec.checkAnswers(p, places, [words[2], words[6], words[10]]));
assert.ok(!Rec.checkAnswers(p, [], []), "no places never passes");

// ── The seed follows Cashu NUT-13 (the spec's test vector: this phrase, keyset 009a1f293253e41e) ──
const spec = "half depart obvious quality work element tank gorilla view sugar picture humble";
assert.deepEqual(Rec.checkPhrase(spec), { phrase: spec });
const seed = Rec.seedOf(spec);
assert.equal(seed.length, 64);
const secrets = [0, 1, 2].map((i) => hex(deriveSecretAndBlindingFactor(seed, "009a1f293253e41e", i).secret));
assert.deepEqual(secrets, [
  "485875df74771877439ac06339e284c3acfcd9be7abf3bc20b516faeadfe77ae",
  "8f2b39e8e594a4056eb1e6dbb4b0c38ef13b1b2c751f64f810ec04ee35b77270",
  "bc628c79accd2364fd31511216a0fab62afd4a18ff77a20deded7b858c9860c8",
], "the secrets are the ones in the NUT-13 specification");
assert.equal(hex(deriveSecretAndBlindingFactor(seed, "009a1f293253e41e", 0).blindingFactor), "ad00d431add9c673e843d4c2bf9a778a5f402b985b8da2d5550bf39cda41d679");

// ── The key that encrypts the phrase on the device ──
const me = generateKeypair(), other = generateKeypair();
const k = Rec.boxKey(me.sk);
assert.equal(k.length, 32);
assert.deepEqual(Rec.boxKey(me.sk), k, "the same secret key gives the same box key");
assert.notDeepEqual(Rec.boxKey(other.sk), k);
assert.notDeepEqual(k, nip44.getConversationKey(me.sk, me.publicKey), "NOT the key that encrypts the ecash proofs: its own label");

// ── The seed box ──
const box = makeSeedBox(me);
assert.equal(box.load(), null, "nothing yet");
const rec = loadOrCreate(box);
assert.equal(rec.phrase.split(" ").length, 12);
assert.equal(rec.backedUp, false, "a new phrase is not yet written down");
assert.deepEqual(loadOrCreate(box), rec, "the saved phrase is kept, never replaced");
const saved = [...mem.entries()].find(([key]) => key.includes("ecashphrase_"));
assert.ok(saved, "it is saved on the device");
assert.ok(!saved[1].includes(rec.phrase.split(" ")[0] + " " + rec.phrase.split(" ")[1]), "the words are not in the saved text");
assert.ok(!/backedUp|phrase/.test(saved[1]), "and neither are the field names: it is all encrypted");
assert.equal(makeSeedBox(other).load(), null, "another key finds nothing");
// The text cannot be opened with another key, not even the user's own NIP-44 key (the key of the ecash proofs).
const raw = JSON.parse(saved[1]);
assert.throws(() => nip44.decrypt(raw, nip44.getConversationKey(me.sk, me.publicKey)));
assert.throws(() => nip44.decrypt(raw, Rec.boxKey(other.sk)));
box.save({ ...rec, backedUp: true });
assert.equal(box.load().backedUp, true);
mem.set(saved[0], JSON.stringify("not encrypted at all"));
assert.equal(box.load(), null, "a damaged box reads as empty, it does not crash");
box.erase();
assert.equal(box.load(), null);
console.log("recovery: ok");
process.exit(0);
