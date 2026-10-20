// ════════════════════════════════════════════════════════════
//  ADD FUNDS — Fill the ecash wallet. Two ways, as tabs:
//    • Lightning: the mint makes an invoice; once it is paid, the app collects the ecash.
//    • On-chain: the mint gives a bitcoin address (OnchainFunds.jsx; only mints that support it).
//  The Lightning tab shows the invoice (QR / text / "open wallet") for any wallet.
//  A paid invoice that is not collected yet (the app was closed) is collected the
//  next time the app opens (ecash.claimAll), so a payment is never lost.
//
//    <AddFunds mint="https://…" needSats={2500} onClose={…} onDone={(sats) => …} />
//  `needSats` = the amount the screen asks for (the field starts a little above it).
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { mintLabel } from "../../lib/mints.js";
import { satsFromFiat } from "../../lib/currency.js";
import { Modal } from "../../ui/Parts.jsx";
import AmountInput from "../../ui/AmountInput.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import QRCode from "../../ui/QRCode.jsx";
import { moneyText } from "../../ui/Money.jsx";
import OnchainFunds from "./OnchainFunds.jsx";
import AutoCashWarning from "./AutoCashWarning.jsx";

const MIN = 100, MAX = 5_000_000;

export default function AddFunds({ mint, needSats = 0, onClose, onDone }) {
  const { ecash, btcPrice } = useApp();
  // Start a little above what is needed (a round, useful amount), and at least about 5 in local money.
  const start = Math.min(MAX, Math.max(MIN, Math.ceil((needSats * 1.25) / 100) * 100, btcPrice ? Math.round((satsFromFiat(5, btcPrice) || 0) / 100) * 100 : 5000));
  const [sats, setSats] = useState(start);
  const [quote, setQuote] = useState(null); // { id, invoice }
  const [busy, setBusy] = useState(""); // "" | "making"
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // sats added
  const [mode, setMode] = useState("qr");
  const [method, setMethod] = useState("lightning"); // "lightning" | "onchain"
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Watch the invoice until the mint has been paid; then the ecash is ours.
  useEffect(() => {
    if (!quote || done != null) return;
    let stop = false;
    const look = async () => {
      try {
        const r = await ecash.claim(quote.id);
        if (stop || !alive.current) return;
        if (r.state === "ISSUED") { setDone(r.sats); onDone && onDone(r.sats); }
      } catch { /* try again */ }
    };
    const id = setInterval(look, 2500);
    look();
    return () => { stop = true; clearInterval(id); };
  }, [quote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = Number.isFinite(sats) && sats >= MIN && sats <= MAX;

  const make = async () => {
    setBusy("making");
    setError("");
    try {
      const q = await ecash.fundStart(mint, Math.round(sats));
      if (!alive.current) return;
      setQuote({ id: q.id, invoice: q.invoice });
    } catch (e) {
      setError(e.message || "Something went wrong.");
    }
    if (alive.current) setBusy("");
  };

  const tabs = (
    <div className="flex gap-2 mb-4" role="tablist" aria-label="How to add funds">
      {[["lightning", "Lightning"], ["onchain", "On-chain"]].map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={method === id} onClick={() => setMethod(id)}
          className={`flex-1 py-2 rounded-full text-sm font-semibold ${method === id ? "bg-black text-white" : "bg-neutral-100 text-neutral-600"}`}>{label}</button>
      ))}
    </div>
  );

  return (
    <Modal open title="Add funds" onClose={onClose}>
      {done == null && method === "onchain" ? (
        <>
          {tabs}
          <AutoCashWarning mint={mint} />
          <OnchainFunds mint={mint} onDone={(sats) => { setDone(sats); onDone && onDone(sats); }} />
        </>
      ) : done != null ? (
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full bg-[#e6f4ec] text-[#05944f] flex items-center justify-center mx-auto mb-3"><Icon name="check" size={28} strokeWidth={3} /></div>
          <p className="text-xl font-bold">{moneyText(done, btcPrice)} added</p>
          <p className="text-neutral-600 text-sm mt-1">It is in your ecash wallet now.</p>
          <Button className="mt-5" onClick={onClose}>Done</Button>
        </div>
      ) : !quote ? (
        <>
          {tabs}
          <p className="text-neutral-600 text-[15px] mb-3">
            Rides are paid with ecash while you ride. Add money to your ecash wallet by paying a Lightning invoice.
          </p>
          <div className="rounded-2xl bg-neutral-100 px-4 py-3">
            <AmountInput sats={sats} rate={btcPrice} min={MIN} max={MAX} onChange={setSats} label="Amount to add" />
          </div>
          {needSats > 0 && <p className="text-xs text-neutral-500 mt-2">This ride needs about {moneyText(needSats, btcPrice)} to start.</p>}
          <AutoCashWarning mint={mint} sats={Number.isFinite(sats) ? Math.round(sats) : null} />
          {error && <p className="text-red-600 text-sm mt-3" role="alert">{error}</p>}
          <div className="mt-4 space-y-2">
            <Button onClick={make} disabled={!ok || !ecash} loading={busy === "making"}>Show invoice</Button>
          </div>
          <p className="text-xs text-neutral-500 mt-4">
            The mint {mintLabel(mint)} holds the money behind your ecash. Only add what you plan to ride with.
          </p>
        </>
      ) : (
        <div className="text-center">
          <p className="text-neutral-600 text-sm mb-3">
            Pay this invoice. This screen updates by itself when the money arrives.
          </p>
          <div className="flex gap-2 justify-center mb-3 flex-wrap">
            {[["qr", "QR code"], ["string", "Invoice"], ["url", "Open wallet"]].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold ${mode === id ? "bg-black text-white" : "bg-neutral-100 text-neutral-600"}`}>{label}</button>
            ))}
          </div>
          {mode === "qr" && <div className="flex justify-center mb-3"><QRCode value={quote.invoice.toUpperCase()} size={190} /></div>}
          {mode === "string" && (
            <div className="mb-3">
              <p className="text-neutral-600 text-xs font-mono break-all bg-neutral-100 rounded-lg p-3">{quote.invoice}</p>
              <button type="button" onClick={() => navigator.clipboard?.writeText(quote.invoice)} className="text-blue-600 text-sm font-medium mt-2">Copy</button>
            </div>
          )}
          {mode === "url" && (
            <a href={`lightning:${quote.invoice}`} className="inline-flex items-center gap-1.5 bg-black text-white rounded-full px-5 py-2.5 text-sm font-semibold mb-3">
              <Icon name="zap" size={16} /> Open in Lightning wallet
            </a>
          )}
          <p className="text-neutral-500 text-xs flex items-center justify-center gap-2" role="status">
            <span className="w-3 h-3 border-2 border-neutral-300 border-t-black rounded-full animate-spin" aria-hidden="true" /> Waiting for the payment…
          </p>
          {error && <p className="text-red-600 text-sm mt-3" role="alert">{error}</p>}
          <button type="button" onClick={onClose} className="text-sm font-semibold underline mt-4">Close (a paid invoice is still collected)</button>
        </div>
      )}
    </Modal>
  );
}
