// ════════════════════════════════════════════════════════════
//  AUTO CASH OUT FIELD — "Automatically cash out at: $ [ ]" (driver app, Account → Wallets).
//  The driver types an amount. When the ecash reaches it, the app cashes out to the cash out location by itself
//  (useAutoCashOut.js). Empty = off. The choice is saved when the field is left or Enter is pressed (NOT on every key:
//  typing "15" must never cash out at "1"). Needs a cash out location.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { CURRENCIES, digitsOf } from "../../lib/currency.js";
import { satsFromFiat } from "../../lib/currency.js";
import { getAutoCashOut, setAutoCashOut, AUTO_MAX } from "../../lib/autocashout.js";
import { AUTO_EVENT } from "./useAutoCashOut.js";
import { inputCls } from "../../ui/Parts.jsx";

export default function AutoCashOutField() {
  const { user, currency, priceFor } = useApp();
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
          disabled={!user.lud16}
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
        {!user.lud16
          ? "Set a cash out location (a Lightning address) first."
          : "When your ecash reaches this amount, the app sends it to your cash out location. Leave it empty to turn this off."}
        {user.lud16 && saved && price ? ` That is about ${satsFromFiat(saved.amount, price).toLocaleString()} sats.` : ""}
      </p>
      {note && <p className="text-xs text-neutral-700 mt-1" role="status">{note}</p>}
    </div>
  );
}
