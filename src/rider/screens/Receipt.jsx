// ════════════════════════════════════════════════════════════
//  RECEIPT — Shown after a trip ends. For a completed trip: the fare,
//  paying the rest of it (the deposit was paid up front), and an optional
//  rating of the driver. For a trip the driver cancelled: a short notice.
//  "Paid" is remembered on this device so the rest is never paid twice.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { getProfile } from "../../nostr/profiles.js";
import { rideConfirm, rideDriver, rideEnding, rideKey, rideStatus } from "../../lib/rides.js";
import { exactTrip } from "../../lib/privacy.js";
import { offerFrom } from "../../lib/trips.js";
import { getSetting, setSetting } from "../../config/relays.js";
import Money from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import RatingForm from "../../ui/RatingForm.jsx";
import { ConfirmDialog, Modal, inputCls } from "../../ui/Parts.jsx";
import BlockButton from "../../ui/BlockButton.jsx";
import PayDriver from "../../features/payments/PayDriver.jsx";
import DriverInfo from "../components/DriverInfo.jsx";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

export default function Receipt({ request }) {
  const { user, liveTick } = useApp();
  const { dismissReceipt, rateDriver, recordPayment, confirmRide } = useRider();
  void liveTick;
  const key = rideKey(request);
  const driverPubkey = rideDriver(request);
  const completed = rideStatus(request) === "completed";
  const offer = offerFrom(request, driverPubkey);
  const o = offer ? parse(offer) : null;
  const driver = driverPubkey ? getProfile(driverPubkey) : null;
  const trip = exactTrip(request, user) || parse(request);
  const endedAt = rideEnding(request)?.at;

  const [paid, setPaid] = useState(() => getSetting("riderPaid", []).includes(key));
  const [rated, setRated] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  const [reported, setReported] = useState(!!rideConfirm(request).ended && !rideConfirm(request).ended.ok);

  const rest = o ? Math.max(0, o.priceSats - (o.upfrontSats || 0)) : 0;
  const owes = completed && rest > 0 && !paid;

  const markPaid = (proof) => {
    setSetting("riderPaid", [...getSetting("riderPaid", []), key].slice(-100));
    setPaid(true);
    // A signed record of the payment (evidence if the driver ever disputes it).
    if (driverPubkey) recordPayment(request, driverPubkey, "rest", rest, proof);
  };

  // Leaving the receipt is the rider's signed "the trip ended" (unless they reported a problem).
  const finish = () => {
    if (!rideConfirm(request).ended) confirmRide(request, "ended", true);
    dismissReceipt(request);
  };

  if (!completed) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-white px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-8 text-center flex flex-col justify-center">
        <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-4"><Icon name="x" size={30} /></div>
        <h1 className="text-2xl font-bold">Your driver cancelled</h1>
        <p className="text-neutral-600 text-[15px] mt-2">
          Sorry about that. Any deposit you paid went straight to the driver, so the app can't refund it.
        </p>
        <Button className="mt-6" onClick={() => dismissReceipt(request)}>Find another ride</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-white">
      <div className="px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-8">
        <div className="w-14 h-14 rounded-full bg-[#e6f4ec] text-[#05944f] flex items-center justify-center mb-3"><Icon name="check" size={28} strokeWidth={3} /></div>
        <h1 className="text-[28px] leading-8 font-bold">Trip complete</h1>
        {endedAt && <p className="text-neutral-500 text-sm mt-1">{new Date(endedAt * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>}

        {trip && (
          <div className="mt-5 flex items-start gap-3">
            <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
              <span className="w-2 h-2 rounded-full bg-black" /><span className="h-5 w-px bg-neutral-300 my-0.5" /><span className="w-2 h-2 bg-black" />
            </div>
            <div className="min-w-0 flex-1 space-y-2.5">
              <p className="text-[15px] truncate">{trip.pickup.name}</p>
              <p className="text-[15px] truncate">{trip.dropoff.name}</p>
            </div>
          </div>
        )}

        {o && (
          <dl className="mt-5 rounded-2xl bg-neutral-100 px-4 py-3 space-y-2 text-[15px]">
            <div className="flex justify-between"><dt className="font-semibold">Total</dt><dd><Money sats={o.priceSats} className="font-bold" /></dd></div>
            {o.upfrontSats > 0 && <div className="flex justify-between"><dt className="text-neutral-600">Deposit paid</dt><dd><Money sats={o.upfrontSats} /></dd></div>}
            {rest > 0 && <div className="flex justify-between"><dt className="text-neutral-600">{paid ? "Rest paid" : "Rest to pay"}</dt><dd><Money sats={rest} className={paid ? "" : "font-bold"} /></dd></div>}
          </dl>
        )}

        {owes && (
          <div className="mt-4">
            <h2 className="font-bold mb-2">Pay the rest of the fare</h2>
            <PayDriver amountSats={rest} address={driver?.lud16} memo="NostrRide fare" onPaid={markPaid} />
          </div>
        )}
        {completed && rest > 0 && paid && <p className="text-[#05944f] text-sm font-medium mt-3 flex items-center gap-1"><Icon name="check" size={16} /> Paid in full</p>}

        {driverPubkey && (
          <div className="mt-6 pt-5 border-t border-neutral-100">
            <DriverInfo pubkey={driverPubkey} offerEvent={offer} compact />
            <div className="mt-5">
              {rated ? (
                <p className="text-center text-neutral-600 text-[15px]">Thanks for rating your driver.</p>
              ) : (
                <RatingForm who="driver" onSubmit={(stars, review) => { rateDriver(request, driverPubkey, stars, review); setRated(true); }} onSkip={() => setRated(true)} />
              )}
            </div>
          </div>
        )}

        {reported ? (
          <p className="text-sm text-neutral-600 mt-4">Your report was sent. The trip record is saved with it.</p>
        ) : (
          <button type="button" onClick={() => setReporting(true)} className="mt-4 text-sm font-medium underline">Report a problem with this trip</button>
        )}
        {driverPubkey && <div className="mt-3"><BlockButton pubkey={driverPubkey} /></div>}
        <Button className="mt-4" onClick={() => (owes ? setLeaving(true) : finish())}>Done</Button>
      </div>

      <ConfirmDialog
        open={leaving}
        title="You still owe the rest of the fare"
        message="Your driver is waiting to be paid. Leave without paying?"
        confirmLabel="Leave anyway"
        cancelLabel="Pay now"
        danger
        onConfirm={() => { setLeaving(false); finish(); }}
        onCancel={() => setLeaving(false)}
      />
      <Modal open={reporting} title="Report a problem" onClose={() => setReporting(false)}>
        <p className="text-neutral-600 text-[15px] mb-3">
          Say what went wrong. Your report is signed and saved with this trip's payment and driver records.
        </p>
        <textarea aria-label="What went wrong" value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={500} className={`${inputCls} resize-none`} placeholder="What happened?" />
        <Button className="mt-3" disabled={!note.trim()} onClick={() => { confirmRide(request, "ended", false, note.trim()); setReported(true); setReporting(false); }}>Send report</Button>
      </Modal>
    </div>
  );
}
