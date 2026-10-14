// ════════════════════════════════════════════════════════════
//  PAY DRIVER — Pays `amountSats` to the driver's Lightning address
//  (lud16 in their profile). Three ways:
//    • Strike — the rider's linked Strike account pays the driver's invoice, after the rider has
//      seen the cost (features/payments/StrikePay.jsx). Done when Strike says it is done.
//    • Connected wallet — gets an invoice from the driver's address
//      and pays it over NWC. Done when the wallet confirms.
//    • Any other wallet — shows the driver's invoice (QR / string /
//      lightning: link). If the driver's server supports LUD-21 we
//      watch for payment; otherwise the rider confirms by hand.
//  Calls onPaid(proof) once. proof = { verified, level, pr, preimage, verify }
//  (level: preimage | wallet | verify | claimed — see lib/evidence.js). It is
//  kept as evidence for a dispute.
// ════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { moneyText } from "../../ui/Money.jsx";
import { payInvoice } from "../../nostr/wallet.js";
import { requestInvoice, invoiceStatus } from "../../lib/lnurl.js";
import { proofLevel } from "../../lib/evidence.js";
import QRCode from "../../ui/QRCode.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import StrikePay from "./StrikePay.jsx";

export default function PayDriver({ amountSats, address, memo = "NostrRide fare", onPaid }) {
  const { wallet, strike, btcPrice } = useApp();
  const [strikeInv, setStrikeInv] = useState(null); // the driver's invoice while the Strike panel is open
  const [busy, setBusy] = useState(""); // "" | "wallet" | "invoice" | "check"
  const [error, setError] = useState("");
  const [invoice, setInvoice] = useState(null); // { pr, verify }
  const [mode, setMode] = useState("qr"); // "qr" | "string" | "url"
  const [copied, setCopied] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const doneRef = useRef(false);

  // Build the proof record from how we learned the payment went through.
  const finish = ({ via, pr, preimage = null, verify = null }) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const level = proofLevel({ via, pr, preimage });
    onPaid({ verified: level !== "claimed", level, pr, preimage, verify });
  };

  // LUD-21: watch the invoice and finish by itself once it's paid.
  useEffect(() => {
    if (!invoice?.verify) return;
    const id = setInterval(async () => {
      try {
        const st = await invoiceStatus(invoice.verify);
        if (st.settled) finish({ via: "verify", pr: invoice.pr, preimage: st.preimage, verify: invoice.verify });
      } catch { /* retry next tick */ }
    }, 3000);
    return () => clearInterval(id);
  }, [invoice]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!address) {
    return (
      <p className="text-amber-700 text-sm text-center">
        This driver has no Lightning address, so you can't pay them in the app.
      </p>
    );
  }

  const payWithWallet = async () => {
    setBusy("wallet");
    setError("");
    try {
      const { pr } = await requestInvoice(address, amountSats, memo);
      const res = await payInvoice(wallet, pr);
      finish({ via: "wallet", pr, preimage: res?.preimage });
    } catch (e) {
      setError(
        (e.message || "Payment failed.") +
          " Check your wallet's history before you try again, so you don't pay twice."
      );
    }
    setBusy("");
  };

  const startStrike = async () => {
    setBusy("strike");
    setError("");
    try {
      setStrikeInv((await requestInvoice(address, amountSats, memo)).pr);
    } catch (e) {
      setError(e.message || "Couldn't get an invoice from the driver's wallet.");
    }
    setBusy("");
  };
  const strikePaid = ({ state }) => {
    const pr = strikeInv;
    setStrikeInv(null);
    if (state === "pending") return setError("Strike is still sending this payment. Look in your Strike app before you try again, so you don't pay twice.");
    finish({ via: "wallet", pr });
  };

  const showInvoice = async () => {
    setBusy("invoice");
    setError("");
    try {
      setInvoice(await requestInvoice(address, amountSats, memo));
    } catch (e) {
      setError(e.message || "Couldn't get an invoice from the driver's wallet.");
    }
    setBusy("");
  };

  // "I've paid": check now if we can; otherwise trust the rider.
  const confirmPaid = async () => {
    if (!invoice.verify) { finish({ via: "claimed", pr: invoice.pr }); return; }
    setBusy("check");
    setNotYet(false);
    try {
      const st = await invoiceStatus(invoice.verify);
      if (st.settled) finish({ via: "verify", pr: invoice.pr, preimage: st.preimage, verify: invoice.verify });
      else setNotYet(true);
    } catch (e) {
      setError(e.message || "Couldn't check the payment.");
    }
    setBusy("");
  };

  const copy = (text) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const amountText = moneyText(amountSats, btcPrice);
  if (strikeInv) return <StrikePay invoice={strikeInv} sats={amountSats} to="your driver" onPaid={strikePaid} onCancel={() => setStrikeInv(null)} />;
  return (
    <div>
      {/* Option 0: the linked Strike account */}
      {strike.connected && (
        <Button onClick={startStrike} loading={busy === "strike"} className="mb-2">
          {busy === "strike" ? "Getting invoice…" : <><Icon name="zap" size={18} />Pay {amountText} with Strike</>}
        </Button>
      )}
      {/* Option 1: connected wallet */}
      <Button variant={strike.connected ? "secondary" : "primary"} onClick={payWithWallet} disabled={!wallet.connected} loading={busy === "wallet"} className="mb-2">
        {busy === "wallet" ? "Paying…" : <><Icon name="zap" size={18} />Pay {amountText} with wallet</>}
      </Button>
      {!wallet.connected && (
        <p className="text-neutral-500 text-xs text-center mb-3">Connect {strike.connected ? "a Lightning" : "Strike or a"} wallet in Account to pay in one tap.</p>
      )}

      {/* Option 2: the driver's invoice, for any wallet */}
      {!invoice ? (
        <Button variant="secondary" onClick={showInvoice} loading={busy === "invoice"}>
          {busy === "invoice" ? "Getting invoice…" : "Pay from another wallet"}
        </Button>
      ) : (
        <div className="bg-neutral-100 rounded-2xl p-4 text-center">
          <div className="flex gap-2 justify-center mb-3 flex-wrap">
            <Toggle active={mode === "qr"} onClick={() => setMode("qr")}>QR code</Toggle>
            <Toggle active={mode === "string"} onClick={() => setMode("string")}>Invoice</Toggle>
            <Toggle active={mode === "url"} onClick={() => setMode("url")}>Open wallet</Toggle>
          </div>
          {mode === "qr" && <div className="flex justify-center mb-3"><QRCode value={invoice.pr} size={180} /></div>}
          {mode === "string" && (
            <div className="mb-3">
              <p className="text-neutral-600 text-xs font-mono break-all bg-white rounded-lg p-3">{invoice.pr}</p>
              <button type="button" onClick={() => copy(invoice.pr)} className="text-blue-600 text-sm font-medium mt-2">{copied ? "Copied!" : "Copy"}</button>
            </div>
          )}
          {mode === "url" && (
            <div className="mb-3">
              <a href={`lightning:${invoice.pr}`} className="inline-flex items-center gap-1.5 bg-black text-white rounded-full px-5 py-2.5 text-sm font-semibold">
                <Icon name="zap" size={16} /> Open in Lightning wallet
              </a>
            </div>
          )}
          <p className="text-neutral-500 text-xs mb-3">
            {invoice.verify
              ? "This invoice pays the driver directly. This screen updates by itself when the payment arrives."
              : "This invoice pays the driver directly. The driver's wallet can't confirm payments, so tap below only after your wallet shows the payment as sent."}
          </p>
          {notYet && <p className="text-amber-700 text-xs mb-2">Not received yet. Wait a moment and try again.</p>}
          <Button onClick={confirmPaid} loading={busy === "check"} size="md">{busy === "check" ? "Checking…" : "I've paid"}</Button>
        </div>
      )}

      {error && <p className="text-red-600 text-xs text-center mt-3">{error}</p>}
    </div>
  );
}

function Toggle({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold ${active ? "bg-black text-white" : "bg-white text-neutral-600"}`}
    >
      {children}
    </button>
  );
}
