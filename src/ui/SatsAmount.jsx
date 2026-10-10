// ════════════════════════════════════════════════════════════
//  SATS AMOUNT — Shows an amount in sats with a USD estimate next to
//  it (when the BTC price is known). 1 sat = 0.00000001 BTC.
// ════════════════════════════════════════════════════════════

import { useApp } from "../state/AppContext.jsx";

export function satsToUsd(sats, btcUsd) {
  if (!btcUsd || sats == null) return null;
  return sats * 1e-8 * btcUsd;
}

export function formatUsd(usd) {
  if (usd == null) return "";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return "$" + usd.toFixed(2);
}

// Inline sats + (~$USD). `className` styles the sats text.
export default function SatsAmount({ sats, className = "", usdClassName = "text-neutral-500" }) {
  const { btcUsd } = useApp();
  const usd = satsToUsd(sats, btcUsd);
  return (
    <span>
      <span className={className}>{Number(sats).toLocaleString()} sats</span>
      {usd != null && <span className={`ml-1 ${usdClassName}`}>(~{formatUsd(usd)})</span>}
    </span>
  );
}
