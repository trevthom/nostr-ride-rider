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
import { tripMessage } from "../../lib/safety.js";
import { Modal, SectionLabel, inputCls } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import ShareTrip from "../../features/share/ShareTrip.jsx";

export default function SafetySheet({ open, onClose, request, destination }) {
  const { user } = useApp();
  const { share, startShare, stopShare, shareUrl, confirmRide } = useRider();
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState(false);
  const link = share ? shareUrl(share) : "";

  const sendSos = async () => {
    if (!link) return;
    const msg = tripMessage({ name: user.name, destination, link, sos: true });
    if (navigator.share) { try { await navigator.share({ text: msg }); return; } catch { /* cancelled: fall back to copy */ } }
    navigator.clipboard?.writeText(msg);
  };

  return (
    <Modal open={open} title="Safety" onClose={onClose}>
      <a href={`tel:${EMERGENCY_NUMBER}`} className="flex items-center justify-center gap-2 w-full py-4 rounded-xl bg-[#dc2626] text-[#fff] font-semibold text-base">
        <Icon name="phone" size={20} /> Call emergency services ({EMERGENCY_NUMBER})
      </a>

      <div className="mt-5">
        <ShareTrip request={request} destination={destination} share={share} startShare={startShare} stopShare={stopShare} shareUrl={shareUrl} onClose={onClose} />
      </div>

      <div className="mt-5">
        <SectionLabel>In danger?</SectionLabel>
        <Button variant="danger" size="md" onClick={() => { startShare(request, { sos: true }); }}>
          {share?.sos ? "SOS is on. Tell your contacts" : "Alert my contacts (SOS)"}
        </Button>
        {share?.sos && <Button className="mt-2" size="md" onClick={sendSos}>Send SOS message</Button>}
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
