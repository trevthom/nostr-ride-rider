// A small but REAL Cashu mint for tests: an HTTP server that speaks the Cashu protocol (NUT-00..09)
// and does the real blind-signature maths, so the actual @cashu/cashu-ts client (and our adapter in
// src/nostr/cashuMint.js) can be tested without any network. It is NOT secure and is for tests only.
//
//   const mint = await startLocalMint({ feePpk: 100 });
//   mint.url                  http://127.0.0.1:<port>
//   mint.payQuote(quoteId)    pretend the Lightning invoice of a mint quote was paid
//   startLocalMint({ onchain: true }) also speaks on-chain minting (NUT-30, with the NUT-20 signature check):
//   mint.depositOnchain(addressOrQuoteId, sats)   pretend a confirmed bitcoin payment reached the address of an on-chain quote
//   mint.stats                { spent, melted: [sats…] }
//   mint.signedCount()        how many blinded messages the mint has signed (it remembers them, for restore)
//   await mint.close()
import http from "node:http";
import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hashToCurve, pointFromHex, deriveKeysetId, verifyMintQuoteSignature } from "@cashu/cashu-ts";

// A BOLT11-looking invoice for `sats` (the amount is in the human-readable part: 10 nBTC = 1 sat). It cannot be paid.
// (The data part may not contain the digit 1: the client finds the separator with lastIndexOf("1"), as bech32 allows.)
export const invoiceFor = (sats, tag = "test") => `lnbc${sats * 10}n1${String(tag).replace(/[^a-z]/g, "x")}`;
const AMOUNTS = Array.from({ length: 21 }, (_, i) => 2 ** i);
const hex = (b) => Buffer.from(b).toString("hex");
const bigOf = (b) => BigInt("0x" + hex(b));

