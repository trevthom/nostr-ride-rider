// ════════════════════════════════════════════════════════════
//  TRIP METER — Time and distance as the trip goes on, the same on the rider's
//  and the driver's screen (lib/meter.js decides which distance to believe).
//    <TripMeter view={meterView(...)} />   a card inside the trip sheet ("Trip so far" counts the seconds: 1.1 mi · 5 min 03 s)
//    peekMeter(view)                        one short line for the collapsed sheet
//  Changing the pickup does not reset these numbers.
// ════════════════════════════════════════════════════════════

import { fmtClock, fmtDuration, fmtDurationSec, fmtMiles } from "../lib/meter.js";

const leg = (l) => `${fmtMiles(l.miles)} · ${fmtDuration(l.ms)}`;
const tripLeg = (l) => `${fmtMiles(l.miles)} · ${fmtDurationSec(l.ms)}`; // the ride itself counts the seconds

export function peekMeter(view) {
  if (!view) return "";
  if (view.phase === "riding" && view.trip) return tripLeg(view.trip);
  if (view.phase === "arrived") return `Waiting ${fmtClock(view.waitMs)}`;
  return view.pickup.miles != null || view.pickup.ms != null ? leg(view.pickup) : "";
}

export default function TripMeter({ view, className = "" }) {
  if (!view) return null;
  const { phase, pickup, trip, waitMs } = view;
  const main =
    phase === "riding" && trip ? { label: "Trip so far", value: tripLeg(trip) }
    : phase === "arrived" ? { label: "Waiting at the pickup", value: fmtClock(waitMs) }
    : { label: "Drive to the pickup", value: leg(pickup) };
  return (
    <div className={`rounded-2xl bg-neutral-100 px-4 py-3 ${className}`} role="group" aria-label="Trip meter">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{main.label}</p>
      <p className="text-2xl max-[380px]:text-xl font-extrabold tracking-tight tabular-nums" aria-live="off">{main.value}</p>
      {phase !== "enroute" && (
        <p className="text-xs text-neutral-500 mt-0.5">
          Drive to the pickup: {leg(pickup)}
          {phase === "riding" && waitMs >= 60000 ? ` · waited ${fmtClock(waitMs)}` : ""}
        </p>
      )}
    </div>
  );
}
