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

import { relay } from "../../nostr/relay.js";
import { recipientsOf } from "../../nostr/sealing.js";
import { currentLedger, ledgerSummary } from "../../lib/ridemoney.js";
import { rideDriver } from "../../lib/rides.js";
import { tickEvent, ticksOf, tickReplies, sentSats, forgivenSats } from "../../lib/payments.js";
import { dueSats } from "../../lib/ticks.js";
import { recoverRefused } from "./recoverRefused.js";
import { releaseWhenSafe } from "./handoff.js";

export const MIN_TICK_SATS = 3; // below this the difference is just a mint fee; it is paid with the next tick
const busy = new Set(); // ride keys with a payment in flight (one at a time, so a tick is never paid twice)

// ── Sending a paid tick again ──
// "A relay accepted the event" is not the same as "the driver can read it": a relay in the list may be one the driver never
// connects to (or the only relay that answered was a bad one). The token then leaves the wallet (handoff.js) and the driver never
// redeems it. So every tick the driver has not answered is sent to the relays AGAIN, from time to time. The SAME signed event is
// re-sent, so relays and the driver's app recognise it by id; it can never pay twice.
export const RESEND_AFTER_MS = 20000; // give the first send a moment
const RESEND_EVERY_MS = 60000;
const resentAt = new Map();
// It is sent as gift wraps again (never as a plain event: a tick belongs in a wrap, like every job event). Nothing is sent while this
// device has no relay connection: the first durable publish already left the event in the outbox, and a re-send now would only pile
// up wraps that cannot go anywhere.
export function resendUnansweredTicks(request, { nowMs = Date.now(), online = relay.linkUp(), send = (ev) => relay.sealTo(ev, recipientsOf(ev)) } = {}) {
  if (!online) return 0;
  const replies = tickReplies(request);
  let sent = 0;
  for (const t of ticksOf(request)) {
    if (replies.has(t.id) || nowMs - t.at < RESEND_AFTER_MS) continue;
    if (nowMs - (resentAt.get(t.id) || 0) < RESEND_EVERY_MS) continue;
    resentAt.set(t.id, nowMs);
    try { Promise.resolve(send(t.event)).catch(() => {}); sent++; } catch { /* the next try */ }
  }
  return sent;
}

export async function payDue({ request, user, ecash, publish, terms, mint, price, nowMs = Date.now(), miles, capSats = null }) {
  const driver = rideDriver(request);
  recoverRefused({ request, user, ecash, nowMs }).catch(() => {}); // a "refused" tick is checked at the mint, in the background; it is paid again only if the token came back
  resendUnansweredTicks(request, { nowMs }); // a tick the driver never answered may not have reached them: send it again
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
    // The event now holds the money. A durable publish saves it in the outbox BEFORE it is sent, and only then is the token released
    // from the wallet (handoff.js): a closed tab or a killed app in the next seconds loses nothing.
    releaseWhenSafe(ecash, pay.id, publish(ev.kind, ev.content, ev.tags, { durable: true }));
    return { status: amount < due ? "short" : "paid", due: due - pay.sats, shortSats: due - pay.sats, sentNow: pay.sats, ...base };
  } finally {
    busy.delete(lock);
  }
}
