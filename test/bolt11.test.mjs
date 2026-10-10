// BOLT11: payment hash extraction and preimage checks (invoices built here, valid bech32).
// Run with: npm test
import assert from "node:assert/strict";
import { bech32 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
const { paymentHash, preimageMatches } = await import("../src/lib/bolt11.js");

const preimage = "11".repeat(32);
const hash = bytesToHex(sha256(hexToBytes(preimage)));
const tag = (type, words) => [type, Math.floor(words.length / 32), words.length % 32, ...words];
function invoice({ withHash = true, hashHex = hash } = {}) {
  const words = [
    ...Array(7).fill(0), // timestamp
    ...tag(13, Array(4).fill(1)), // 'd' description (type 13)
    ...(withHash ? tag(1, bech32.toWords(hexToBytes(hashHex))) : []),
    ...tag(6, [0, 1]), // expiry
    ...Array(104).fill(0), // signature
  ];
  return bech32.encode("lnbc10u", words, false);
}
const pr = invoice();
assert.equal(paymentHash(pr), hash);
assert.equal(paymentHash("lightning:" + pr.toUpperCase()), hash, "prefix and case are ignored");
assert.equal(preimageMatches(pr, preimage), true);
assert.equal(preimageMatches(pr, "22".repeat(32)), false, "wrong preimage");
assert.equal(preimageMatches(pr, "zz"), false, "malformed preimage");
assert.equal(paymentHash(invoice({ withHash: false })), null, "no payment hash tag");
assert.equal(paymentHash("lnbc1garbage"), null);
assert.equal(preimageMatches("", preimage), false);
console.log("bolt11 checks passed");
process.exit(0);
