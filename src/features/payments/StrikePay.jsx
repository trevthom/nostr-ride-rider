// ════════════════════════════════════════════════════════════
//  STRIKE PAY — Pay a Lightning invoice from the rider's Strike account, in three clear steps:
//    1. ask Strike what it costs (a quote) — nothing is sent yet;
//    2. show the cost and let the rider confirm (and pick the Bitcoin or the US dollar balance);
//    3. send it, and wait until Strike says it is done.
//  Used to fund the ecash wallet (AddFunds) and to tip (PayDriver). The invoice is always one the app made itself
//  (the mint's, or the driver's Lightning address), and Strike is asked to pay exactly that.
//
//    <StrikePay invoice="lnbc…" sats={2500} to="your ecash wallet" onPaid={({ id, state }) => …} onCancel={…} />
//  state: "done" | "pending" (Strike is still sending) | "unknown" (this key cannot read payments, so no way to tell).
// ════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { strikeAmountText } from "../../lib/strike.js";
import { moneyText } from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import CurrencyChoice from "./CurrencyChoice.jsx";

export default function StrikePay({ invoice, sats, to = "the invoice", onPaid, onCancel }) {
  const { strike, btcPrice } = useApp();
  const [quote, setQuote] = useState(null);
  const [phase, setPhase] = useState("quoting"); // quoting | ready | paying | error
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // A quote belongs to one paying balance, so choosing the other balance asks again.
  const getQuote = useCallback(async () => {
    setPhase("quoting");
    setError("");
    setQuote(null);
    try {
      const q = await strike.client.payQuote(invoice, strike.source);
      if (!alive.current) return;
      setQuote(q);
      setPhase("ready");
    } catch (e) {
      if (!alive.current) return;
      setError(e.message || "Strike could not make a quote.");
      setPhase("error");
    }
  }, [invoice, strike.client, strike.source]);
  useEffect(() => { getQuote(); }, [getQuote]);

  const pay = async () => {
    if (quote.validUntil && Date.now() > quote.validUntil - 2000) { getQuote(); return; } // the price ran out: ask again
    setPhase("paying");
    setError("");
    try {
      const sent = await strike.client.execute(quote.id);
      const state = sent.state === "pending" ? await strike.client.waitForPayment(sent.id) : sent.state;
      if (!alive.current) return;
      if (state === "failed") {
        setError("Strike could not send the payment. Look in your Strike app before you try again.");
        setPhase("error");
        return;
      }
      strike.refresh().catch(() => {});
      onPaid({ id: sent.id, state });
    } catch (e) {
      if (!alive.current) return;
      setError(`${e.message || "The payment failed."} Look in your Strike app before you try again, so you do not pay twice.`);
      setPhase("error");
    }
  };

  const from = strike.source === "USD" ? "US dollar" : "Bitcoin";
  return (
    <div>
      <p className="text-neutral-600 text-sm mb-3">Pay {moneyText(sats, btcPrice)} to {to} with your Strike account{strike.sandbox ? " (sandbox)" : ""}.</p>
      <p className="text-xs text-neutral-500 mb-1">Pay from</p>
      <CurrencyChoice value={strike.source} onChange={strike.setSource} label="Pay from" balances={strike.balances} disabled={phase === "paying"} />
      <div className="rounded-2xl bg-neutral-100 px-4 py-3 mt-3 min-h-[64px]" role="status">
        {phase === "quoting" && <p className="text-sm text-neutral-500">Asking Strike for the price…</p>}
        {(phase === "ready" || phase === "paying") && quote && (
          <>
            <p className="text-sm text-neutral-500">Strike takes about</p>
            <p className="text-2xl font-bold tabular-nums">{quote.total ? strikeAmountText(quote.total) : "the amount shown in Strike"}</p>
            <p className="text-xs text-neutral-500 mt-1">
              from your {from} balance{quote.fee ? `, including a network fee of ${strikeAmountText(quote.fee)}` : ""}.
              {strike.source === "USD" ? " Strike buys the bitcoin for you at its own rate." : ""}
            </p>
          </>
        )}
        {phase === "error" && <p className="text-red-600 text-sm" role="alert">{error}</p>}
      </div>
      <div className="mt-4 space-y-2">
        <Button onClick={pay} disabled={phase !== "ready"} loading={phase === "paying"}>{phase === "paying" ? "Paying…" : "Confirm and pay"}</Button>
        {phase === "error" && <Button variant="secondary" onClick={getQuote}>Ask Strike again</Button>}
        {phase !== "paying" && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}
