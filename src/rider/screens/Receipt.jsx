// ════════════════════════════════════════════════════════════
//  RECEIPT — Shown after a ride ends (either person finished it). The fare is what the ride
//  earned (base + miles + minutes), mostly paid already tick by tick.
//  If anything is still open (the wallet ran short), it is shown with "Add funds": the app pays the
//  rest as soon as the wallet has the money, and it can be paid later from Activity.
//  Then a quiet "Leave a tip" link (a tip is optional and can be
//  sent any time later from Activity). If the driver finished the ride before it started: a short notice.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { getProfile } from "../../nostr/profiles.js";
import { rideConfirm, rideDriver, rideEnding, rideKey, rideStatus } from "../../lib/rides.js";
import { currentLedger, ledgerSummary } from "../../lib/ridemoney.js";
import { rideTerms } from "../../lib/terms.js";
import { waiversOf } from "../../lib/payments.js";
import { FINISH_REASONS } from "../../lib/finish.js";
import { moneyText } from "../../ui/Money.jsx";
import AddFunds from "../../features/payments/AddFunds.jsx";
import { exactTrip } from "../../lib/privacy.js";
import { offerFrom } from "../../lib/trips.js";
import Money from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import { ConfirmDialog, Modal, inputCls } from "../../ui/Parts.jsx";
import BlockButton from "../../ui/BlockButton.jsx";
import DriverInfo from "../components/DriverInfo.jsx";
import TipSheet from "../components/TipSheet.jsx";
import { tipsOf } from "../../lib/evidence.js";
import FareBreakdown from "../../ui/FareBreakdown.jsx";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

