// ════════════════════════════════════════════════════════════
//  TYPICAL FARE (driver) — Each driver sets their own rates: a base
//  amount, a price per mile and a price per minute. Riders see the
//  resulting "typical fare" for their trip next to each nearby driver,
//  and in every reply. Nothing is forced: the rider still names the price
//  and the driver can accept it or counter. With no rates set, the app's
//  own rates (config/settings.js FARE_RATES) are used.
//  The form follows the SAVED rates until the driver edits it.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { FARE_RATES, RATE_LIMITS } from "../../config/settings.js";
import { normalizeRates, typicalFareUsd } from "../../lib/fare.js";
import { formatUsd } from "../../ui/SatsAmount.jsx";
import { SectionLabel } from "../../ui/Parts.jsx";

const FIELDS = [
  ["base", "Base fare", "Charged on every ride"],
  ["perMile", "Per mile", "For each mile driven"],
  ["perMinute", "Per minute", "For each minute of the trip"],
];
const inputCls = "w-full bg-white border border-neutral-300 rounded-lg py-2 pl-6 pr-2 text-black text-sm focus:outline-none focus:border-black";

const formOf = (rates) => {
  const r = normalizeRates(rates) || FARE_RATES;
  return { base: r.base.toFixed(2), perMile: r.perMile.toFixed(2), perMinute: r.perMinute.toFixed(2) };
};

export default function TypicalFareSection({ rates, onSave }) {
  const saved = normalizeRates(rates);
  const [form, setForm] = useState(() => formOf(rates));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  const savedKey = JSON.stringify(saved);
  useEffect(() => { if (!dirty) setForm(formOf(rates)); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (key, value) => {
    if (!/^\d{0,3}(\.\d{0,2})?$/.test(value)) return;
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setMsg("");
    setDone(false);
  };

  // Parsed values (null while a field is empty or out of range).
  const parsed = normalizeRates({ base: form.base === "" ? NaN : Number(form.base), perMile: form.perMile === "" ? NaN : Number(form.perMile), perMinute: form.perMinute === "" ? NaN : Number(form.perMinute) });
  const example = typicalFareUsd(parsed, 5, 15);

  const save = () => {
    if (!parsed) {
      const bad = FIELDS.filter(([k]) => form[k] === "" || !(Number(form[k]) >= 0 && Number(form[k]) <= RATE_LIMITS[k])).map(([k, label]) => `${label} (up to $${RATE_LIMITS[k]})`);
      return setMsg(`Check: ${bad.join(", ")}.`);
    }
    onSave(parsed);
    setDirty(false);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  const reset = () => { onSave(null); setForm(formOf(null)); setDirty(false); setMsg(""); };

  return (
    <section>
      <SectionLabel>Your typical fare</SectionLabel>
      <p className="text-sm text-neutral-500 mb-3">
        Set your own rates. Riders see what you would typically charge for their trip, next to your name.
        They still name their own price, and you can accept it or ask for more.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {FIELDS.map(([key, label, hint]) => (
          <label key={key} className="block">
            <span className="block text-xs font-semibold text-neutral-600 mb-1">{label}</span>
            <span className="relative block">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-500" aria-hidden="true">$</span>
              <input aria-label={`${label} in dollars`} inputMode="decimal" value={form[key]} onChange={(e) => edit(key, e.target.value)} className={inputCls} />
            </span>
            <span className="block text-[11px] text-neutral-500 mt-0.5">{hint}</span>
          </label>
        ))}
      </div>
      <p className="text-sm text-neutral-700 mt-3" role="status">
        {parsed
          ? <>A 5 mile, 15 minute trip: <span className="font-semibold">{formatUsd(example)}</span>{example === FARE_RATES.minimum && " (the minimum fare)"}.</>
          : "Enter all three rates."}
      </p>
      <p className="text-xs text-neutral-500">The minimum fare is {formatUsd(FARE_RATES.minimum)}.</p>
      {msg && <p className="text-red-600 text-xs mt-1" role="alert">{msg}</p>}
      <div className="flex items-center gap-4 mt-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty && !done}
          className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-black text-white disabled:bg-neutral-200 disabled:text-neutral-400"
        >
          {done ? "Saved" : "Save my rates"}
        </button>
        {saved && <button type="button" onClick={reset} className="text-sm font-semibold underline shrink-0">Use app rates</button>}
      </div>
      {!saved && !dirty && <p className="text-xs text-neutral-500 mt-2">You are using the app's rates.</p>}
    </section>
  );
}
