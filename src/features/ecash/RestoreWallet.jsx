// ════════════════════════════════════════════════════════════
//  RESTORE WALLET — A dialog that brings back an ecash wallet the person already has (a new phone, or a phone that was wiped). It is offered
//  only when this device has NO wallet (WalletStart.jsx): the person types the 12 words they wrote down and names the mints to look in
//  (the ones this app knows are listed already). The words BECOME this device's wallet words: nothing is swept into another phrase. The
//  app asks each mint which coins it signed for the words and still calls unspent (Cashu NUT-09), then swaps them for fresh coins, so a copy
//  on an old phone is worth nothing (nostr/cashuMint.js restoreWallet).
//
//  If no mint knows any coin for the words (a typo that still passes the check, the wrong mint, a mint that did not answer), nothing is
//  kept and the person can try again. The words go nowhere but this phone's memory: the field is cleared when the search finishes, and the
//  app sends the mint only blinded numbers, never the words (see test/restore.test.mjs).
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { Modal, inputCls } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import { checkPhrase } from "../../lib/recovery.js";
import { cleanMintUrl, mintLabel } from "../../lib/mints.js";
import { DEFAULT_MINT } from "../../config/services.js";
import { moneyText } from "../../ui/Money.jsx";
import { getMyMint } from "./myMint.js";

const known = () => [...new Set([getMyMint(), DEFAULT_MINT].filter(Boolean))];

export default function RestoreWallet({ onClose }) {
  const { btcPrice, pushNotice, restoreEcash } = useApp();
  const [text, setText] = useState("");
  const [mints, setMints] = useState(known);
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
      const out = await restoreEcash(text, mints);
      if (out.kept) {
        setText(""); // the words are gone from the screen as soon as the wallet is back
        pushNotice(`Your wallet is back: ${moneyText(out.rows.reduce((s, r) => s + r.added, 0), btcPrice)}.`);
        onClose();
        return;
      }
      setRows(out.rows);
      const failed = out.rows.some((r) => r.error);
      setError(failed
        ? "A mint did not answer, so nothing was restored. Check the connection and try again."
        : "No mint has ecash for these words. Check the words, and add the mint where you added funds.");
    } catch (e) {
      setError(e.message || "The search failed.");
    }
    setBusy(false);
  };
  const close = () => { if (!busy) onClose(); };

  return (
    <Modal open title="Restore my wallet" onClose={close}>
      <p className="text-sm text-neutral-600 mb-3">
        Type the 12 words you wrote down, in order. The app looks for your ecash at each mint below and brings it to this phone.
        These words become this phone's wallet words. If another phone still holds this wallet, it loses its coins: this phone takes over.
      </p>
      <textarea aria-label="Your 12 recovery words" value={text} rows={3} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        onChange={(e) => { setText(e.target.value); setError(""); setRows(null); }} placeholder="word1 word2 word3 …" className={`${inputCls} !text-sm font-mono`} />
      {check?.error && <p className="text-xs text-amber-800 mt-1" role="status">{check.error}</p>}
      {check?.phrase && <p className="text-xs text-[#05683a] mt-1" role="status">These 12 words look right.</p>}

      <div className="mt-3">
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

      {error && <p className="text-red-600 text-sm mt-3" role="alert">{error}</p>}
      {rows && (
        <ul className="text-sm space-y-1 mt-2" aria-label="Results" aria-live="polite">
          {rows.map((r) => (
            <li key={r.mint} className={r.error ? "text-red-700" : "text-neutral-700"}>
              <span className="font-medium">{mintLabel(r.mint)}:</span> {r.error ? r.error : "nothing found."}
            </li>
          ))}
        </ul>
      )}
      <Button className="mt-4" onClick={run} loading={busy} disabled={!check?.phrase || mints.length === 0}>Look for my ecash</Button>
    </Modal>
  );
}
