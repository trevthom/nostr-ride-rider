// ════════════════════════════════════════════════════════════
//  AUTH STEPS — Two small steps used by AuthScreen:
//    • UnlockView — a key saved on this device: enter the password.
//    • BackupStep — after "Create account": show the new secret key
//      and make the user confirm they saved it (it can't be reset).
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { shortNpub } from "../../nostr/keys.js";
import Button from "../../ui/Button.jsx";
import { inputCls } from "../../ui/Parts.jsx";

export function UnlockView({ saved, busy, error, onUnlock, onSwitch }) {
  const [password, setPassword] = useState("");
  return (
    <div className="space-y-4">
      <p className="text-center">
        <span className="block text-xl font-bold">Welcome back{saved.name ? `, ${saved.name}` : ""}</span>
        <span className="block text-neutral-500 text-xs font-mono mt-1">{shortNpub(saved.pubkey)}</span>
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && password) onUnlock(password); }}
        placeholder="Password"
        autoFocus
        aria-label="Password"
        className={inputCls}
      />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <Button onClick={() => onUnlock(password)} disabled={!password} loading={busy}>{busy ? "Unlocking…" : "Unlock"}</Button>
      <button type="button" onClick={onSwitch} className="w-full text-neutral-600 text-sm py-2 underline">Use a different account</button>
    </div>
  );
}

export function BackupStep({ nsec, onContinue }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(nsec);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Save your secret key</h2>
      <p className="text-neutral-600 text-[15px] leading-relaxed">
        This key is your account. If you lose it, you lose the account and its ratings. No one can reset it.
        Keep it in a password manager. Never share it.
      </p>
      <p className="text-xs font-mono break-all bg-neutral-100 rounded-xl p-3">{nsec}</p>
      <button type="button" onClick={copy} className="text-blue-600 text-sm font-medium">{copied ? "Copied!" : "Copy key"}</button>
      <label className="flex items-start gap-2 text-[15px] cursor-pointer">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1 w-4 h-4 accent-black" />
        I saved my secret key in a safe place.
      </label>
      <Button onClick={onContinue} disabled={!saved}>Continue</Button>
    </div>
  );
}