export default function Receipt({ request }) {
  const { user, liveTick, btcPrice, priceFor } = useApp();
  const { dismissReceipt, confirmRide, money, payNow, allowMore, payMint } = useRider();
  void liveTick;
  const key = rideKey(request);
  const driverPubkey = rideDriver(request);
  const completed = rideStatus(request) === "completed";
  const offer = offerFrom(request, driverPubkey);
  const o = offer ? parse(offer) : null;
  const driver = driverPubkey ? getProfile(driverPubkey) : null;
  const trip = exactTrip(request, user) || parse(request);
  const endedAt = rideEnding(request)?.at;

  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [tipping, setTipping] = useState(false);
  const tipped = tipsOf(request).reduce((s, t) => s + t.sats, 0);
  const [note, setNote] = useState("");
  const [reported, setReported] = useState(!!rideConfirm(request).ended && !rideConfirm(request).ended.ok);

  // What the ride earned, what the driver confirmed, what was waived and what is still open.
  const terms = rideTerms(request);
  const ledger = money && money.ledger ? money.ledger : terms ? currentLedger(request, { terms, price: priceFor(terms.currency), nowMs: Date.now(), miles: null, role: "rider" }) : null;
  const sum = money && money.ledger ? money : { ...ledgerSummary(request, ledger), status: "ok" };
  const owes = completed && sum.outstanding > 2;
  const waived = waiversOf(request).reduce((t, w) => t + w.forgivenSats + w.refundSats, 0);
  const fin = endedAt ? rideEnding(request)?.fin : null;

  // Leaving the receipt is the rider's signed "the trip ended" (unless they reported a problem).
  const finish = () => {
    if (!rideConfirm(request).ended) confirmRide(request, "ended", true);
    dismissReceipt(request);
  };

  if (!completed) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-white px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-8 text-center flex flex-col justify-center">
        <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-4"><Icon name="x" size={30} /></div>
        <h1 className="text-2xl font-bold">Your driver finished the ride</h1>
        <p className="text-neutral-600 text-[15px] mt-2">
          It was before the ride started, so you owe nothing. Sorry about that.
        </p>
        <Button className="mt-6" onClick={() => dismissReceipt(request)}>Find another ride</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-white">
      <div className="px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-8">
        <div className="w-14 h-14 rounded-full bg-[#e6f4ec] text-[#05944f] flex items-center justify-center mb-3"><Icon name="check" size={28} strokeWidth={3} /></div>
        <h1 className="text-[28px] leading-8 font-bold">Ride finished</h1>
        {endedAt && <p className="text-neutral-500 text-sm mt-1">{new Date(endedAt * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>}
        {fin?.reason && <p className="text-neutral-600 text-sm mt-1">{FINISH_REASONS[fin.reason]}</p>}

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

        <dl className="mt-5 rounded-2xl bg-neutral-100 px-4 py-3 space-y-2 text-[15px]">
          <div className="flex justify-between"><dt className="font-semibold">Fare</dt><dd><Money sats={sum.owed} className="font-bold" /></dd></div>
          <div className="flex justify-between"><dt className="text-neutral-600">Paid</dt><dd><Money sats={sum.paid} /></dd></div>
          {sum.forgiven > 0 && <div className="flex justify-between"><dt className="text-neutral-600">Waived by your driver</dt><dd><Money sats={sum.forgiven} /></dd></div>}
          {owes && <div className="flex justify-between"><dt className="font-semibold text-amber-700">Still to pay</dt><dd><Money sats={sum.outstanding} className="font-bold" /></dd></div>}
        </dl>
        {completed && <FareBreakdown ledger={ledger} paidSats={sum.paid} className="mt-3 rounded-2xl bg-neutral-100 px-4 py-3" />}
        {waived > 0 && <p className="text-[#05944f] text-sm font-medium mt-2">Your driver waived part of the fare{waiversOf(request).some((w) => w.refundSats > 0) ? " and sent money back to your wallet" : ""}.</p>}
        <p className="text-neutral-500 text-xs mt-2">The fare is the base rate, each mile and each minute of the ride. It was paid in ecash while you rode.</p>

        {owes && (
          <div className="mt-4 rounded-2xl bg-amber-50 text-amber-900 px-4 py-3" role="alert">
            <p className="font-semibold">You still owe {moneyText(sum.outstanding, btcPrice)}.</p>
            <p className="text-sm mt-0.5">Your wallet was short during the ride. Add funds and the app pays it at once. You can also pay later from Activity.</p>
            <div className="flex gap-2 mt-2">
              <Button size="md" onClick={() => setAdding(true)}><Icon name="zap" size={16} /> Add funds</Button>
              <Button size="md" variant="secondary" onClick={() => payNow(request)}>Pay now</Button>
            </div>
            {money?.status === "error" && <p className="text-xs text-red-700 mt-2">{money.message}</p>}
          </div>
        )}
        {money?.status === "capped" && (
          <div className="mt-4 rounded-2xl bg-amber-50 text-amber-900 px-4 py-3" role="alert">
            <p className="font-semibold">Payments paused at {moneyText(money.capSats, btcPrice)}.</p>
            <p className="text-sm mt-0.5">This ride cost much more than expected: {moneyText(money.held, btcPrice)} more is due. If the fare is right, allow more and the app pays it.</p>
            <Button size="md" className="mt-2" onClick={() => allowMore(request)}>Allow more</Button>
          </div>
        )}
        {completed && !owes && sum.owed > 0 && <p className="text-[#05944f] text-sm font-medium mt-3 flex items-center gap-1"><Icon name="check" size={16} /> Paid in full</p>}

        {driverPubkey && (
          <div className="mt-6 pt-5 border-t border-neutral-100">
            <DriverInfo pubkey={driverPubkey} offerEvent={offer} compact />
          </div>
        )}

        {driverPubkey && (
          <p className="text-sm mt-4">
            {tipped > 0 && <span className="text-[#05944f] font-medium mr-2">Tip sent: <Money sats={tipped} className="font-semibold" />.</span>}
            <button type="button" onClick={() => setTipping(true)} className="font-medium underline">{tipped > 0 ? "Tip again" : "Leave a tip (optional)"}</button>
          </p>
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
        title="You still owe part of the fare"
        message="Your driver has not been paid in full. You can pay later from Activity. Leave now?"
        confirmLabel="Leave anyway"
        cancelLabel="Stay"
        danger
        onConfirm={() => { setLeaving(false); finish(); }}
        onCancel={() => setLeaving(false)}
      />
      {tipping && <TipSheet request={request} onClose={() => setTipping(false)} />}
      {adding && payMint && <AddFunds mint={payMint} needSats={sum.outstanding} onClose={() => setAdding(false)} />}
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
