// ════════════════════════════════════════════════════════════
//  CASH OUT LOCATION — The user's Lightning address (name@domain),
//  saved as the standard `lud16` field of their profile. A driver cashes
//  out ecash here and a rider's tip goes here, so it's required to drive.
//  We check that the address really answers before saving it.
// ════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { resolveAddress } from "../../lib/lnurl.js";
import { FoldTitle } from "../../ui/Fold.jsx";

export default function LightningAddressSection({ value, onSave }) {
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState(""); // "", "checking", "saved", or an error
  useEffect(() => setDraft(value), [value]); // pick up a restored profile

  const save = async () => {
    const addr = draft.trim().toLowerCase();
    if (!addr) { onSave(""); setStatus("saved"); return; }
    setStatus("checking");
    try {
      await resolveAddress(addr);
      onSave(addr);
      setStatus("saved");
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setStatus(e.message || "That Lightning address doesn't work.");
    }
  };

  const error = status && !["checking", "saved"].includes(status) ? status : "";
  return (
    <div className="bg-neutral-100 rounded-xl border border-neutral-200 p-4 space-y-2">
      <FoldTitle right={!value ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Required to drive</span> : null}>Cash out location</FoldTitle>
      <p className="text-neutral-500 text-xs">Lightning address</p>
      <div className="flex gap-2">
        <input aria-label="Cash out location (Lightning address)"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setStatus(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
          placeholder="you@wallet.com"
          spellCheck={false}
          autoCapitalize="none"
          className="flex-1 min-w-0 bg-neutral-100 border border-neutral-200 rounded-lg px-3 py-2 text-black text-sm placeholder-neutral-500 focus:outline-none focus:border-black"
        />
        <button
          onClick={save}
          disabled={status === "checking" || draft.trim() === value}
          className="px-3 py-2 rounded-lg text-sm font-medium bg-black text-white disabled:bg-neutral-200 disabled:text-neutral-400"
        >
          {status === "checking" ? "Checking…" : status === "saved" ? "Saved" : "Save"}
        </button>
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}
