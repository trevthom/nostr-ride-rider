// ════════════════════════════════════════════════════════════
//  RECOVER REFUSED TICKS (rider side) — A driver may answer a payment with "refused" (kind 30096, ok:false). The rider's
//  app does not take that on trust: a driver could redeem the token and still say "refused", and the rider's app would
//  pay the same tick again, and again, until the wallet is empty.
//
//  So for each refused tick the rider's app tries to take its own token back from the mint (the token was sealed with
//  the rider's own key, so the rider can open it):
//    • the mint accepts it: the token was never spent. The money is back in the wallet, the tick was NOT paid, and it is
//      due again (lib/payments.js sentSats leaves it out);
//    • the mint says no (it is spent): the driver has the money, so the tick counts as paid, whatever the driver said;
//    • the mint cannot be reached: nothing is decided, the tick still counts as sent, and the app tries again later.
//  Either way the rider pays for a tick once.
//
//    recoverRefused({ request, user, ecash, nowMs }) → { recovered, spent, waiting }
// ════════════════════════════════════════════════════════════

import { ticksOf, tickReplies, tickVerdict, setTickVerdict, ownTickToken } from "../../lib/payments.js";

const inFlight = new Set();
const retryAt = new Map(); // tick id → ms epoch
const RETRY_MS = 15000;

export async function recoverRefused({ request, user, ecash, nowMs = Date.now() }) {
  const out = { recovered: 0, spent: 0, waiting: 0 };
  if (!ecash || user.publicKey !== request.pubkey) return out;
  const replies = tickReplies(request);
  for (const tick of ticksOf(request)) {
    if (replies.get(tick.id)?.ok !== false || tickVerdict(tick.id) || inFlight.has(tick.id)) continue;
    if ((retryAt.get(tick.id) || 0) > nowMs) { out.waiting++; continue; }
    inFlight.add(tick.id);
    try {
      const token = ownTickToken(tick, request, user);
      if (!token) { setTickVerdict(tick.id, "spent"); out.spent++; continue; } // cannot be opened: do not pay it twice
      try {
        await ecash.redeem(token);
        setTickVerdict(tick.id, "recovered");
        out.recovered++;
      } catch (e) {
        if (e?.definitive) { setTickVerdict(tick.id, "spent"); out.spent++; }
        else { retryAt.set(tick.id, nowMs + RETRY_MS); out.waiting++; }
      }
    } finally {
      inFlight.delete(tick.id);
    }
  }
  return out;
}
