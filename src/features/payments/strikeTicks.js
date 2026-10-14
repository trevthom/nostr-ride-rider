// ════════════════════════════════════════════════════════════
//  STRIKE TICKS (rider side) — Pays the driver from the rider's Strike account while the ride runs, with no ecash mint
//  (lib/strikerail.js explains the four steps). Called every few seconds, like rideTicks.js payDue, for a ride whose rail is "strike":
//    1. works out what the ride has earned and subtracts what was already sent; if something is due, it checks the Strike balance
//       and publishes ONE tick (kind 30095, rail "strike") — a request for an invoice, not a payment;
//    2. for every tick the driver has answered with an invoice, it checks the invoice is for the tick (not more), then asks Strike to
//       quote and pay it, from the balance the rider chose.
//  Safety:
//    • an invoice is sent to Strike ONCE: it is marked "paying" before the call. If the answer is lost (the network dropped) the invoice
//      is not tried again; the driver's own Strike says whether it was paid, and an unpaid tick runs out and is asked for again;
//    • only a clear "no" from Strike that came before any money moved (a refused quote, a 4xx on execute) is retried;
//    • an invoice that asks for more than the tick (beyond the cent-sized slack of a dollar invoice) is never paid.
//
//    payRideStrike({ request, user, strike, publish, terms, price, usdPrice, nowMs, miles }) → { status, due, … , message? }
//      status: "ok" nothing due · "paid" a tick was requested · "short" Strike balance too low · "wait" not ready · "error" Strike refused
// ════════════════════════════════════════════════════════════

import { currentLedger, ledgerSummary } from "../../lib/ridemoney.js";
import { rideDriver } from "../../lib/rides.js";
import { tickEvent, ticksOf, tickReplies, sentSats, forgivenSats } from "../../lib/payments.js";
import { dueSats } from "../../lib/ticks.js";
import { invoicesOf, invoiceBolt, payRecords, strikeCanPay } from "../../lib/strikerail.js";
import { invoiceFits } from "../../lib/strike.js";
import { invoiceAmountMsat } from "../../lib/lnurl.js";
import { MIN_TICK_SATS } from "./rideTicks.js";

const busy = new Set();
const BAD_INVOICE = "The driver's invoice does not match the payment, so it was not paid.";
const RETRY_MS = 15000;
const RETRY_AFTER_ACTION_MS = 60000; // the key or the balance needs the person's attention: do not hammer Strike

// Pay the invoices the driver has made for our ticks. Returns { paid, error }.
export async function payInvoices({ request, user, strike, usdPrice, nowMs = Date.now() }) {
  const out = { paid: 0, error: "" };
  const client = strike?.client;
  if (!client) return out;
  const replies = tickReplies(request), invoices = invoicesOf(request);
  for (const tick of ticksOf(request)) {
    if (tick.rail !== "strike" || replies.has(tick.id)) continue;
    const inv = invoices.get(tick.id);
    if (!inv || inv.ok === false || (inv.expiresAt && nowMs > inv.expiresAt)) continue;
    const rec = payRecords.get(tick.id);
    if (rec?.state === "bad") { out.error = out.error || BAD_INVOICE; continue; } // keep saying so while that invoice could still be paid
    if (rec && (rec.state === "paying" || rec.state === "paid")) continue;
    if (rec?.state === "retry" && rec.retryAt > nowMs) { out.error = out.error || rec.why || ""; continue; }
    const bolt11 = invoiceBolt(inv, request, user);
    const sats = bolt11 ? invoiceAmountMsat(bolt11) / 1000 : NaN;
    if (!bolt11 || !invoiceFits({ tickSats: tick.amountSats, invoiceSats: sats, currency: inv.currency, usdPerBtc: usdPrice })) {
      // Not for this tick: a wrong amount, or no price to check a dollar invoice against. Dollar invoices wait for a price; others are never paid.
      if (bolt11 && inv.currency === "USD" && !(usdPrice > 0)) continue;
      payRecords.set(tick.id, { state: "bad" });
      out.error = BAD_INVOICE;
      continue;
    }
    let quote;
    try {
      quote = await client.payQuote(bolt11, strike.source); // nothing is sent yet: a failure here is always safe to retry
    } catch (e) {
      payRecords.set(tick.id, { state: "retry", retryAt: nowMs + (e.code === "scope" || e.code === "key" ? RETRY_AFTER_ACTION_MS : RETRY_MS), why: e.message });
      out.error = e.message;
      continue;
    }
    payRecords.set(tick.id, { state: "paying" }); // from here on the outcome may be unknown
    try {
      await client.execute(quote.id);
      payRecords.set(tick.id, { state: "paid" });
      out.paid++;
    } catch (e) {
      const clearNo = e.status >= 400 && e.status < 500 && e.status !== 409 && e.status !== 408;
      if (clearNo) payRecords.set(tick.id, { state: "retry", retryAt: nowMs + (e.code === "scope" ? RETRY_AFTER_ACTION_MS : RETRY_MS), why: e.message });
      out.error = e.message;
    }
  }
  return out;
}

export async function payRideStrike({ request, user, strike, publish, terms, price, usdPrice, nowMs = Date.now(), miles }) {
  const driver = rideDriver(request);
  const ledger = currentLedger(request, { terms, price, nowMs, miles, role: "rider" });
  const sum = ledgerSummary(request, ledger);
  const base = { ...sum, ledger };
  if (!ledger || !driver) return { status: "wait", due: 0, ...base };
  if (!strike?.client) return { status: "wait", due: 0, ...base };

  const lock = request.pubkey + ":" + request.id;
  if (busy.has(lock)) return { status: "paying", due: 0, ...base };
  busy.add(lock);
  try {
    // 2. Pay what the driver has invoiced.
    const inv = await payInvoices({ request, user, strike, usdPrice, nowMs });

    // 1. Ask for what is due now.
    const sent = sentSats(request, nowMs) + forgivenSats(request);
    const due = dueSats(ledger, sent);
    const final = !!ledger.final;
    let status = "ok", requested = 0;
    if (due > 0 && (due >= MIN_TICK_SATS || final)) {
      let balances = null;
      try { balances = await strike.client.balances(); } catch { /* the key may not read balances: Strike will say if the money is not there */ }
      if (strikeCanPay(balances, strike.source, due, usdPrice) === false) {
        status = "short";
      } else {
        const last = ledger.final ? "final" : (ledger.units[ledger.units.length - 1] || {}).id || "";
        const ev = tickEvent(request, driver, user, { seq: ticksOf(request).length + 1, trigger: last, amountSats: due, rail: "strike", at: nowMs });
        publish(ev.kind, ev.content, ev.tags).catch(() => {});
        status = "paid";
        requested = due;
      }
    }
    if (inv.error && status !== "short") status = "error";
    return { status, due: status === "short" ? due : Math.max(0, due - requested), shortSats: status === "short" ? due : 0, sentNow: requested, message: inv.error || undefined, ...base };
  } finally {
    busy.delete(lock);
  }
}
