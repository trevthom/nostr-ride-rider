// ════════════════════════════════════════════════════════════
//  TIP SHEET — An optional tip for the driver of a COMPLETED ride. It can
//  be opened any time after the ride (from the receipt, or later from
//  Activity), so the rider never has to tip on the spot. Pick a quick
//  amount or type any amount (dollars and cents, or sats). The tip is
//  paid over Lightning straight to the driver (PayDriver), and a signed
//  payment record with phase "tip" tells the driver. A rider may tip more
//  than once.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { getProfile } from "../../nostr/profiles.js";
import { rideDriver } from "../../lib/rides.js";
import { satsFromUsd } from "../../lib/fare.js";
import { FALLBACK_BTC_USD } from "../../config/settings.js";
import { Modal } from "../../ui/Parts.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import AmountInput from "../../ui/AmountInput.jsx";
import PayDriver from "../../features/payments/PayDriver.jsx";
import Icon from "../../ui/Icon.jsx";

const QUICK_USD = [1, 2, 5, 10];
const MAX_TIP_USD = 200; // a typo guard

export default function TipSheet({ request, onClose }) {
  const { btcUsd, liveTick } = useApp();
  const { recordPayment } = useRider();
  void liveTick; // the driver's Lightning address arrives with their profile
  const driverPubkey = rideDriver(request);
  const driver = driverPubkey ? getProfile(driverPubkey) : null;
  const rate = btcUsd || FALLBACK_BTC_USD;

  const [choice, setChoice] = useState(null); // a quick amount in USD, or "other"
  const [custom, setCustom] = useState(null); // sats typed in "other"
  const [sent, setSent] = useState([]); // tips sent in this window (sats)
  const [round, setRound] = useState(0); // new PayDriver for each tip

  const min = satsFromUsd(0.25, btcUsd);
  const max = satsFromUsd(MAX_TIP_USD, btcUsd);
  const sats = choice === "other" ? custom : choice ? satsFromUsd(choice, btcUsd) : null;
  const ok = Number.isFinite(sats) && sats >= min && sats <= max;

  const paid = (proof) => {
    if (driverPubkey) recordPayment(request, driverPubkey, "tip", Math.round(sats), proof);
    setSent((s) => [...s, Math.round(sats)]);
    setChoice(null);
    setCustom(null);
    setRound((r) => r + 1);
  };

  return (
    <Modal open title="Leave a tip" onClose={onClose}>
      <p className="text-neutral-600 text-[15px] mb-3">
        A tip is optional. It goes straight to {driver?.name || "your driver"} over Lightning. You can tip now or any time later.
      </p>

      {sent.length > 0 && (
        <p className="text-[#05944f] text-sm font-medium mb-3 flex items-center gap-1.5" role="status">
          <Icon name="check" size={16} /> Tip sent: <Money sats={sent.reduce((a, b) => a + b, 0)} className="font-semibold" />. Thank you!
        </p>
      )}

      <div className="flex gap-2 flex-wrap" role="group" aria-label="Quick tip amounts">
        {QUICK_USD.map((usd) => (
          <button key={usd} type="button" aria-pressed={choice === usd} onClick={() => setChoice(usd)}
            className={`flex-1 min-w-[4.5rem] py-2.5 rounded-full text-sm font-semibold ${choice === usd ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}>
            ${usd}
          </button>
        ))}
        <button type="button" aria-pressed={choice === "other"} onClick={() => setChoice("other")}
          className={`flex-1 min-w-[4.5rem] py-2.5 rounded-full text-sm font-semibold ${choice === "other" ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}>
          Other
        </button>
      </div>

      {choice === "other" && (
        <div className="mt-4 rounded-2xl bg-neutral-100 px-4 py-3">
          <AmountInput sats={custom} rate={rate} min={min} max={max} onChange={setCustom} label="Tip amount" />
        </div>
      )}

      {ok && (
        <div className="mt-4">
          <p className="font-semibold mb-2">Tip {moneyText(Math.round(sats), btcUsd)}</p>
          <PayDriver key={`${round}-${Math.round(sats)}`} amountSats={Math.round(sats)} address={driver?.lud16} memo="NostrRide tip" onPaid={paid} />
        </div>
      )}
      <button type="button" onClick={onClose} className="w-full text-center text-sm font-semibold underline mt-4">
        {sent.length ? "Done" : "Not now"}
      </button>
    </Modal>
  );
}
