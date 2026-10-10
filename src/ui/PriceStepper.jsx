// ════════════════════════════════════════════════════════════
//  PRICE STEPPER — "−  $12  +" for naming a price in whole dollars.
//  The rider uses it for the offer, a driver for a counter-offer.
//  The buttons move one step (OFFER_STEP_USD). A typed number is kept
//  inside the limits (lib/fare.js offerLimits) when the field loses focus.
//    usd            current price (number)
//    suggestedUsd   the app's suggestion (sets the limits)
//    onChange(usd)  called with a valid price
//    min            raise the lower limit (a counter must beat the offer)
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { clampOffer, offerLimits, stepOffer } from "../lib/fare.js";
import Icon from "./Icon.jsx";

export default function PriceStepper({ usd, suggestedUsd, onChange, label = "Price", min }) {
  const limits = offerLimits(suggestedUsd);
  const low = Math.max(limits.min, min ?? 0);
  const [draft, setDraft] = useState(null); // what the user is typing (null: show the price)

  const move = (dir) => onChange(Math.max(low, stepOffer(usd, dir, suggestedUsd)));
  const commit = () => {
    if (draft === null) return;
    const next = Math.max(low, clampOffer(draft, suggestedUsd));
    setDraft(null);
    if (next !== usd) onChange(next);
  };
  const btn = "w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center active:bg-neutral-200 disabled:opacity-30";

  return (
    <div className="flex items-center justify-center gap-5" role="group" aria-label="Adjust price">
      <button type="button" className={btn} onClick={() => move(-1)} disabled={usd <= low} aria-label="Lower the price">
        <Icon name="minus" size={22} />
      </button>
      <label className="flex items-baseline text-4xl font-extrabold tracking-tight">
        <span aria-hidden="true">$</span>
        <input
          aria-label={label}
          inputMode="numeric"
          value={draft ?? String(usd)}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
          style={{ width: `${Math.max(2, (draft ?? String(usd)).length) + 0.4}ch` }}
          className="bg-transparent text-center focus:outline-none"
        />
      </label>
      <button type="button" className={btn} onClick={() => move(1)} disabled={usd >= limits.max} aria-label="Raise the price">
        <Icon name="plus" size={22} />
      </button>
    </div>
  );
}
