// ════════════════════════════════════════════════════════════
//  RESTORE PANEL — Bring ecash back from a recovery phrase (a new phone, or a second device). The person types the 12 words and
//  names the mints to look in (the ones this app knows are listed already). The app asks each mint which coins it signed for the
//  phrase and still calls unspent (Cashu NUT-09), then swaps them for fresh coins (ecash.recovery.restore).
//
//  The words go nowhere but this phone's memory: the field is cleared when the search finishes, and the app sends the mint
//  only blinded numbers, never the words (see test/restore.test.mjs).
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { inputCls } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import { checkPhrase } from "../../lib/recovery.js";
import { cleanMintUrl, mintLabel } from "../../lib/mints.js";
import { DEFAULT_MINT } from "../../config/services.js";
import { moneyText } from "../../ui/Money.jsx";
import { getMyMint } from "./myMint.js";

const known = (ecash) => [...new Set([getMyMint(), DEFAULT_MINT, ...Object.keys(ecash?.state?.mints || {})])];

export default function RestorePanel({ recovery, ecash }) {
  const { btcPrice, pushNotice } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [mints, setMints] = useState(() => known(ecash));
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const check = text.trim() ? checkPhrase(text) : null;

  const addMint = () => {
    const url = cleanMintUrl(extra);
    if (!url) return setError("That is not a mint address. It must start with https://");
    setMints([...new Set([...mints, url])]);
    setExtra(""); setError("");
  };
  const run = async () => {
    setBusy(true); setError(""); setRows(null);
    try {
      const out = await recovery.restore(text, mints);
      setRows(out);
      setText(""); // the words are gone from the screen as soon as the search is over
      const sats = out.reduce((s, r) => s + r.added, 0);
      if (sats > 0) pushNotice(`Found ${moneyText(sats, btcPrice)} of ecash.`);
    } catch (e) {
      setError(e.message || "The search failed.");
    }
    setBusy(false);
  };

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold underline">Restore ecash from 12 words</button>;
  return (
    <div className="rounded-2xl border border-neutral-200 p-4 space-y-3">
      <p className="font-medium text-[15px]">Restore ecash from 12 words</p>
      <p className="text-xs text-neutral-500">Type the words you wrote down, in order. Then the app looks for your ecash at each mint below.</p>
      <textarea aria-label="Your 12 recovery words" value={text} rows={3} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        onChange={(e) => { setText(e.target.value); setError(""); setRows(null); }} placeholder="word1 word2 word3 …" className={`${inputCls} !text-sm font-mono`} />
      {check?.error && <p className="text-xs text-amber-800" role="status">{check.error}</p>}
      {check?.phrase && <p className="text-xs text-[#05683a]" role="status">These 12 words look right.</p>}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Mints to look in</p>
        <ul aria-label="Mints to look in">
          {mints.map((m) => (
            <li key={m} className="flex items-center gap-2 py-1 text-sm">
              <span className="flex-1 min-w-0 truncate">{mintLabel(m)}</span>
              <button type="button" aria-label={`Do not look in ${mintLabel(m)}`} onClick={() => setMints(mints.filter((x) => x !== m))} className="text-xs underline">Remove</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 mt-2">
          <input aria-label="Another mint address" value={extra} onChange={(e) => { setExtra(e.target.value); setError(""); }} placeholder="https://mint.example.com" spellCheck={false} className={`${inputCls} min-w-0 !text-sm`} />
          <Button size="md" full={false} className="px-4" variant="secondary" onClick={addMint} disabled={!extra.trim()}>Add</Button>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
      <Button onClick={run} loading={busy} disabled={!check?.phrase || mints.length === 0}>Look for my ecash</Button>

      {rows && (
        <ul className="text-sm space-y-1" aria-label="Results" aria-live="polite">
          {rows.map((r) => (
            <li key={r.mint} className={r.error ? "text-red-700" : "text-neutral-700"}>
              <span className="font-medium">{mintLabel(r.mint)}:</span>{" "}
              {r.error ? r.error : r.found === 0 ? "nothing found." : `found ${moneyText(r.found, btcPrice)}${r.added < r.found ? `, ${moneyText(r.added, btcPrice)} added` : ", added to your wallet"}.`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
