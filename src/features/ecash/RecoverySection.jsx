// ════════════════════════════════════════════════════════════
//  RECOVERY — The 12-word recovery phrase of the ecash wallet (nostr/ecashRecovery.js, lib/recovery.js), shown in
//  Account → Wallets under "Recovery phrase". The ecash is kept on this device. If the phone is lost, the 12 words bring the
//  money back on a new one (Restore my wallet, in Wallets: features/ecash/WalletStart.jsx + RestoreWallet.jsx). The words ARE
//  the money: they are shown only on request, are never sent anywhere, and the app never asks for them except on the
//  restore dialog.
//
//    <RecoveryPanel />    the Account → Wallets block: write the words down, show them again
//    <RecoveryNotice />   a short warning at the top of Account while there is ecash and the words are not written down yet
//
//  Writing down: the 12 words are shown once in a numbered list; the person then types three of them back (asked by number) before
//  the app counts the phrase as safe (ecash.recovery.confirmBackup()), which also moves any older ecash under the phrase.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { Modal, inputCls } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import { pickCheckPositions, checkAnswers } from "../../lib/recovery.js";

const EVENT = "nostrride-recovery";
const SHOW_MS = 30000; // the words hide themselves after this long

// Account → Wallets holds the phrase. A notice elsewhere in Account can send the person there and ask for the setup at
// once; if the wallet block is not on screen yet, the request waits for it (takeWantedSetup).
let wantedSetup = false;
export function startRecoverySetup() {
  wantedSetup = true;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: "setup" }));
}
const takeWantedSetup = () => { const want = wantedSetup; wantedSetup = false; return want; };

export function RecoveryNotice({ onOpen }) {
  const { ecash } = useApp();
  const rec = ecash?.recovery;
  if (!rec || rec.backedUp() || ecash.total() <= 0) return null;
  return (
    <div className="rounded-2xl bg-amber-50 text-amber-900 px-4 py-3 flex items-center gap-3" role="status">
      <Icon name="alert" size={20} />
      <p className="flex-1 text-sm font-semibold">Your ecash is not protected yet. If you lose this phone, it is gone.</p>
      <button type="button" onClick={onOpen} className="text-sm font-semibold underline shrink-0">Write down 12 words</button>
    </div>
  );
}

// The 12 words, numbered.
function Words({ phrase }) {
  return (
    <ol className="grid grid-cols-2 gap-x-4 gap-y-2 bg-neutral-100 rounded-2xl p-4 select-none" aria-label="Your 12 recovery words" onCopy={(e) => e.preventDefault()}>
      {phrase.split(" ").map((w, i) => (
        <li key={i} className="flex items-baseline gap-2">
          <span className="text-xs text-neutral-400 w-5 text-right tabular-nums">{i + 1}</span>
          <span className="font-mono font-semibold text-[15px]">{w}</span>
        </li>
      ))}
    </ol>
  );
}

function SetupModal({ recovery, onClose }) {
  const [step, setStep] = useState("write"); // write → check
  const [places] = useState(() => pickCheckPositions(3));
  const [answers, setAnswers] = useState(["", "", ""]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!checkAnswers(recovery.phrase(), places, answers)) return setError("These words do not match. Look at your paper and try again.");
    setBusy(true);
    try { await recovery.confirmBackup(); } catch { /* old coins are moved later */ }
    setBusy(false);
    onClose(true);
  };
  return (
    <Modal open title={step === "write" ? "Write down 12 words" : "Check your words"} onClose={() => onClose(false)}>
      {step === "write" ? (
        <>
          <p className="text-sm text-neutral-600 mb-3">
            Write these 12 words on paper, in this order. They bring your ecash back on a new phone.
          </p>
          <Words phrase={recovery.phrase()} />
          <ul className="text-xs text-red-700 mt-3 mb-4 space-y-1 list-disc pl-4">
            <li>Anyone who has these words can take your ecash.</li>
            <li>Do not take a photo or a screenshot. Do not save them in a note, an email or a cloud.</li>
            <li>NostrRide will never ask you for them anywhere else.</li>
          </ul>
          <Button onClick={() => setStep("check")}>I wrote them down</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-600 mb-3">Type these three words from your paper.</p>
          <div className="space-y-3">
            {places.map((p, i) => (
              <label key={p} className="block">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1 block">Word {p + 1}</span>
                <input aria-label={`Word ${p + 1}`} value={answers[i]} autoComplete="off" autoCapitalize="none" spellCheck={false}
                  onChange={(e) => { setAnswers(answers.map((a, j) => (j === i ? e.target.value : a))); setError(""); }} className={inputCls} />
              </label>
            ))}
          </div>
          {error && <p className="text-red-600 text-sm mt-3" role="alert">{error}</p>}
          <div className="mt-4 space-y-2">
            <Button onClick={confirm} loading={busy} disabled={answers.some((a) => !a.trim())}>Check and finish</Button>
            <Button variant="secondary" onClick={() => { setStep("write"); setError(""); }}>Show the words again</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function RecoveryPanel() {
  const { ecash, ecashOff, pushNotice } = useApp();
  const recovery = ecash?.recovery;
  const [setup, setSetup] = useState(takeWantedSetup);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = (e) => { if (e.detail === "setup") { wantedSetup = false; setSetup(true); } };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!shown) return undefined;
    const id = setTimeout(() => setShown(false), SHOW_MS);
    return () => clearTimeout(id);
  }, [shown]);
  if (ecashOff) return <p className="text-sm text-neutral-500" role="status">This phone has no ecash wallet. Create or restore one in Wallets; then its 12 words are shown here.</p>;
  if (!recovery) return <p className="text-sm text-neutral-500" role="status">Loading your wallet…</p>;

  const safe = recovery.backedUp();
  return (
    <>
      <p className="text-sm text-neutral-500 mb-3">
        Your ecash is saved on this device. If you lose the phone, 12 words on paper bring it back on a new one.
      </p>
      {recovery.volatile() && (
        <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2 mb-3" role="alert">
          This browser cannot save data, so nothing can be recovered. Do not add ecash here.
        </p>
      )}
      {safe ? (
        <div className="flex items-center gap-2 text-sm font-semibold text-[#05683a] bg-[#e6f4ec] rounded-xl px-3 py-2 mb-3" role="status">
          <Icon name="check" size={18} /> You wrote down your 12 words.
        </div>
      ) : (
        <Button onClick={() => setSetup(true)} className="mb-3">Write down 12 words</Button>
      )}
      {safe && (
        <div className="space-y-2 mb-3">
          {shown ? (
            <div>
              <Words phrase={recovery.phrase()} />
              <p className="text-xs text-neutral-500 mt-2">These hide again in 30 seconds. Keep them secret.</p>
              <button type="button" onClick={() => setShown(false)} className="text-sm font-semibold underline mt-1">Hide</button>
            </div>
          ) : (
            <Button variant="secondary" size="md" onClick={() => setShown(true)}>Show my 12 words</Button>
          )}
        </div>
      )}

      {setup && <SetupModal recovery={recovery} onClose={(done) => { setSetup(false); if (done) pushNotice("Your ecash is protected. Keep the paper safe."); }} />}
    </>
  );
}
