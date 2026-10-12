// ════════════════════════════════════════════════════════════
//  SATS AMOUNT — Shows an amount in sats with an estimate in the person's
//  local currency next to it (when the BTC price is known). 1 sat = 0.00000001 BTC.
//  The currency is chosen in Account (lib/currency.js).
// ════════════════════════════════════════════════════════════

import { useApp } from "../state/AppContext.jsx";
import { formatFiat } from "../lib/currency.js";

export { formatFiat };

// The value of `sats` in the local currency at `btcPrice` (that currency per BTC); null when the price is unknown.
export function satsToFiat(sats, btcPrice) {
  if (!btcPrice || sats == null) return null;
  return sats * 1e-8 * btcPrice;
}

// Inline sats + (~local currency). `className` styles the sats text.
export default function SatsAmount({ sats, className = "", fiatClassName = "text-neutral-500" }) {
  const { btcPrice } = useApp();
  const fiat = satsToFiat(sats, btcPrice);
  return (
    <span>
      <span className={className}>{Number(sats).toLocaleString()} sats</span>
      {fiat != null && <span className={`ml-1 ${fiatClassName}`}>(~{formatFiat(fiat)})</span>}
    </span>
  );
}
