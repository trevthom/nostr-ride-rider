// ════════════════════════════════════════════════════════════
//  RECOVERY PHRASE — The 12 words that bring back a person's ecash on a new device (pure functions, no storage).
//
//  Every ecash coin the wallet makes gets its secret from a recipe: this phrase + the mint's keyset + a counter
//  (Cashu NUT-13). If the phone is lost, the same phrase on a new device finds the coins again at the mint (NUT-09).
//  So the phrase IS the money. It is made on the device from the browser's secure random source, shown to the person,
//  and never sent anywhere: not in an event, not to a relay, not to a server, not into a log.
//
//  The phrase is NOT the Nostr key. A leak of one must not give away the other (people paste an nsec into many Nostr
//  apps). It is a standard BIP39 phrase, so other Cashu wallets that follow NUT-13 can restore from it too.
//
//    newPhrase()                       12 random words
//    cleanPhrase(text)                 lower case, single spaces; "1. half  Depart" → "half depart"
//    checkPhrase(text)                 { phrase } or { error }   (word count, unknown word, checksum)
//    seedOf(phrase)                    the 64-byte seed the Cashu client derives secrets from
//    pickCheckPositions(n, random?)    n different word places (0-based, ascending) to ask for again
//    checkAnswers(phrase, places, a)   true if the typed words match those places
//    boxKey(sk)                        the key that encrypts the phrase on the device (its own HKDF label)
// ════════════════════════════════════════════════════════════

import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const PHRASE_WORDS = 12;
const BOX_LABEL = "nostrride/ecash/phrase-box/v1"; // domain separation: this key is used for nothing else

export const newPhrase = () => generateMnemonic(wordlist, 128);

export function cleanPhrase(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .join(" ");
}

export function checkPhrase(text) {
  const phrase = cleanPhrase(text);
  const words = phrase ? phrase.split(" ") : [];
  if (words.length !== 12 && words.length !== 24) return { error: `A recovery phrase has 12 words. You typed ${words.length}.` };
  const bad = words.find((w) => !wordlist.includes(w));
  if (bad) return { error: `"${bad}" is not a word from the list. Check the spelling.` };
  if (!validateMnemonic(phrase, wordlist)) return { error: "These words do not fit together. A word is wrong or out of order." };
  return { phrase };
}

export const seedOf = (phrase) => mnemonicToSeedSync(phrase);

// n different places in the phrase, in ascending order, to ask for again. `random(max)` returns an integer in [0, max).
const secureInt = (max) => {
  const limit = Math.floor(0x100000000 / max) * max; // no modulo bias
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
};
export function pickCheckPositions(n = 3, random = secureInt, words = PHRASE_WORDS) {
  const places = new Set();
  while (places.size < Math.min(n, words)) places.add(random(words));
  return [...places].sort((a, b) => a - b);
}

export function checkAnswers(phrase, places, answers) {
  const words = cleanPhrase(phrase).split(" ");
  return places.length > 0 && places.every((p, i) => cleanPhrase(answers?.[i]) === words[p]);
}

// The key that encrypts the phrase on the device. HKDF-SHA256 of the user's secret key with its own label, so it is a
// different key from every other key the app derives from the same secret (the NIP-44 key of the ecash proofs, for one).
export const boxKey = (sk) => hkdf(sha256, sk, undefined, new TextEncoder().encode(BOX_LABEL), 32);
