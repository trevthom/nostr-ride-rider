// ════════════════════════════════════════════════════════════
//  CONTACT SHEET — How to reach the other person on a trip: the phone /
//  Signal / Telegram / WhatsApp handles from their profile. Handles are
//  untrusted text from relays, so links come from lib/contact.js.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { getProfile } from "../nostr/profiles.js";
import { contactHref } from "../lib/contact.js";
import { Modal } from "./Parts.jsx";
import Icon from "./Icon.jsx";

export default function ContactSheet({ open, onClose, pubkey, name }) {
  const [copied, setCopied] = useState("");
  const comm = (pubkey && getProfile(pubkey)?.comm) || [];
  const copy = (text, key) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  };
  return (
    <Modal open={open} title={`Contact ${name || "them"}`} onClose={onClose}>
      {comm.length === 0 ? (
        <p className="text-neutral-500 text-[15px] py-4">
          {name ? `${name} hasn't` : "They haven't"} added a way to reach them. You can still meet at the pickup point.
        </p>
      ) : (
        <div className="divide-y divide-neutral-100">
          {comm.map((c, i) => {
            const href = contactHref(c.platform, c.handle);
            return (
              <div key={i} className="flex items-center gap-3 py-3">
                <span className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                  <Icon name="phone" size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium">{c.platform}</p>
                  <p className="text-sm text-neutral-500 truncate">{c.handle}</p>
                </div>
                <button type="button" onClick={() => copy(c.handle, i)} className="text-sm font-medium text-neutral-600 px-2">
                  {copied === i ? "Copied" : "Copy"}
                </button>
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-full bg-black text-white text-sm font-semibold">
                    Open
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
