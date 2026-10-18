// ════════════════════════════════════════════════════════════
//  FARE BREAKDOWN — The "Paid so far" lines next to the fare, in both apps: the base rate, the miles and the minutes
//  paid until now, so the total can be followed all through the ride.
//
//      Paid so far:
//      Base rate: $1.50
//      Miles: 3 ($3.30)
//      Minutes: 7 ($1.40)
//
//  `ledger` is the ride's saved ledger (lib/ridemoney.js) and `paidSats` what the driver confirmed (lib/ticks.js paidBreakdown
//  splits it by kind). Once the ride is over, a fifth line "End of ride:" shows the settled part of the last mile and minute.
// ════════════════════════════════════════════════════════════

import { formatDistance, getUnits } from "../lib/units.js";
import { useApp } from "../state/AppContext.jsx";
import { paidBreakdown } from "../lib/ticks.js";
import { moneyText } from "./Money.jsx";

export default function FareBreakdown({ ledger, paidSats, className = "" }) {
  const { btcPrice } = useApp();
  if (!ledger) return null;
  const b = paidBreakdown(ledger, paidSats);
  const units = getUnits();
  const m = (sats) => moneyText(sats, btcPrice);
  const row = "flex justify-between gap-3";
  return (
    <div className={`text-sm ${className}`} role="group" aria-label="Paid so far">
      <p className="font-semibold">Paid so far:</p>
      <dl className="mt-1 space-y-0.5 tabular-nums">
        <div className={row}><dt className="text-neutral-600">Base rate:</dt><dd>{m(b.base)}</dd></div>
        <div className={row}><dt className="text-neutral-600">{units === "km" ? "Distance:" : "Miles:"}</dt><dd>{units === "km" ? formatDistance(b.miles.n) : b.miles.n} ({m(b.miles.sats)})</dd></div>
        <div className={row}><dt className="text-neutral-600">Minutes:</dt><dd>{b.minutes.n} ({m(b.minutes.sats)})</dd></div>
        {b.end > 0 && <div className={row}><dt className="text-neutral-600">End of ride:</dt><dd>{m(b.end)}</dd></div>}
      </dl>
    </div>
  );
}
