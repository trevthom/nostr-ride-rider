// ════════════════════════════════════════════════════════════
//  RIDE TICKS (rider side) — Pays the driver while the ride runs. Called every
//  few seconds for the current ride (and once more after it ended, for the
//  final tick): works out what the ride has earned (lib/ridemoney.js), subtracts what
//  was already sent, and pays the difference from the ecash wallet as ONE signed tick
//  (kind 30095, the token sealed to the driver).
//
//  A payment that cannot be made (the wallet is short) simply stays due. Nothing is
//  lost and nothing is paid twice: the next call pays everything due, including the
//  missed ticks, as soon as the wallet has money again. Partial payments are made when
//  the wallet has some money but not enough, so the driver is covered as far as possible.
//
//    payDue({ request, user, ecash, publish, terms, mint, price, nowMs, miles, capSats }) → result
//      result = { status, due, paid, sent, owed, ... }
//        status: "ok" nothing is due · "paid" a tick was sent · "short" the wallet is too low
//                "wait" no price/ecash/mint yet · "error" the mint refused (message)
//                "capped" the ride reached its spending cap (lib/spendcap.js): `held` sats are due but not paid until the rider allows more
// ════════════════════════════════════════════════════════════

import { currentLedger, ledgerSummary } from "../../lib/ridemoney.js";
import { rideDriver } from "../../lib/rides.js";
import { tickEvent, ticksOf, sentSats, forgivenSats } from "../../lib/payments.js";
import { dueSats } from "../../lib/ticks.js";
import { recoverRefused } from "./recoverRefused.js";

export const MIN_TICK_SATS = 3; // below this the difference is just a mint fee; it is paid with the next tick
const busy = new Set(); // ride keys with a payment in flight (one at a time, so a tick is never paid twice)

export async function payDue({ request, user, ecash, publish, terms, mint, price, nowMs = Date.now(), miles, capSats = null }) {
  const driver = rideDriver(request);
  recoverRefused({ request, user, ecash, nowMs }).catch(() => {}); // a "refused" tick is checked at the mint, in the background; it is paid again only if the token came back
  const ledger = currentLedger(request, { terms, price, nowMs, miles, role: "rider" });
  const sum = ledgerSummary(request, ledger);
  const base = { ...sum, ledger };
  if (!ledger || !driver) return { status: "wait", due: 0, ...base };
  const sent = sentSats(request) + forgivenSats(request);
  const owedDue = dueSats(ledger, sent);
  // Never past the ride's cap: what is over it waits until the rider says so.
  let due = owedDue, capped = false;
  if (Number.isFinite(capSats)) {
    const room = Math.max(0, capSats - sentSats(request));
    if (due > room) { due = room; capped = true; }
  }
  if (due <= 0) return capped ? { status: "capped", due: 0, held: owedDue, capSats, ...base } : { status: "ok", due: 0, ...base };
  const final = !!ledger.final;
  if (due < MIN_TICK_SATS && !final) return capped ? { status: "capped", due: 0, held: owedDue, capSats, ...base } : { status: "ok", due, ...base };
  if (!ecash || !mint) return { status: "wait", due, ...base };

  const lock = request.pubkey + ":" + request.id;
  if (busy.has(lock)) return { status: "paying", due, ...base };
  busy.add(lock);
  try {
    const have = ecash.balance(mint);
    if (have <= 0) return { status: "short", due, shortSats: due, ...base };
    // The mint may take a few sats of fee on top of the tick: leave room for it when paying part.
    let amount = due;
    if (have < due + 2) amount = Math.max(0, have - 2 - Math.ceil(have * 0.01));
    if (amount < 1) return { status: "short", due, shortSats: due, ...base };
    let pay;
    try {
      pay = await ecash.pay(mint, amount);
    } catch (e) {
      if (e.code === "funds") return { status: "short", due, shortSats: due - have, ...base };
      return { status: "error", due, message: e.message, ...base };
    }
    const last = ledger.final ? "final" : (ledger.units[ledger.units.length - 1] || {}).id || "";
    const ev = tickEvent(request, driver, user, { seq: ticksOf(request).length + 1, trigger: last, amountSats: pay.sats, mint, token: pay.token });
    // The event now holds the money. publish() caches it and queues it for re-sending if no relay answers,
    // so the pending token can be released.
    publish(ev.kind, ev.content, ev.tags).catch(() => {});
    ecash.settle(pay.id);
    return { status: amount < due ? "short" : "paid", due: due - pay.sats, shortSats: due - pay.sats, sentNow: pay.sats, ...base };
  } finally {
    busy.delete(lock);
  }
}
