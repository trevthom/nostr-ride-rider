// ════════════════════════════════════════════════════════════
//  AUTO CASH WARNING — Shown in Add funds when "Automatically cash out at" is on and the money about to arrive would reach that amount.
//  Without it a person who adds $2 with the limit at $1 finds the $2 sent to their Lightning address the moment it lands. The warning says
//  so BEFORE the invoice is made, and offers to turn the automatic cash out off right there. `sats` = the amount being added (null when it is
//  not known yet, as on the On-chain tab: the warning then shows whenever the setting is on).
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { getAutoCashOut, setAutoCashOut, autoThresholdSats } from "../../lib/autocashout.js";
import { getCashOutTo } from "../../lib/cashoutto.js";
import { formatFiat } from "../../lib/currency.js";
import { AUTO_EVENT } from "../ecash/useAutoCashOut.js";
import Button from "../../ui/Button.jsx";

export default function AutoCashWarning({ mint, sats = null }) {
  const { user, ecash, priceFor } = useApp();
  const [off, setOff] = useState(false);
  const choice = getAutoCashOut(user.publicKey);
  const to = getCashOutTo(user.publicKey);
  if (!choice || !to || off) return null;
  const need = autoThresholdSats(choice, priceFor(choice.code));
  if (need == null) return null;
  const held = ecash && mint ? ecash.balance(mint) : 0;
  if (sats != null && held + sats < need) return null;
  const turnOff = () => {
    setAutoCashOut(user.publicKey, 0, choice.code);
    window.dispatchEvent(new Event(AUTO_EVENT));
    setOff(true);
  };
  return (
    <div className="mt-3 rounded-xl bg-amber-50 text-amber-900 px-3 py-2" role="alert">
      <p className="text-sm font-semibold">Automatic cash out is on at {formatFiat(choice.amount, choice.code)}.</p>
      <p className="text-xs mt-0.5">
        {sats != null ? "With this amount your ecash reaches that limit, so all of it" : "Once your ecash reaches that limit, all of it"} is sent to {to} as soon as it arrives. Turn it off first if you want to keep this money in your wallet.
      </p>
      <Button size="md" variant="secondary" className="mt-2" onClick={turnOff}>Turn off automatic cash out</Button>
    </div>
  );
}
