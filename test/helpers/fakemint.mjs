// A fake Cashu mint and a wallet built on it, for tests (no network). It behaves like a real mint where it
// matters: it remembers every secret it has seen as spent, so a token cannot be redeemed twice.
// The sender's `split` adds a flat 1-sat input fee on top, as the real adapter does with includeFees.
const R = new URL("../../src", import.meta.url).pathname;
const { EcashWallet } = await import(`${R}/nostr/ecash.js`);

export class FakeMint {
  constructor(url, net) { this.url = url; this.net = net; }
  get db() { return this.net[this.url]; }
  _proofs(sats) { return sats > 0 ? [{ id: "00fake", amount: sats, secret: "s" + this.db.n++, C: "02" + "ab".repeat(32) }] : []; }
  async quoteMint(sats) { const id = "q" + this.db.n++; this.db.quotes[id] = { sats, state: "UNPAID" }; return { id, invoice: "lnbc" + sats + "n1fake" + id, expiry: null }; }
  async quoteState(id) { return this.db.quotes[id].state; }
  async mint(sats, id) {
    const q = this.db.quotes[id];
    if (q.state !== "PAID") throw new Error("not paid");
    q.state = "ISSUED";
    return this._proofs(sats);
  }
  _spend(proofs) {
    for (const p of proofs) {
      if (this.db.spent.has(p.secret)) { const e = new Error("Token already spent"); e.definitive = true; throw e; }
      this.db.spent.add(p.secret);
    }
  }
  async split(proofs, sats) {
    const have = proofs.reduce((s, p) => s + Number(p.amount), 0);
    if (have < sats + 1) throw new Error("insufficient");
    this._spend(proofs);
    return { keep: this._proofs(have - sats - 1), send: this._proofs(sats + 1) };
  }
  encode(proofs) { return "cashuBfake" + Buffer.from(JSON.stringify({ mint: this.url, proofs })).toString("base64"); }
  async receive(token) {
    if (this.db.down) throw new Error("mint unreachable"); // a network failure: not definitive
    const { proofs } = JSON.parse(Buffer.from(token.slice("cashuBfake".length), "base64").toString());
    this._spend(proofs);
    return this._proofs(proofs.reduce((s, p) => s + Number(p.amount), 0) - 1);
  }
  async quoteMelt(invoice) { const sats = Number(/lnbc(\d+)n/.exec(invoice)[1]); return { id: "m" + this.db.n++, sats, fee: 2 }; }
  // db.meltMode: null (works), "pending" (the mint is still sending it: the coins are held, no answer yet), "lost" (the payment goes
  // out but the answer never arrives), "dropped" (the request never reaches the mint). db.failMelt: the Lightning payment fails and the coins stay unspent.
  async melt(quote, proofs) {
    const mode = this.db.meltMode;
    if (mode === "dropped") throw new Error("network error before the payment");
    if (this.db.failMelt) return { paid: false, change: [] };
    if (mode === "pending") { proofs.forEach((p) => this.db.pending.add(p.secret)); return { paid: false, change: [], state: "PENDING" }; }
    this._spend(proofs);
    const total = proofs.reduce((s, p) => s + Number(p.amount), 0);
    this.db.paidInvoices.push(quote.sats);
    if (mode === "lost") throw new Error("network error after the payment");
    return { paid: true, change: this._proofs(total - quote.sats - 1) };
  }
  async states(proofs) {
    if (this.db.statesDown) throw new Error("mint unreachable");
    return proofs.map((p) => (this.db.spent.has(p.secret) ? "SPENT" : this.db.pending.has(p.secret) ? "PENDING" : "UNSPENT"));
  }
}

export const MINT = "https://mint.test";
export const newNet = () => ({ [MINT]: { n: 1, quotes: {}, spent: new Set(), paidInvoices: [], failMelt: false, down: false, meltMode: null, pending: new Set(), statesDown: false } });
export const tokenInfo = (t) => {
  if (!String(t).startsWith("cashuBfake")) return null;
  try {
    const { mint, proofs } = JSON.parse(Buffer.from(t.slice(10), "base64").toString());
    return { mint, sats: proofs.reduce((s, p) => s + Number(p.amount), 0) };
  } catch { return null; }
};
export const memStore = () => { let saved = null; return { load: () => saved && JSON.parse(saved), save: (s) => { saved = JSON.stringify(s); }, erase: () => { saved = null; } }; };
export const build = (net, store = memStore()) => new EcashWallet({ store, mintFor: (u) => new FakeMint(u, net), tokenInfo });

// Fill a wallet with `sats` (the fake mint says the invoice is paid at once).
export async function topUp(wallet, net, sats, mint = MINT) {
  const q = await wallet.fundStart(mint, sats);
  net[mint].quotes[q.id].state = "PAID";
  await wallet.claim(q.id);
}
