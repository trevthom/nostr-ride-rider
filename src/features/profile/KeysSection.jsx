// ════════════════════════════════════════════════════════════
//  KEYS SECTION — Two boxes: the npub (public, always visible) and the nsec (secret, HIDDEN by default with a
//  show/hide toggle). Each box has a large button that copies that key.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import Button from "../../ui/Button.jsx";

export default function KeysSection({ user }) {
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState("");

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <div className="space-y-4">
      {/* Public key */}
      <div className="bg-neutral-100 rounded-xl border border-neutral-200 p-4">
        <p className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold mb-2">Public (npub)</p>
        <p className="text-neutral-600 text-xs font-mono break-all">{user.npub}</p>
        <Button variant="outline" size="md" className="mt-3" onClick={() => copy(user.npub, "npub")}>
          {copied === "npub" ? "Copied" : "Copy npub"}
        </Button>
      </div>

      {/* Secret key — hidden by default */}
      <div className="bg-neutral-100 rounded-xl border border-neutral-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold">Secret (nsec)</p>
          <button type="button" onClick={() => setShowSecret((s) => !s)} className="text-blue-600 text-xs font-semibold">
            {showSecret ? "Hide" : "Show"}
          </button>
        </div>
        <p className="text-neutral-600 text-xs font-mono break-all">
          {showSecret ? user.nsec : "nsec1" + "•".repeat(20)}
        </p>
        <Button variant="outline" size="md" className="mt-3" onClick={() => copy(user.nsec, "nsec")}>
          {copied === "nsec" ? "Copied" : "Copy nsec"}
        </Button>
        <p className="text-red-600 text-[11px] mt-2">
          Never share your nsec. Anyone with it controls this identity.
        </p>
      </div>
    </div>
  );
}
