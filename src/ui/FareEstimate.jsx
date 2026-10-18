// ════════════════════════════════════════════════════════════
//  FARE ESTIMATE — How the apps show a number that is only an estimate (a ride is paid tick by tick, so the
//  road and the clock decide the real fare). The look says it before any word does: a DASHED outline, "≈" in
//  front of the amount, and muted italic text. Exact numbers (paid, fare so far) never use this look.
//
//    <EstimatedTotal baseSats trip changed terms />   the ride's estimated total, in the fare card (rider + driver)
//    <ChangeEstimate from ahead mode place terms />   what one new stop / new destination does to the fare
//    signedMoney(sats, btcPrice)                      "+$2.40" / "−$1.10" (a plain string)
// ════════════════════════════════════════════════════════════

import { formatDistance } from "../lib/units.js";
import { useApp } from "../state/AppContext.jsx";
import Money, { moneyText } from "./Money.jsx";
import { useChangeEstimate, useTotalEstimate } from "../lib/useFareEstimate.js";

export const signedMoney = (sats, btcPrice) => (sats < 0 ? "−" : sats > 0 ? "+" : "") + moneyText(Math.abs(sats), btcPrice);
const sign = (n) => (n < 0 ? "−" : "+");
const milesText = (m) => `${sign(m)}${formatDistance(Math.abs(m))}`;
const minutesText = (m) => `${sign(m)}${Math.round(Math.abs(m))} min`;

const Approx = () => <span className="text-neutral-400 mr-1" aria-hidden="true">≈</span>;

// The ride's estimated total. `trip` = { pickup, stops, dropoff } as the accepted changes leave it; `changed` = a stop or a new destination was accepted.
export function EstimatedTotal({ baseSats, trip, changed, changeKinds = [], terms, className = "" }) {
  const { btcPrice, priceFor } = useApp();
  const { sats, deltaSats } = useTotalEstimate({ baseSats, trip, changed, terms, price: terms ? priceFor(terms.currency) : null });
  if (!(sats > 0)) return null;
  const what = changeKinds.length > 1 ? "your changes" : changeKinds[0] === "destination" ? "the new destination" : "the added stop";
  return (
    <div className={`rounded-xl border border-dashed border-neutral-400 px-3 py-2 ${className}`} role="group" aria-label="Estimated total fare">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-neutral-600 italic whitespace-nowrap">Estimated total</span>
        <span className="font-bold tabular-nums text-right"><Approx /><Money sats={sats} subClassName="text-neutral-500 text-xs font-semibold max-[380px]:hidden" /></span>
      </div>
      {deltaSats ? (
        <div className="flex items-baseline justify-between gap-3 text-xs text-neutral-500 italic mt-0.5">
          <span>from {what}</span>
          <span className="tabular-nums"><Approx />{signedMoney(deltaSats, btcPrice)}</span>
        </div>
      ) : null}
    </div>
  );
}

// What one proposed change does to the fare. Shows nothing when there is no route or no price (never a made-up number).
export function ChangeEstimate({ from, ahead, mode, place, terms, className = "" }) {
  const { btcPrice, priceFor } = useApp();
  const est = useChangeEstimate({ from, ahead, mode, place, terms, price: terms ? priceFor(terms.currency) : null });
  if (est.status === "idle" || est.status === "error") return null;
  const loading = est.status === "loading";
  return (
    <div className={`rounded-2xl border-2 border-dashed border-neutral-400 px-4 py-3 text-center ${className}`} role="status" aria-label="Estimated change in fare">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Fare change</p>
      <p className={`text-2xl font-extrabold tabular-nums ${loading ? "animate-pulse text-neutral-400" : ""}`}>
        <Approx />{loading || est.sats == null ? "…" : signedMoney(est.sats, btcPrice)}
      </p>
      {!loading && Number.isFinite(est.miles) && (
        <p className="text-xs text-neutral-500 italic tabular-nums">{milesText(est.miles)} · {minutesText(est.minutes)}</p>
      )}
    </div>
  );
}
