// ════════════════════════════════════════════════════════════
//  YOUR RATES (driver) — Each driver sets their own rates, in their local currency (chosen in Account):
//  a base rate (paid when the ride starts), a price per mile and a price per minute. A ride is paid tick
//  by tick at these rates. Riders see the resulting fare for their trip next to each nearby driver and in
//  every reply.
//  With no rates set, the app's own rates (config/settings.js FARE_RATES) are used.
//  The rates are copied into each offer and are frozen once the rider chooses the driver: they cannot
//  be changed while a ride is running (`locked`).
//  The form follows the SAVED rates until the driver edits it.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { RATE_LIMITS } from "../../config/settings.js";
import { useApp } from "../../state/AppContext.jsx";
import { APP_RATES, normalizeRates, typicalFare } from "../../lib/fare.js";
import { CURRENCIES, formatFiat } from "../../lib/currency.js";
import { SectionLabel } from "../../ui/Parts.jsx";
import { getUnits, ratePerUnit, perMileFrom, formatDistance } from "../../lib/units.js";

// The distance rate is typed and shown per mile or per kilometer (Account → Units); it is saved per mile.
const fields = () => [
  ["base", "Base fare", "Charged on every ride"],
  getUnits() === "km" ? ["perMile", "Per kilometer", "For each kilometer driven"] : ["perMile", "Per mile", "For each mile driven"],
  ["perMinute", "Per minute", "For each minute of the trip"],
];
const inputCls = "w-full bg-white border border-neutral-300 rounded-lg py-2 pl-6 pr-2 text-black text-sm focus:outline-none focus:border-black";

const formOf = (rates) => {
  const r = normalizeRates(rates) || APP_RATES;
  return { base: r.base.toFixed(2), perMile: ratePerUnit(r.perMile).toFixed(2), perMinute: r.perMinute.toFixed(2) };
};

export default function TypicalFareSection({ rates, onSave, locked = false }) {
  const { currency } = useApp();
  const FIELDS = fields();
  const saved = normalizeRates(rates);
  const symbol = CURRENCIES[currency].symbol;
  const scale = CURRENCIES[currency].scale;
  const [form, setForm] = useState(() => formOf(rates));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  const savedKey = JSON.stringify(saved);
  useEffect(() => { if (!dirty) setForm(formOf(rates)); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (key, value) => {
    if (locked || !/^\d{0,6}(\.\d{0,2})?$/.test(value)) return;
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setMsg("");
    setDone(false);
  };

  // Parsed values (null while a field is empty or out of range).
  const parsed = normalizeRates({ base: form.base === "" ? NaN : Number(form.base), perMile: form.perMile === "" ? NaN : Math.round(perMileFrom(Number(form.perMile)) * 100) / 100, perMinute: form.perMinute === "" ? NaN : Number(form.perMinute), currency });
  const example = parsed ? typicalFare(parsed, 5, 15) : 0;

  const save = () => {
    if (!parsed) {
      const bad = FIELDS.filter(([k]) => form[k] === "" || !(Number(form[k]) >= 0 && Number(form[k]) <= RATE_LIMITS[k] * scale)).map(([k, label]) => `${label} (up to ${formatFiat(RATE_LIMITS[k] * scale, currency)})`);
      return setMsg(`Check: ${bad.join(", ")}.`);
    }
    if (locked) return;
    onSave(parsed);
    setDirty(false);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  const reset = () => { if (locked) return; onSave(null); setForm(formOf(null)); setDirty(false); setMsg(""); };

  return (
    <section>
      <SectionLabel>Your rates</SectionLabel>
      <p className="text-sm text-neutral-500 mb-3">
        Riders see what you would charge for their trip, next to your name.
      </p>
      {locked && <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2 mb-3" role="status">Your rates are frozen while a ride is running. You can change them when it ends.</p>}
      {saved && saved.currency !== currency && <p className="text-xs text-amber-700 mb-2" role="status">Your saved rates are in {saved.currency}. Save to use {currency} instead.</p>}
      <div className="grid grid-cols-3 gap-2">
        {FIELDS.map(([key, label, hint]) => (
          <label key={key} className="block">
            <span className="block text-xs font-semibold text-neutral-600 mb-1">{label}</span>
            <span className="relative block">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-500" aria-hidden="true">{symbol}</span>
              <input aria-label={`${label} in ${currency}`} inputMode="decimal" value={form[key]} disabled={locked} onChange={(e) => edit(key, e.target.value)} className={inputCls} />
            </span>
            <span className="block text-[11px] text-neutral-500 mt-0.5">{hint}</span>
          </label>
        ))}
      </div>
      <p className="text-sm text-neutral-700 mt-3" role="status">
        {parsed
          ? <>A {formatDistance(5, { digits: 0 })}, 15 minute trip: <span className="font-semibold">{formatFiat(example, currency)}</span>.</>
          : "Enter all three rates."}
      </p>
      {msg && <p className="text-red-600 text-xs mt-1" role="alert">{msg}</p>}
      <div className="flex items-center gap-4 mt-3">
        <button
          type="button"
          onClick={save}
          disabled={locked || (!dirty && !done)}
          className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-black text-white disabled:bg-neutral-200 disabled:text-neutral-400"
        >
          {done ? "Saved" : "Save my rates"}
        </button>
        {saved && <button type="button" onClick={reset} disabled={locked} className="text-sm font-semibold underline shrink-0 disabled:text-neutral-400">Use app rates</button>}
      </div>
      {!saved && !dirty && <p className="text-xs text-neutral-500 mt-2">You are using the app's rates.</p>}
    </section>
  );
}
