// ════════════════════════════════════════════════════════════
//  KEYS — Your Nostr identity, using REAL nostr-tools crypto.
//
//  A keypair here contains:
//    sk          : the secret key as bytes (Uint8Array)
//    privateKey  : the secret key as hex text
//    publicKey   : the public key as hex text (used inside events)
//    nsec        : the secret key in shareable bech32 form (nsec1...)
//    npub        : the public key in shareable bech32 form (npub1...)
//
//  Events always store the *hex* publicKey (the Nostr standard).
//  nsec/npub are only for showing to / importing from humans.
// ════════════════════════════════════════════════════════════

import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Build the full keypair object from a secret key (bytes).
export function keypairFromSecretKey(sk) {
  const publicKey = getPublicKey(sk);
  return {
    sk,
    privateKey: bytesToHex(sk),
    publicKey,
    nsec: nip19.nsecEncode(sk),
    npub: nip19.npubEncode(publicKey),
  };
}

// Create a brand-new random keypair.
export function generateKeypair() {
  return keypairFromSecretKey(generateSecretKey());
}

// Import an existing identity from a pasted "nsec1..." string.
// Throws an Error if the string is not a valid nsec.
export function keypairFromNsec(nsec) {
  const decoded = nip19.decode(nsec.trim());
  if (decoded.type !== "nsec") {
    throw new Error("That is not an nsec key.");
  }
  return keypairFromSecretKey(decoded.data);
}

// Turn a hex public key into a shortened npub for display,
// e.g. "npub1abcd…wxyz". Used when we only know someone's pubkey.
// Full bech32 npub (npub1...) for a hex pubkey.
export function fullNpub(hexPubkey) {
  try {
    return nip19.npubEncode(hexPubkey);
  } catch {
    return hexPubkey;
  }
}

export function shortNpub(hexPubkey) {
  try {
    const npub = nip19.npubEncode(hexPubkey);
    return npub.slice(0, 10) + "…" + npub.slice(-4);
  } catch {
    return hexPubkey.slice(0, 8) + "…";
  }
}
