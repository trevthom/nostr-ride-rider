// ════════════════════════════════════════════════════════════
//  HANDOFF — When is it safe to let go of a token that sits in an event? A tick, a refund or a delivery payment carries
//  ecash. Until the wallet lets go of it (settle), the token waits in `pending` and a crash loses nothing. After it, the event is
//  the only place the token lives, so the event must be SAFE first:
//    • saved in the outbox on this device (it is sent again until a relay takes it), or
//    • accepted by a relay.
//  `sent` is the promise that publish(…, { durable: true }) returns (it has `.stored`, see nostr/relay.js publish).
//  If neither happens the token stays in `pending`; wallet.recoverPending() gives it back when the mint says it was never taken.
//
//    releaseWhenSafe(ecash, pendingId, sent)
// ════════════════════════════════════════════════════════════

export function releaseWhenSafe(ecash, id, sent) {
  if (sent && sent.stored === true) { ecash.settle(id); return; }
  Promise.resolve(sent).then((ok) => { if (ok === true) ecash.settle(id); }).catch(() => { /* stays pending */ });
}
