// ════════════════════════════════════════════════════════════
//  ACTIVITY (rider) — The ride in progress, reservations for later,
//  and past trips (newest first). Tap a past trip for its receipt.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { relay } from "../../nostr/relay.js";
import { getProfile } from "../../nostr/profiles.js";
import { rideDriver, rideEnding, rideKey, rideStatus } from "../../lib/rides.js";
import { currentLedger, ledgerSummary } from "../../lib/ridemoney.js";
import { rideTerms } from "../../lib/terms.js";
import { rideMint } from "../../lib/terms.js";
import { sentSats } from "../../lib/payments.js";
import AddFunds from "../../features/payments/AddFunds.jsx";
import { exactTrip } from "../../lib/privacy.js";
import { offerFrom, offersForRide } from "../../lib/trips.js";
import { Screen } from "../../ui/Layout.jsx";
import { ModeSwitch } from "../../ui/ModeSwitch.jsx";
import { Modal, SectionLabel } from "../../ui/Parts.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import DriverInfo from "../components/DriverInfo.jsx";
import TipSheet from "../components/TipSheet.jsx";
import { tipsOf } from "../../lib/evidence.js";
import { whenText } from "./ActiveTrip.jsx";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const fmt = (sec) => new Date(sec * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function ActivityScreen() {
  const { user, rideRequests, pullRecent, setView } = useApp();
  const { activeRide, upcoming, focusRide, finishRide } = useRider();
  const [open, setOpen] = useState(null); // past trip shown in the receipt modal

  useEffect(() => {
    relay.fetchHistory(user.publicKey);
    pullRecent();
    const id = setInterval(() => pullRecent(), 10000);
    return () => clearInterval(id);
  }, [pullRecent, user.publicKey]);

  const past = rideRequests
    .filter((r) => r.pubkey === user.publicKey && ["completed", "closed"].includes(rideStatus(r)) && (rideStatus(r) === "completed" || rideDriver(r)))
    .sort((a, b) => (rideEnding(b)?.at || b.created_at) - (rideEnding(a)?.at || a.created_at))
    .slice(0, 50);

  const tripOf = (r) => exactTrip(r, user) || parse(r);

  return (
    <Screen title="Activity" right={<ModeSwitch />}>
      {activeRide && (
        <section className="mb-6">
          <SectionLabel>In progress</SectionLabel>
          <div className="rounded-2xl bg-neutral-100 p-4">
            <p className="font-semibold truncate">{tripOf(activeRide)?.dropoff?.name}</p>
            <p className="text-sm text-neutral-600 mb-3">{rideStatus(activeRide) === "in_progress" ? "Trip under way" : "Looking for a driver"}</p>
            <Button size="md" onClick={() => setView("home")}>View ride</Button>
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="mb-6">
          <SectionLabel>Upcoming</SectionLabel>
          <div className="space-y-3">
            {upcoming.map((r) => {
              const c = parse(r);
              const n = offersForRide(r).length;
              return (
                <div key={r.id} className="rounded-2xl bg-neutral-100 p-4">
                  <p className="font-semibold truncate">{tripOf(r)?.dropoff?.name}</p>
                  <p className="text-sm text-neutral-600">{whenText(c.time)} · {n ? `${n} driver${n === 1 ? "" : "s"} accepted` : "Waiting for drivers"}</p>
                  <div className="flex gap-2 mt-3">
                    <Button size="md" onClick={() => { focusRide(r); setView("home"); }}>{n ? "Choose a driver" : "View"}</Button>
                    <Button size="md" variant="secondary" onClick={() => finishRide(r)}>Close request</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <SectionLabel>Past trips</SectionLabel>
        {past.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="car" size={40} className="mx-auto text-neutral-300 mb-3" />
            <p className="font-semibold">No trips yet</p>
            <p className="text-neutral-500 text-sm mt-1">Your finished rides show up here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {past.map((r) => {
              const t = tripOf(r);
              const done = rideStatus(r) === "completed";
              const fare = done ? sentSats(r) : 0; // what the rider paid, tick by tick
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpen(r)} className="w-full flex items-center gap-3 py-3 text-left active:bg-neutral-50">
                    <span className="w-11 h-11 rounded-full bg-neutral-100 flex items-center justify-center shrink-0"><Icon name="car" size={20} /></span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold truncate">{t?.dropoff?.name}</span>
                      <span className="block text-sm text-neutral-500">{fmt(rideEnding(r)?.at || r.created_at)}</span>
                    </span>
                    <span className="text-right">
                      {done && fare ? <Money sats={fare} className="font-semibold" /> : null}
                      {!done && <span className="block text-xs text-neutral-500">Finished before the start</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {open && <PastTrip request={open} trip={tripOf(open)} onClose={() => setOpen(null)} />}
    </Screen>
  );
}

function PastTrip({ request, trip, onClose }) {
  const { user, btcPrice, priceFor } = useApp();
  const { payNow, money } = useRider();
  const driverPubkey = rideDriver(request);
  const offer = offerFrom(request, driverPubkey);
  const done = rideStatus(request) === "completed";
  const terms = rideTerms(request);
  const sum = ledgerSummary(request, terms && done ? currentLedger(request, { terms, price: priceFor(terms.currency), nowMs: Date.now(), miles: null, role: "rider" }) : null);
  const [adding, setAdding] = useState(false);
  const mint = rideMint(request);
  const driver = driverPubkey ? getProfile(driverPubkey) : null;
  const [tipping, setTipping] = useState(false);
  const tipped = tipsOf(request).reduce((s, t) => s + t.sats, 0);

  return (
    <Modal open title={done ? "Trip details" : "Finished before the start"} onClose={onClose}>
      <p className="text-neutral-500 text-sm mb-3">{fmt(rideEnding(request)?.at || request.created_at)}</p>
      {trip && (
        <div className="space-y-1 mb-4">
          <p className="text-[15px]"><span className="text-neutral-500">From </span>{trip.pickup.name}</p>
          <p className="text-[15px]"><span className="text-neutral-500">To </span>{trip.dropoff.name}</p>
        </div>
      )}
      {done && (
        <dl className="rounded-2xl bg-neutral-100 px-4 py-3 space-y-2 text-[15px] mb-4">
          <div className="flex justify-between"><dt className="font-semibold">Fare</dt><dd><Money sats={sum.owed} className="font-bold" /></dd></div>
          <div className="flex justify-between"><dt className="text-neutral-600">Paid</dt><dd><Money sats={sum.paid} /></dd></div>
          {sum.forgiven > 0 && <div className="flex justify-between"><dt className="text-neutral-600">Waived</dt><dd><Money sats={sum.forgiven} /></dd></div>}
          {sum.outstanding > 2 && <div className="flex justify-between"><dt className="font-semibold text-amber-700">Still to pay</dt><dd><Money sats={sum.outstanding} className="font-bold" /></dd></div>}
          {tipped > 0 && <div className="flex justify-between"><dt className="text-neutral-600">Tip</dt><dd><Money sats={tipped} /></dd></div>}
        </dl>
      )}
      {done && sum.outstanding > 2 && (
        <div className="mb-4 rounded-2xl bg-amber-50 text-amber-900 px-4 py-3">
          <p className="text-sm font-semibold">You still owe {moneyText(sum.outstanding, btcPrice)}.</p>
          <div className="flex gap-2 mt-2">
            {mint && <Button size="md" onClick={() => setAdding(true)}><Icon name="zap" size={16} /> Add funds</Button>}
            <Button size="md" variant="secondary" onClick={() => payNow(request)}>Pay now</Button>
          </div>
          {money?.status === "error" && <p className="text-xs text-red-700 mt-1">{money.message}</p>}
        </div>
      )}
      {driverPubkey && <DriverInfo pubkey={driverPubkey} offerEvent={offer} compact />}
      {done && driverPubkey && (
        <Button size="md" variant="secondary" className="mt-4" onClick={() => setTipping(true)}>{tipped > 0 ? "Tip again" : "Leave a tip"}</Button>
      )}
      {!driver && !driverPubkey && <p className="text-neutral-500 text-sm">No driver was assigned.</p>}
      {tipping && <TipSheet request={request} onClose={() => setTipping(false)} />}
      {adding && mint && <AddFunds mint={mint} needSats={sum.outstanding} onClose={() => setAdding(false)} />}
    </Modal>
  );
}
