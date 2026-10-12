// ════════════════════════════════════════════════════════════
//  AMOUNT INPUT — Type an exact amount, like a Bitcoin wallet does:
//  dollars and cents, or sats. The arrows button (up/down) switches the
//  unit. Whatever you type, the other unit shows below in smaller text
//  ("$6.37" → "≈ 6,370 sats", "6370 sats" → "≈ $6.37").
//  The rider's offer, a new offer and a driver's counter-offer use it.
//
//    sats          the amount in sats (number), or null while the field is empty
//    onChange(n)   n = sats, or null when the field is empty / not a number
//    rate          the BTC price in the local currency (null while unknown)
//    min, max      allowed range in sats; outside it a message shows (the parent
//                  should also stop the user from sending)
//    minMessage    replaces the "lowest" message (for example "Must be more than the offer")
//  The unit you pick is remembered on this device.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { satsFromFiat, fiatFromSats, formatFiat, digitsOf, getCurrency, CURRENCIES } from "../lib/currency.js";
import { getSetting, setSetting } from "../config/relays.js";
import Icon from "./Icon.jsx";

const SATS_RE = /^\d{0,10}$/;
const fiatRe = (digits) => new RegExp(`^\\d{0,7}${digits ? `(\\.\\d{0,${digits}})?` : ""}$`); // whole units and at most the currency's decimals

export default function AmountInput({ sats, onChange, rate, min, max, label = "Amount", minMessage }) {
  const code = getCurrency();
  const digits = digitsOf(code);
  const [pref, setUnit] = useState(() => (getSetting("amountUnit", "fiat") === "sats" ? "sats" : "fiat"));
  const unit = rate ? pref : "sats"; // no price: sats only
  const [draft, setDraft] = useState(null); // what the user is typing (null: show the amount)

  const shown = sats == null ? "" : unit === "fiat" ? fiatFromSats(sats, rate, code).toFixed(digits) : String(sats);
  const text = draft ?? shown;

  const type = (value) => {
    const v = value.replace(/[^0-9.]/g, "");
    if (!(unit === "fiat" ? fiatRe(digits) : SATS_RE).test(v)) return; // ignore a keystroke that cannot be an amount
    setDraft(v);
    const n = Number(v);
    if (v === "" || v === "." || !Number.isFinite(n) || n <= 0) return onChange(null);
    onChange(unit === "fiat" ? Math.max(1, satsFromFiat(n, rate)) : Math.round(n));
  };
  const swap = () => {
    const next = unit === "fiat" ? "sats" : "fiat";
    setUnit(next);
    setDraft(null);
    setSetting("amountUnit", next);
  };

  const low = sats != null && min != null && sats < min;
  const high = sats != null && max != null && sats > max;
  const problem = low
    ? minMessage || `The lowest amount is ${rate ? formatFiat(fiatFromSats(min, rate, code)) + " " : ""}(${min.toLocaleString()} sats).`
    : high
    ? `The highest amount is ${rate ? formatFiat(fiatFromSats(max, rate, code)) + " " : ""}(${max.toLocaleString()} sats).`
    : sats == null && draft !== null
    ? "Enter an amount."
    : "";

  return (
    <div>
      <div className="flex items-center justify-center gap-3">
        <label className="flex items-baseline justify-center gap-1.5 text-4xl font-extrabold tracking-tight min-w-0">
          {unit === "fiat" && <span aria-hidden="true">{CURRENCIES[code].symbol}</span>}
          <input
            aria-label={label}
            inputMode="decimal"
            autoComplete="off"
            value={text}
            placeholder={unit === "fiat" && digits ? "0." + "0".repeat(digits) : "0"}
            onChange={(e) => type(e.target.value)}
            onBlur={() => setDraft(null)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
            style={{ width: `${Math.max(3, text.length || 3) + 0.6}ch` }}
            className="bg-transparent text-center focus:outline-none placeholder-neutral-300 max-w-[12ch]"
          />
          {unit === "sats" && <span className="text-xl font-bold text-neutral-500" aria-hidden="true">sats</span>}
        </label>
        {rate && <button
          type="button"
          onClick={swap}
          aria-label={unit === "fiat" ? "Switch to sats" : `Switch to ${code}`}
          className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center active:bg-neutral-200 shrink-0"
        >
          <Icon name="swap" size={20} />
        </button>}
      </div>
      <p className="text-center text-sm text-neutral-500 mt-1" aria-live="polite">
        {sats == null || !rate ? " " : unit === "fiat" ? `≈ ${sats.toLocaleString()} sats` : `≈ ${formatFiat(fiatFromSats(sats, rate, code))}`}
      </p>
      {problem && <p className="text-center text-xs text-red-600 mt-1" role="alert">{problem}</p>}
    </div>
  );
}
