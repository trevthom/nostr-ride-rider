// ════════════════════════════════════════════════════════════
//  KEYS SECTION — Shows the user's npub (public, always visible)
//  and nsec (secret, HIDDEN by default with a show/hide toggle).
//  Each key has a copy button.
// ════════════════════════════════════════════════════════════

import { useState } from "react";

export default function KeysSection({ user }) {
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState("");

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <div className="bg-neutral-100 rounded-xl border border-neutral-200 p-4">
      <p className="text-neutral-500 text-xs uppercase tracking-wider font-semibold mb-3">Your Keys</p>

      {/* Public key */}
      <KeyRow
        label="Public (npub)"
        value={user.npub}
        display={user.npub}
        onCopy={() => copy(user.npub, "npub")}
        copied={copied === "npub"}
      />

      {/* Secret key — hidden by default */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-neutral-500 text-[11px] uppercase">Secret (nsec)</p>
          <button onClick={() => setShowSecret((s) => !s)} className="text-blue-600 text-xs">
            {showSecret ? "Hide" : "Show"}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-neutral-500 text-xs font-mono break-all flex-1">
            {showSecret ? user.nsec : "nsec1" + "•".repeat(20)}
          </p>
          {showSecret && (
            <button onClick={() => copy(user.nsec, "nsec")} className="text-blue-600 text-xs shrink-0">
              {copied === "nsec" ? "Copied" : "Copy"}
            </button>
          )}
        </div>
        <p className="text-red-600 text-[11px] mt-1">
          Never share your nsec. Anyone with it controls this identity.
        </p>
      </div>
    </div>
  );
}

function KeyRow({ label, display, onCopy, copied }) {
  return (
    <div>
      <p className="text-neutral-500 text-[11px] uppercase mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <p className="text-neutral-500 text-xs font-mono break-all flex-1">{display}</p>
        <button onClick={onCopy} className="text-blue-600 text-xs shrink-0">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
