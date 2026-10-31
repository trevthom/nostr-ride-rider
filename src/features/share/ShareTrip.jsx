// ════════════════════════════════════════════════════════════
//  SHARE TRIP — The "Share my trip" block on a running ride, for either face:
//  start sharing, the live link, Send link, Stop, and the trusted contacts
//  to text. The link itself is made by nostr/share.js; contacts stay on this
//  device (lib/safety.js). The ride's owner (rider or driver) supplies the
//  state from their context, so both faces share exactly the same behaviour.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { getContacts, smsHref, tripMessage } from "../../lib/safety.js";
import { SectionLabel } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";

export default function ShareTrip({ request, destination, share, startShare, stopShare, shareUrl, heading = "Share my trip", onClose }) {
  const { user, setView } = useApp();
  const [copied, setCopied] = useState(false);
  const contacts = getContacts();
  const link = share ? shareUrl(share) : "";
  const text = (sos) => tripMessage({ name: user.name, destination, link, sos });
  const send = async (sos = false) => {
    const msg = text(sos);
    if (navigator.share) { try { await navigator.share({ text: msg }); return; } catch { /* cancelled: fall back to copy */ } }
    navigator.clipboard?.writeText(msg);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      {heading && <SectionLabel>{heading}</SectionLabel>}
      {!share ? (
        <>
          <p className="text-sm text-neutral-600 mb-3">A friend can follow you live on a map: your position, updated every few seconds. No account needed. Only people with the link can see it.</p>
          <Button size="md" onClick={() => startShare(request)}>Start sharing</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-[#05944f] font-medium mb-2" role="status">Sharing is on{share.sos ? " (SOS)" : ""}. It stops when the trip ends.</p>
          <p className="text-xs font-mono break-all bg-neutral-100 rounded-xl p-3 mb-2">{link}</p>
          <div className="flex gap-2">
            <Button size="md" onClick={() => send(false)}>{copied ? "Copied" : "Send link"}</Button>
            <Button size="md" variant="secondary" onClick={stopShare}>Stop</Button>
          </div>
          {contacts.length > 0 && (
            <div className="mt-3 space-y-1">
              {contacts.map((c) => (
                <a key={c.phone} href={smsHref(c.phone, text(share.sos))} className="flex items-center justify-between py-2 text-[15px]">
                  <span>Text {c.name}</span><Icon name="chevron-right" size={16} className="text-neutral-400" />
                </a>
              ))}
            </div>
          )}
        </>
      )}
      {contacts.length === 0 && (
        <button type="button" onClick={() => { onClose?.(); setView("account"); }} className="mt-2 text-sm font-medium underline">Add trusted contacts in Account</button>
      )}
    </div>
  );
}
