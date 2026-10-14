// ════════════════════════════════════════════════════════════
//  STRIKE — A small client for the Strike API (https://docs.strike.me). Strike is optional. It plays one of two parts:
//
//   • RIDER: Strike is the SENDER of the bitcoin. The app asks Strike to pay a Lightning invoice (the ecash mint's funding
//     invoice, or a tip) from the rider's Bitcoin OR US dollar balance:
//       payQuote(invoice, "BTC" | "USD")  →  the rider sees the cost and confirms  →  execute(id)  →  waitForPayment(id)
//     Paying from dollars makes Strike buy the bitcoin for the rider. The rider chooses which balance pays.
//   • DRIVER: Strike is the RECEIVER. A cash out asks Strike for an invoice and the ecash mint pays it:
//       receiveInvoice({ sats, currency: "BTC" | "USD", … })
//     The invoice is made IN the currency the driver chose, so Strike credits that currency: bitcoin (the exact sats), or US
//     dollars (Strike converts what arrives; the sats paid follow Strike's rate at that moment).
//
//  The person pastes their OWN API key (Strike dashboard → Developers). The key is kept in memory and, encrypted to the user's
//  own key, on this device (lib/strikekey.js). It is never logged and never leaves this file except in the Authorization header.
//  Each call names the permission ("scope") it needs, so a refusal says what to add to the key.
//
//  Not verified against live Strike yet (see docs/index.md, "Strike"): the paths and fields below follow Strike's public API
//  reference. Whether a browser may call api.strike.me directly (CORS) is also unverified: if not, point VITE_STRIKE_API_URL at
//  a small proxy.
//
//    const strike = makeStrike({ apiKey })       fetch and a clock can be passed in, for tests
// ════════════════════════════════════════════════════════════

import { STRIKE_API_URL } from "../config/services.js";
import { invoiceAmountMsat } from "./lnurl.js";

export class StrikeError extends Error {
  // code: "key" (not accepted) | "scope" (missing permission) | "network" | "amount" | "api" (Strike said no).
  constructor(code, message, { status = 0, strikeCode = "" } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.strikeCode = strikeCode;
  }
}

export const SCOPES = {
  balances: "partner.balances.read",
  quote: "partner.payment-quote.lightning.create",
  execute: "partner.payment-quote.execute",
  payment: "partner.payment.read",
  invoice: "partner.invoice.create",
  invoiceQuote: "partner.invoice.quote.generate",
  invoiceRead: "partner.invoice.read",
};

// Permissions to give a key, by what the person wants to do.
export const RIDER_SCOPES = [SCOPES.quote, SCOPES.execute, SCOPES.payment, SCOPES.balances];
export const DRIVER_SCOPES = [SCOPES.invoice, SCOPES.invoiceQuote, SCOPES.invoiceRead, SCOPES.balances];

export const NETWORK_MESSAGE =
  "Could not reach Strike. Check your connection. If you are online, Strike may not allow calls from a web page: ask the person who runs this app to set VITE_STRIKE_API_URL to a proxy.";

// ── Amounts. Strike writes bitcoin in BTC with up to 8 decimals ("0.00001000"), dollars as "12.34". ──
export function satsToBtc(sats) {
  const s = Math.round(Number(sats));
  if (!Number.isFinite(s) || s < 0) throw new StrikeError("amount", "That amount is not valid.");
  return `${Math.floor(s / 1e8)}.${String(s % 1e8).padStart(8, "0")}`;
}
export function btcToSats(text) {
  const m = /^(\d+)(?:\.(\d{0,8})\d*)?$/.exec(String(text ?? "").trim());
  return m ? Number(m[1]) * 1e8 + Number((m[2] || "").padEnd(8, "0")) : null;
}
const money = (m) => (m && typeof m.amount === "string" && typeof m.currency === "string" ? { currency: m.currency.toUpperCase(), amount: m.amount } : null);

// "$12.34", "€5.00" or "0.00001000 BTC (1,000 sats)" for an amount { currency, amount } from Strike.
export function strikeAmountText(m, locale) {
  if (!m) return "";
  if (m.currency === "BTC") {
    const sats = btcToSats(m.amount);
    return sats == null ? `${m.amount} BTC` : `${sats.toLocaleString(locale)} ${sats === 1 ? "sat" : "sats"}`;
  }
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency }).format(Number(m.amount)); }
  catch { return `${m.amount} ${m.currency}`; }
}

