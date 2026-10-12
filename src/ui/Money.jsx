// ════════════════════════════════════════════════════════════
//  MONEY — Shows a sats amount the way riders think about it: local money
//  first ("$12.40", "€11,80") with the sats small ("12,400 sats"). When the BTC
//  price is unknown it shows sats only. Rides are priced and paid in sats.
// ════════════════════════════════════════════════════════════

import { useApp } from "../state/AppContext.jsx";
import { satsToFiat, formatFiat } from "./SatsAmount.jsx";

// Plain-text version for sentences and buttons.
export function moneyText(sats, btcPrice) {
  const usd = satsToFiat(sats, btcPrice);
  return usd != null ? formatFiat(usd) : `${Number(sats).toLocaleString()} sats`;
}

// stacked: dollars on top, sats below. inline: "$12.40 · 12,400 sats".
export default function Money({ sats, stacked = false, className = "", subClassName = "text-neutral-500 text-xs" }) {
  const { btcPrice } = useApp();
  const usd = satsToFiat(sats, btcPrice);
  const satsText = `${Number(sats).toLocaleString()} sats`;
  if (usd == null) return <span className={className}>{satsText}</span>;
  return stacked ? (
    <span className="inline-flex flex-col leading-tight">
      <span className={className}>{formatFiat(usd)}</span>
      <span className={subClassName}>{satsText}</span>
    </span>
  ) : (
    <span>
      <span className={className}>{formatFiat(usd)}</span>
      <span className={`ml-1.5 ${subClassName}`}>{satsText}</span>
    </span>
  );
}
