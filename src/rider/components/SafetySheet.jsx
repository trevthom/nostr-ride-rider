// ════════════════════════════════════════════════════════════
//  SAFETY SHEET (rider) — Opened from the shield button on a trip:
//    • Call emergency services (EMERGENCY_NUMBER in config/settings.js)
//    • Share my trip: a live-tracking link a friend opens in any browser
//    • Alert my contacts (SOS): shares the trip and marks it as an SOS
//    • Report a problem: a signed note saved with the ride's record
//  Contacts are set in Account → Safety and never leave this device.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { EMERGENCY_NUMBER } from "../../config/settings.js";
import { getContacts, smsHref, tripMessage } from "../../lib/safety.js";
import { Modal, SectionLabel, inputCls } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";

export default function SafetySheet({ open, onClose, request, destination }) {
  const { user, setView } = useApp();
  const { share, startShare, stopShare, shareUrl, confirmRide } = useRider();
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState(false);
  const contacts = getContacts();
  const link = share ? shareUrl(share) : "";
  const text = (sos) => tripMessage({ name: user.name, destination, link, sos });

  const begin = (sos) => { startShare(request, { sos }); };
  const send = async (sos) => {
    const msg = tripMessage({ name: user.name, destination, link, sos });
    if (navigator.share) { try { await navigator.share({ text: msg }); return; } catch { /* cancelled: fall back to copy */ } }
    navigator.clipboard?.writeText(msg);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal open={open} title="Safety" onClose={onClose}>
      <a href={`tel:${EMERGENCY_NUMBER}`} className="flex items-center justify-center gap-2 w-full py-4 rounded-xl bg-red-600 text-white font-semibold text-base">
        <Icon name="phone" size={20} /> Call emergency services ({EMERGENCY_NUMBER})
      </a>

      <div className="mt-5">
        <SectionLabel>Share my trip</SectionLabel>
        {!share ? (
          <>
            <p className="text-sm text-neutral-600 mb-3">A friend can follow your car live on a map. No account needed. Only people with the link can see it.</p>
            <Button size="md" onClick={() => begin(false)}>Start sharing</Button>
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
          <button type="button" onClick={() => { onClose(); setView("account"); }} className="mt-2 text-sm font-medium underline">Add trusted contacts in Account</button>
        )}
      </div>

      <div className="mt-5">
        <SectionLabel>In danger?</SectionLabel>
        <Button variant="danger" size="md" onClick={() => { begin(true); }}>
          {share?.sos ? "SOS is on. Tell your contacts" : "Alert my contacts (SOS)"}
        </Button>
        {share?.sos && <Button className="mt-2" size="md" onClick={() => send(true)}>Send SOS message</Button>}
        <p className="text-xs text-neutral-500 mt-2">SOS starts sharing and marks your trip red for anyone following. It does not call anyone by itself: also call emergency services.</p>
      </div>

      <div className="mt-5">
        <SectionLabel>Report a problem</SectionLabel>
        {sent ? (
          <p className="text-sm text-neutral-600">Sent. It is saved with this trip's record.</p>
        ) : (
          <>
            <textarea aria-label="What is wrong" value={problem} onChange={(e) => setProblem(e.target.value)} rows={2} maxLength={500} placeholder="What is wrong?" className={`${inputCls} resize-none`} />
            <Button className="mt-2" size="md" variant="secondary" disabled={!problem.trim()} onClick={() => { confirmRide(request, "problem", false, problem.trim()); setSent(true); }}>Send report</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