// A balance from balances(): BTC as sats, other currencies as money.
export function balanceText(code, n, locale) {
  if (!Number.isFinite(n)) return "";
  return code === "BTC" ? strikeAmountText({ currency: "BTC", amount: satsToBtc(Math.round(n * 1e8)) }, locale) : strikeAmountText({ currency: code, amount: String(n) }, locale);
}

// A payment's state as Strike words it → "done" | "failed" | "pending".
const DONE = new Set(["COMPLETED", "SUCCESS", "SUCCEEDED", "PAID", "SETTLED"]);
const FAILED = new Set(["FAILED", "FAILURE", "CANCELLED", "CANCELED", "EXPIRED", "DECLINED", "REJECTED", "REVERSED"]);
export function paymentState(d) {
  const word = (v) => String(v ?? "").toUpperCase();
  if (FAILED.has(word(d?.state)) || FAILED.has(word(d?.result)) || FAILED.has(word(d?.status))) return "failed";
  if (DONE.has(word(d?.state)) || DONE.has(word(d?.result)) || DONE.has(word(d?.status))) return "done";
  return "pending";
}

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// How far the sats of a dollar invoice may differ from the sats asked for before the app refuses it (a wrong rate somewhere).
export const USD_TOLERANCE = 0.05;

// The smallest step of a dollar invoice (one cent) in sats at this price, and how far a dollar invoice for a ride payment may be from the
// tick it pays: the cent steps and two prices a moment apart (2%). Both apps use it: the rider refuses to pay more, the driver credits the whole tick.
export const centSats = (usdPerBtc) => (usdPerBtc > 0 ? Math.ceil(1e8 / (usdPerBtc * 100)) : 0);
export const tickSlack = (tickSats, usdPerBtc) => Math.max(Math.ceil(tickSats * 0.02), 2 * centSats(usdPerBtc));
// May a rider's app pay an invoice of `invoiceSats` for a tick of `tickSats`? Bitcoin invoices may not ask for more than the tick.
export function invoiceFits({ tickSats, invoiceSats, currency, usdPerBtc }) {
  if (!Number.isFinite(invoiceSats) || invoiceSats < 1 || !(tickSats >= 1)) return false;
  if (currency !== "USD") return invoiceSats <= tickSats;
  return usdPerBtc > 0 && invoiceSats <= tickSats + tickSlack(tickSats, usdPerBtc);
}

