// ════════════════════════════════════════════════════════════
//  CURRENCY CHOICE — Two big buttons: Bitcoin or US dollars. Used for the Strike choices:
//    rider:  "Pay with" — which Strike balance pays (the other one is converted by Strike)
//    driver: "Cash out arrives as" — what Strike keeps the money as
//  `balances` (optional) = { BTC, USD } from Strike: shown under each name.
//
//    <CurrencyChoice value="USD" onChange={…} label="Pay with" balances={…} notes={{ BTC: "…", USD: "…" }} />
// ════════════════════════════════════════════════════════════

import { balanceText } from "../../lib/strike.js";

const NAMES = { BTC: "Bitcoin", USD: "US dollars" };

export default function CurrencyChoice({ value, onChange, label, balances = null, notes = {}, disabled = false }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2">
      {["BTC", "USD"].map((code) => {
        const on = value === code;
        const bal = balances && balances[code] != null ? balanceText(code, balances[code]) : "";
        return (
          <button key={code} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(code)}
            className={`text-left rounded-2xl px-4 py-3 border-2 transition ${on ? "border-black bg-white" : "border-neutral-200 bg-white"} disabled:opacity-50`}>
            <span className="block font-semibold text-[15px]">{NAMES[code]}</span>
            {bal && <span className="block text-xs text-neutral-500 tabular-nums">{bal}</span>}
            {notes[code] && <span className="block text-xs text-neutral-500 mt-0.5">{notes[code]}</span>}
          </button>
        );
      })}
    </div>
  );
}
