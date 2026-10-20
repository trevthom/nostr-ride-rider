// ════════════════════════════════════════════════════════════
//  AUTO CASH OUT FIELD — "Automatically cash out at: $ [ ]" (Account → Wallets, in the Ride and the Drive face).
//  The person types an amount. When the ecash reaches it, the app sends it all to the cash out address PINNED on this device
//  (lib/cashoutto.js) by itself (useAutoCashOut.js). Empty = off. The choice is saved when the field is left or Enter is pressed (NOT on every key:
//  typing "15" must never cash out at "1"). Needs a confirmed cash out location.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { CURRENCIES, digitsOf } from "../../lib/currency.js";
import { satsFromFiat } from "../../lib/currency.js";
import { getAutoCashOut, setAutoCashOut, AUTO_MAX } from "../../lib/autocashout.js";
import { AUTO_EVENT } from "./useAutoCashOut.js";
import { inputCls } from "../../ui/Parts.jsx";
import { IS_DRIVER_APP } from "../../config/app.js";
import { useCashOutTo } from "./useCashOutTo.js";

export default function AutoCashOutField() {
  const { user, currency, priceFor } = useApp();
  const { pinned, state } = useCashOutTo();
  const ready = state === "ok" && !!pinned;
  const saved = getAutoCashOut(user.publicKey);
  const code = saved?.code || currency;
  const digits = digitsOf(code);
  const [text, setText] = useState(saved ? String(saved.amount) : "");
  const [note, setNote] = useState("");
  const price = priceFor(code);
  const amount = Number(text);
  const okAmount = text.trim() === "" || (amount > 0 && amount <= AUTO_MAX);

  const commit = () => {
    if (!okAmount) return setNote(`Enter an amount between 0 and ${AUTO_MAX.toLocaleString()}, or leave it empty to turn this off.`);
    setAutoCashOut(user.publicKey, text.trim() === "" ? 0 : amount, code);
    setNote(text.trim() === "" ? "Automatic cash out is off." : "Saved.");
    window.dispatchEvent(new Event(AUTO_EVENT));
  };

  return (
    <div className="mt-4">
      <label className="flex items-center gap-2 font-medium text-[15px]">
        <span className="shrink-0">Automatically cash out at: {CURRENCIES[code].symbol}</span>
        <input
          aria-label="Automatically cash out at"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          disabled={!ready}
          placeholder="Off"
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, "");
            if (new RegExp(`^\\d{0,7}${digits ? `(\\.\\d{0,${digits}})?` : ""}$`).test(v)) { setText(v); setNote(""); }
          }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
          className={`${inputCls} min-w-0 !text-sm`}
        />
      </label>
      <p className="text-xs text-neutral-500 mt-1">
        {ready
          ? `When your ecash reaches this amount, the app sends all of it to ${pinned}.${IS_DRIVER_APP ? "" : " Add funds again before your next ride."} Leave it empty to turn this off.`
          : state === "changed" || state === "unconfirmed"
            ? "Confirm your cash out location below first. Automatic cash out waits until you do."
            : "Set a cash out location (a Lightning address) first."}
        {ready && saved && price ? ` That is about ${satsFromFiat(saved.amount, price).toLocaleString()} sats.` : ""}
      </p>
      {note && <p className="text-xs text-neutral-700 mt-1" role="status">{note}</p>}
    </div>
  );
}