export function makeStrike({ apiKey, baseUrl = STRIKE_API_URL, fetchImpl, newId = uuid, sleep = sleepMs } = {}) {
  const base = String(baseUrl).replace(/\/+$/, "");
  const doFetch = fetchImpl || ((...a) => fetch(...a));

  async function call(method, path, { body, key, need } = {}) {
    let res;
    try {
      res = await doFetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(key ? { "idempotency-key": key } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new StrikeError("network", NETWORK_MESSAGE);
    }
    let data = null;
    try { const text = await res.text(); data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (res.ok) return data;
    const detail = data?.data || data || {};
    const info = { status: res.status, strikeCode: String(detail.code || "") };
    if (res.status === 401) throw new StrikeError("key", "Strike did not accept this API key. Check that you copied all of it and that it has not been deleted.", info);
    if (res.status === 403) throw new StrikeError("scope", `This API key is not allowed to do that.${need ? ` In Strike, give the key the permission "${need}".` : ""}`, info);
    if (res.status === 429) throw new StrikeError("api", "Strike says too many requests. Wait a minute and try again.", info);
    if (res.status >= 500) throw new StrikeError("api", `Strike had a problem (${res.status}). Try again in a moment.`, info);
    throw new StrikeError("api", String(detail.message || `Strike refused the request (${res.status}).`).slice(0, 300), info);
  }

  return {
    baseUrl: base,
    sandbox: /api\.next\.strike\.me/.test(base),

    // Does the key work? Returns { balances } (null when the key may not read balances). Throws "key" for a bad key.
    async check() {
      try { return { balances: await this.balances() }; }
      catch (e) { if (e.code === "scope") return { balances: null }; throw e; }
    },

    // { BTC: 0.00123, USD: 12.34 } — what can be spent now, by currency.
    async balances() {
      const list = await call("GET", "/v1/balances", { need: SCOPES.balances });
      const out = {};
      for (const b of Array.isArray(list) ? list : []) {
        const n = Number(b.available ?? b.current ?? b.total);
        if (b.currency && Number.isFinite(n)) out[String(b.currency).toUpperCase()] = n;
      }
      return out;
    },

    // ── RIDER: pay a Lightning invoice ──
    // A quote: what paying this invoice costs, valid for a short time. Nothing is sent yet.
    async payQuote(lnInvoice, sourceCurrency) {
      const d = await call("POST", "/v1/payment-quotes/lightning", { body: { lnInvoice, sourceCurrency }, key: newId(), need: SCOPES.quote });
      if (!d?.paymentQuoteId) throw new StrikeError("api", "Strike answered in a way this app does not understand.");
      return {
        id: String(d.paymentQuoteId),
        source: sourceCurrency,
        validUntil: d.validUntil ? Date.parse(d.validUntil) || null : null,
        total: money(d.totalAmount) || money(d.amount),
        fee: money(d.lightningNetworkFee) || money(d.totalFee),
        rate: d.conversionRate || null,
      };
    },
    // Send the payment the quote described. Returns { id, state } (state: done | failed | pending).
    async execute(quoteId) {
      const d = await call("PATCH", `/v1/payment-quotes/${encodeURIComponent(quoteId)}/execute`, { need: SCOPES.execute });
      return { id: d?.paymentId || d?.id || null, state: paymentState(d) };
    },
    async payment(paymentId) {
      const d = await call("GET", `/v1/payments/${encodeURIComponent(paymentId)}`, { need: SCOPES.payment });
      return { id: paymentId, state: paymentState(d) };
    },
    // Wait for a payment to finish: "done" | "failed" | "pending" (still going after the wait) | "unknown" (no way to ask).
    async waitForPayment(paymentId, { tries = 20, delayMs = 1500 } = {}) {
      if (!paymentId) return "unknown";
      for (let i = 0; i < tries; i++) {
        let st = "pending";
        try { st = (await this.payment(paymentId)).state; }
        catch (e) { if (e.code === "scope" || e.code === "key") return "unknown"; }
        if (st !== "pending") return st;
        await sleep(delayMs);
      }
      return "pending";
    },

    // An invoice of ours: "UNPAID" | "PENDING" | "PAID" | "CANCELLED" (as Strike words it).
    async invoiceState(invoiceId) {
      const d = await call("GET", `/v1/invoices/${encodeURIComponent(invoiceId)}`, { need: SCOPES.invoiceRead });
      return String(d?.state || "").toUpperCase();
    },

    // ── DRIVER: get paid by a Lightning invoice ──
    // An invoice made in `currency` for about `sats`. BTC: exactly `sats`. USD: `usdPerBtc` (the market price) gives the
    // dollar amount in whole cents, and Strike turns it into an invoice whose sats follow its own rate.
    // Returns { bolt11, sats, receive: { currency, amount }, invoiceId, expiresInSec }.
    async receiveInvoice({ sats, currency, usdPerBtc, description = "NostrRide cash out" }) {
      let amount;
      if (currency === "BTC") amount = { currency: "BTC", amount: satsToBtc(sats) };
      else if (currency === "USD") {
        if (!(usdPerBtc > 0)) throw new StrikeError("amount", "The bitcoin price is not known yet. Try again in a moment.");
        const cents = Math.floor(((sats * usdPerBtc) / 1e8) * 100 + 1e-9);
        if (cents < 1) throw new StrikeError("amount", "That is too little to receive as US dollars.");
        amount = { currency: "USD", amount: (cents / 100).toFixed(2) };
      } else throw new StrikeError("amount", "Choose Bitcoin or US dollars.");

      const inv = await call("POST", "/v1/invoices", { body: { correlationId: newId(), description, amount }, need: SCOPES.invoice });
      if (!inv?.invoiceId) throw new StrikeError("api", "Strike answered in a way this app does not understand.");
      const q = await call("POST", `/v1/invoices/${encodeURIComponent(inv.invoiceId)}/quote`, { body: {}, need: SCOPES.invoiceQuote });
      const bolt11 = String(q?.lnInvoice || "").trim();
      const msat = invoiceAmountMsat(bolt11);
      if (!bolt11 || msat == null) throw new StrikeError("api", "Strike did not give a Lightning invoice with an amount.");
      const got = msat / 1000;
      const off = currency === "BTC" ? got !== sats : Math.abs(got - sats) / sats > USD_TOLERANCE;
      if (off) throw new StrikeError("amount", `Strike made an invoice for ${got.toLocaleString()} sats, not about ${sats.toLocaleString()}. Nothing was sent.`);
      return { bolt11, sats: got, receive: amount, invoiceId: String(inv.invoiceId), expiresInSec: Number(q.expirationInSec) > 0 ? Number(q.expirationInSec) : 3600 };
    },
  };
}