export async function startLocalMint({ feePpk = 0, onchain = false } = {}) {
  const priv = Object.fromEntries(AMOUNTS.map((a) => [a, randomBytes(32)]));
  const keys = Object.fromEntries(AMOUNTS.map((a) => [String(a), hex(secp256k1.getPublicKey(priv[a], true))]));
  const id = deriveKeysetId(keys, { unit: "sat", input_fee_ppk: feePpk });
  const spent = new Set(); // hex(Y) of spent proofs
  const signed = new Map(); // B_ → { amount, id, C_ }: every signature given (NUT-09 restore), and a blinded message is signed only once
  const quotes = new Map(); // mint quotes
  const onchainQuotes = new Map(); // on-chain mint quotes (NUT-30)
  const melts = new Map();
  const stats = { spent, melted: [] };
  let n = 1;

  const fee = (count) => Math.ceil((count * feePpk) / 1000);
  const yOf = (secret) => hashToCurve(new TextEncoder().encode(secret));
  const sign = (outputs) => {
    if (outputs.some((o, i) => signed.has(o.B_) || outputs.findIndex((x) => x.B_ === o.B_) !== i)) throw httpError(400, 10002, "Blinded message is already signed");
    return outputs.map((o) => {
      const sig = { amount: o.amount, id, C_: pointFromHex(o.B_).multiply(bigOf(priv[o.amount])).toHex(true) };
      signed.set(o.B_, sig);
      return sig;
    });
  };
  const sumOf = (list) => list.reduce((s, x) => s + Number(x.amount), 0);

  // Check inputs: right mint key, not spent. Returns the Y values.
  function check(inputs) {
    const ys = [];
    for (const p of inputs) {
      if (!priv[p.amount]) throw httpError(400, 10002, "Unknown amount");
      const Y = yOf(p.secret);
      if (Y.multiply(bigOf(priv[p.amount])).toHex(true) !== p.C) throw httpError(400, 10003, "Token not verified");
      const y = Y.toHex(true);
      if (spent.has(y) || ys.includes(y)) throw httpError(400, 11001, "Token already spent");
      ys.push(y);
    }
    return ys;
  }
  const httpError = (status, code, detail) => Object.assign(new Error(detail), { status, code, detail });

  const routes = {
    "GET /v1/info": () => ({ name: "Local test mint", version: "test/0.1", nuts: { 4: { methods: [{ method: "bolt11", unit: "sat" }, ...(onchain ? [{ method: "onchain", unit: "sat" }] : [])], disabled: false }, 5: { methods: [{ method: "bolt11", unit: "sat" }], disabled: false }, 7: { supported: true }, 9: { supported: true } } }),
    "GET /v1/keysets": () => ({ keysets: [{ id, unit: "sat", active: true, input_fee_ppk: feePpk }] }),
    "GET /v1/keys": () => ({ keysets: [{ id, unit: "sat", keys }] }),
    [`GET /v1/keys/${id}`]: () => ({ keysets: [{ id, unit: "sat", keys }] }),
    "POST /v1/mint/quote/bolt11": (b) => {
      const quote = "mq" + n++;
      const q = { quote, request: invoiceFor(b.amount, "mintquote" + quote), amount: b.amount, unit: "sat", state: "UNPAID", expiry: Math.floor(Date.now() / 1000) + 600 };
      quotes.set(quote, q);
      return q;
    },
    "POST /v1/mint/bolt11": (b) => {
      const q = quotes.get(b.quote);
      if (!q) throw httpError(404, 20000, "Unknown quote");
      if (q.state === "ISSUED") throw httpError(400, 20002, "Tokens already issued");
      if (q.state !== "PAID") throw httpError(400, 20001, "Quote not paid");
      if (sumOf(b.outputs) !== q.amount) throw httpError(400, 11002, "Outputs do not match the quote");
      const signatures = sign(b.outputs); // all or nothing: a refused output must not use up the quote
      q.state = "ISSUED";
      return { signatures };
    },
    ...(onchain ? {
      "POST /v1/mint/quote/onchain": (b) => {
        if (!/^0[23][0-9a-f]{64}$/.test(b.pubkey || "")) throw httpError(400, 20008, "A pubkey is required to lock the quote");
        const quote = "oq" + n++;
        const q = { quote, request: "bcrt1q" + hex(randomBytes(20)), unit: "sat", expiry: null, pubkey: b.pubkey, amount_paid: 0, amount_issued: 0 };
        onchainQuotes.set(quote, q);
        return q;
      },
      "POST /v1/mint/onchain": (b) => {
        const q = onchainQuotes.get(b.quote);
        if (!q) throw httpError(404, 20000, "Unknown quote");
        // This test mint knows the plain NUT-20 message only. The client first sends the newer "amended" signature; a mint that does not know it
        // answers 20008 and the client retries with the plain one, which is checked here. A signature of another key fails both times.
        if (!verifyMintQuoteSignature(q.pubkey, b.quote, b.outputs, b.signature || "")) throw httpError(400, 20008, "Quote signature invalid");
        const amount = sumOf(b.outputs);
        if (amount > q.amount_paid - q.amount_issued) throw httpError(400, 20001, "More than was paid");
        const signatures = sign(b.outputs); // all or nothing
        q.amount_issued += amount;
        return { signatures };
      },
    } : {}),
    "POST /v1/swap": (b) => {
      const ys = check(b.inputs);
      if (sumOf(b.inputs) - fee(b.inputs.length) !== sumOf(b.outputs)) throw httpError(400, 11002, `Transaction is not balanced (inputs ${sumOf(b.inputs)}, fee ${fee(b.inputs.length)}, outputs ${sumOf(b.outputs)})`);
      const signatures = sign(b.outputs); // all or nothing: a refused output must not spend the inputs
      ys.forEach((y) => spent.add(y));
      return { signatures };
    },
    "POST /v1/restore": (b) => {
      // NUT-09: give back the signatures for the blinded messages this mint has signed before.
      const outputs = [], signatures = [];
      for (const o of b.outputs || []) {
        const sig = signed.get(o.B_);
        if (sig) { outputs.push({ amount: sig.amount, id: sig.id, B_: o.B_ }); signatures.push(sig); }
      }
      return { outputs, signatures };
    },
    "POST /v1/checkstate": (b) => ({ states: b.Ys.map((Y) => ({ Y, state: spent.has(Y) ? "SPENT" : "UNSPENT", witness: null })) }),
    "POST /v1/melt/quote/bolt11": (b) => {
      const m = /^lnbc(\d+)n1/.exec(b.request);
      if (!m) throw httpError(400, 20000, "Bad invoice");
      const amount = Number(m[1]) / 10; // 10 nBTC = 1 sat
      const quote = "ml" + n++;
      const q = { quote, request: b.request, amount, unit: "sat", fee_reserve: Math.max(1, Math.ceil(amount * 0.01)), state: "UNPAID", expiry: Math.floor(Date.now() / 1000) + 600, payment_preimage: null };
      melts.set(quote, q);
      return q;
    },
    "POST /v1/melt/bolt11": (b) => {
      const q = melts.get(b.quote);
      if (!q) throw httpError(404, 20000, "Unknown quote");
      const ys = check(b.inputs);
      const have = sumOf(b.inputs) - fee(b.inputs.length);
      if (have < q.amount + q.fee_reserve) throw httpError(400, 11006, "Insufficient inputs");
      ys.forEach((y) => spent.add(y));
      q.state = "PAID";
      q.payment_preimage = hex(randomBytes(32));
      stats.melted.push(q.amount);
      // Change (NUT-08): the Lightning fee here is 0, so everything above the invoice comes back.
      let change = have - q.amount;
      const outs = [];
      for (const o of b.outputs || []) {
        const piece = AMOUNTS.slice().reverse().find((a) => a <= change);
        if (!piece) break;
        outs.push({ ...o, amount: piece });
        change -= piece;
      }
      return { ...q, change: sign(outs) };
    },
  };

  const server = http.createServer((req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const path = (req.url || "").split("?")[0];
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(obj)); };
      try {
        const quoteGet = /^GET \/v1\/(mint|melt)\/quote\/bolt11\/(.+)$/.exec(`${req.method} ${path}`);
        if (quoteGet) {
          const q = (quoteGet[1] === "mint" ? quotes : melts).get(quoteGet[2]);
          return q ? send(200, q) : send(404, { code: 20000, detail: "Unknown quote" });
        }
        const onchainGet = onchain && /^GET \/v1\/mint\/quote\/onchain\/(.+)$/.exec(`${req.method} ${path}`);
        if (onchainGet) {
          const q = onchainQuotes.get(onchainGet[1]);
          return q ? send(200, q) : send(404, { code: 20000, detail: "Unknown quote" });
        }
        const handler = routes[`${req.method} ${path}`];
        if (!handler) return send(404, { code: 0, detail: "Not found: " + path });
        send(200, handler(body ? JSON.parse(body) : {}));
      } catch (e) {
        send(e.status || 500, { code: e.code || 0, detail: e.detail || String(e.message) });
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    keysetId: id,
    stats,
    quotes,
    payQuote: (quote) => { quotes.get(quote).state = "PAID"; },
    onchainQuotes,
    depositOnchain: (addressOrId, sats) => {
      const q = onchainQuotes.get(addressOrId) || [...onchainQuotes.values()].find((x) => x.request === addressOrId);
      if (!q) throw new Error("no such on-chain quote");
      q.amount_paid += sats;
    },
    signedCount: () => signed.size,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
