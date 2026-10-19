// ════════════════════════════════════════════════════════════
//  ONCHAIN FUNDS — The "On-chain" tab of Add funds. The mint gives a bitcoin address (NUT-30); the person sends bitcoin to it from any
//  wallet; once the network confirms the payment, the mint lets the app turn it into ecash. This screen checks every 15 s and shows
//  the result; if it is closed, the ecash is collected the next time the app opens (ecash.claimAll), so a payment is never lost.
//  Only some mints can do this. The app asks the mint first and says so plainly if it cannot, before anyone sends bitcoin to it.
//
//    <OnchainFunds mint="https://…" onDone={(sats) => …} />
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { mintLabel } from "../../lib/mints.js";
import QRCode from "../../ui/QRCode.jsx";
import Button from "../../ui/Button.jsx";

const POLL_MS = 15000;

export default function OnchainFunds({ mint, onDone }) {
  const { ecash } = useApp();
  const [rec, setRec] = useState(null); // { id, address, ... }
  const [state, setState] = useState("loading"); // loading | ready | unsupported | error
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!ecash) return undefined;
    setState("loading"); setError("");
    ecash.onchainStart(mint).then((r) => { if (alive.current) { setRec(r); setState("ready"); } })
      .catch((e) => { if (!alive.current) return; if (e.code === "onchain") setState("unsupported"); else { setState("error"); setError(e.message || "The mint did not answer."); } });
    return undefined;
  }, [ecash, mint]);

  const look = async () => {
    if (!rec || !ecash) return;
    setChecking(true);
    try {
      const r = await ecash.claimOnchain(rec.id);
      if (alive.current && r.sats > 0) onDone(r.sats);
    } catch { /* try again at the next check */ }
    if (alive.current) setChecking(false);
  };
  useEffect(() => {
    if (!rec) return undefined;
    const id = setInterval(look, POLL_MS);
    return () => clearInterval(id);
  }, [rec?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "loading") return <p className="text-sm text-neutral-500 text-center py-6" role="status">Asking {mintLabel(mint)} for an address…</p>;
  if (state === "unsupported") {
    return (
      <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-3" role="status">
        {mintLabel(mint)} does not take on-chain deposits. Use Lightning, or choose another mint in Wallets. Nothing was asked of you.
      </p>
    );
  }
  if (state === "error") return <p className="text-red-600 text-sm" role="alert">{error}</p>;
  return (
    <div className="text-center">
      <p className="text-neutral-600 text-sm mb-3">
        Send bitcoin to this address from any wallet. {mintLabel(mint)} turns it into ecash after the network confirms it. This can take an hour or more.
      </p>
      <div className="flex justify-center mb-3"><QRCode value={`bitcoin:${rec.address}`} size={190} /></div>
      <p className="text-neutral-600 text-xs font-mono break-all bg-neutral-100 rounded-lg p-3" aria-label="Bitcoin address">{rec.address}</p>
      <button type="button" onClick={() => { navigator.clipboard?.writeText(rec.address); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="text-blue-600 text-sm font-medium mt-2">
        {copied ? "Copied" : "Copy address"}
      </button>
      <p className="text-neutral-500 text-xs flex items-center justify-center gap-2 mt-3" role="status">
        <span className="w-3 h-3 border-2 border-neutral-300 border-t-black rounded-full animate-spin" aria-hidden="true" /> Waiting for the payment…
      </p>
      <Button variant="secondary" size="md" className="mt-3" onClick={look} loading={checking}>Check now</Button>
      <ul className="text-xs text-neutral-500 text-left mt-4 list-disc pl-4 space-y-1">
        <li>The mint sets the smallest amount and takes a fee. A very small payment may be refused or lost to the fee.</li>
        <li>You can pay this address more than once. You can close this screen: the ecash is collected the next time the app opens.</li>
        <li>On-chain payments cannot be undone. Check the address before you send.</li>
      </ul>
    </div>
  );
}
