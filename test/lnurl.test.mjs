// Lightning address payments: BOLT11 amount parsing, LNURL-pay flow, wrong-amount rejection.
// Run with: npm test
import assert from "node:assert/strict";
const L = await import("../src/lib/lnurl.js");
// BOLT11 spec examples (prefix only matters for the amount).
assert.equal(L.invoiceAmountMsat("lnbc2500u1pvjluezpp5qqqsyqcyq5"), 250000000);
assert.equal(L.invoiceAmountMsat("lnbc20m1pvjluezpp5qqqsyqcyq5"), 2000000000);
assert.equal(L.invoiceAmountMsat("lnbc9678785340p1pwmna7lpp5"), 967878534);
assert.equal(L.invoiceAmountMsat("LIGHTNING:LNBC10N1PVJLUEZ"), 1000);
assert.equal(L.invoiceAmountMsat("lnbc1pvjluezpp5qqqsyqcyq5"), null);
assert.equal(L.invoiceAmountMsat("lntb20m1pvjluez"), 2000000000);
assert.ok(L.isLightningAddress("Bob@wallet.example.com") && !L.isLightningAddress("bob@") && !L.isLightningAddress("npub1x"));

// Fake LNURL server.
let invoiceFor = (msat) => `lnbc${msat / 1000 * 10}n1fake`; // sats*10 n = sats
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const body = u.pathname.startsWith("/.well-known/lnurlp/")
    ? { tag: "payRequest", callback: "https://pay.example.com/cb?user=bob", minSendable: 1000, maxSendable: 1e9, commentAllowed: 10 }
    : u.pathname === "/cb" ? { pr: invoiceFor(Number(u.searchParams.get("amount"))), verify: "https://pay.example.com/v/1", seen: u.search }
    : { settled: true };
  return { ok: true, json: async () => body };
};
const r = await L.requestInvoice("bob@pay.example.com", 2100, "NostrRide fare that is long");
assert.equal(r.pr, "lnbc21000n1fake"); assert.equal(r.verify, "https://pay.example.com/v/1");
assert.equal(await L.isInvoicePaid(r.verify), true);
// A server that returns a bigger invoice must be rejected.
invoiceFor = () => "lnbc1m1fake";
await assert.rejects(L.requestInvoice("bob@pay.example.com", 2100), /wrong amount/);
await assert.rejects(L.requestInvoice("bob@pay.example.com", 5e6), /takes 1–1000000 sats/);
console.log("lnurl checks passed");
