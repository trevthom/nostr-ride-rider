// ════════════════════════════════════════════════════════════
//  FARE TERMS (rider) — What a driver's reply means in money, in plain
//  words: the driver's standard fare (base + per mile + per minute, in the
//  driver's own currency, paid tick by tick). Also the mint
//  the driver is paid at. Used on the driver list and on the confirm screen.
// ════════════════════════════════════════════════════════════

import { ratePerUnit, unitName } from "../../lib/units.js";
import { normalizeRates } from "../../lib/fare.js";
import { formatFiat } from "../../lib/currency.js";
import { mintLabel } from "../../lib/mints.js";

export function offerRates(c) {
  return normalizeRates(c?.rates);
}

export const RatesLine = ({ rates }) =>
  rates ? (
    <span>
      {formatFiat(rates.base, rates.currency)} base · {formatFiat(ratePerUnit(rates.perMile), rates.currency)}/{unitName()} · {formatFiat(rates.perMinute, rates.currency)}/min
    </span>
  ) : null;

export default function FareTerms({ offer, className = "" }) {
  const rates = offerRates(offer);
  if (!rates) return <p className={`text-xs text-amber-700 ${className}`}>This driver's reply has no rates, so it cannot be paid tick by tick.</p>;
  return (
    <div className={`text-xs text-neutral-600 ${className}`}>
      <p>
        <span className="font-semibold text-neutral-800">Standard fare</span>: you pay <RatesLine rates={rates} />, as the ride runs.
      </p>
      {offer.mint && <p className="mt-0.5">Paid in ecash at {mintLabel(offer.mint)}.</p>}
    </div>
  );
}
