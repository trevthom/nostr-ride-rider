// ════════════════════════════════════════════════════════════
//  BOLT11 — Read the payment hash out of a Lightning invoice, and check
//  a preimage against it. A payment PREIMAGE whose SHA-256 equals the
//  invoice's payment hash is cryptographic proof that the invoice was
//  paid (only the payee's side can release it), so it is the best
//  evidence to keep for a dispute. No signature check: we only need the hash.
// ════════════════════════════════════════════════════════════

import { bech32 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const SIGNATURE_WORDS = 104; // 65-byte signature, in 5-bit words
const TIMESTAMP_WORDS = 7;

// The invoice's payment hash as hex, or null if it can't be read.
export function paymentHash(pr) {
  try {
    const inv = String(pr || "").trim().toLowerCase().replace(/^lightning:/, "");
    const { words } = bech32.decode(inv, false);
    let i = TIMESTAMP_WORDS;
    const end = words.length - SIGNATURE_WORDS;
    while (i + 3 <= end) {
      const type = words[i];
      const len = words[i + 1] * 32 + words[i + 2];
      const data = words.slice(i + 3, i + 3 + len);
      if (type === 1 && len === 52) return bytesToHex(Uint8Array.from(bech32.fromWords(data)).slice(0, 32));
      i += 3 + len;
    }
  } catch { /* not a valid invoice */ }
  return null;
}

// Does this preimage (hex) pay this invoice?
export function preimageMatches(pr, preimageHex) {
  const hash = paymentHash(pr);
  if (!hash || typeof preimageHex !== "string" || !/^[0-9a-f]{64}$/i.test(preimageHex)) return false;
  try {
    return bytesToHex(sha256(hexToBytes(preimageHex.toLowerCase()))) === hash;
  } catch {
    return false;
  }
}
