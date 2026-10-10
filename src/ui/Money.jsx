// ════════════════════════════════════════════════════════════
//  MONEY — Shows a sats amount the way riders think about it: dollars
//  first ("$12.40") with the sats small ("12,400 sats"). When the BTC
//  price is unknown it shows sats only. Rides are priced and paid in sats.
// ════════════════════════════════════════════════════════════

import { useApp } from "../state/AppContext.jsx";
import { satsToUsd, formatUsd } from "./SatsAmount.jsx";

// Plain-text version for sentences and buttons.
export function moneyText(sats, btcUsd) {
  const usd = satsToUsd(sats, btcUsd);
  return usd != null ? formatUsd(usd) : `${Number(sats).toLocaleString()} sats`;
}

// stacked: dollars on top, sats below. inline: "$12.40 · 12,400 sats".
export default function Money({ sats, stacked = false, className = "", subClassName = "text-neutral-500 text-xs" }) {
  const { btcUsd } = useApp();
  const usd = satsToUsd(sats, btcUsd);
  const satsText = `${Number(sats).toLocaleString()} sats`;
  if (usd == null) return <span className={className}>{satsText}</span>;
  return stacked ? (
    <span className="inline-flex flex-col leading-tight">
      <span className={className}>{formatUsd(usd)}</span>
      <span className={subClassName}>{satsText}</span>
    </span>
  ) : (
    <span>
      <span className={className}>{formatUsd(usd)}</span>
      <span className={`ml-1.5 ${subClassName}`}>{satsText}</span>
    </span>
  );
}
