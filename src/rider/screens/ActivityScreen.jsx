// ════════════════════════════════════════════════════════════
//  ACTIVITY (rider) — The ride in progress, reservations for later,
//  and past trips (newest first). Tap a past trip for its receipt.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { getProfile } from "../../nostr/profiles.js";
import { rideDriver, rideEnding, rideStatus, rideVersions } from "../../lib/rides.js";
import { exactTrip } from "../../lib/privacy.js";
import { offerFrom, offersForRide } from "../../lib/trips.js";
import { Screen } from "../../ui/Layout.jsx";
import { Modal, SectionLabel } from "../../ui/Parts.jsx";
import Money from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import DriverInfo from "../components/DriverInfo.jsx";
import { whenText } from "./ActiveTrip.jsx";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const fmt = (sec) => new Date(sec * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function ActivityScreen() {
  const { user, rideRequests, pullRecent, setView } = useApp();
  const { activeRide, upcoming, focusRide, cancelRide } = useRider();
  const [open, setOpen] = useState(null); // past trip shown in the receipt modal

  useEffect(() => {
    relay.fetchHistory(user.publicKey);
    pullRecent();
    const id = setInterval(() => pullRecent(), 10000);
    return () => clearInterval(id);
  }, [pullRecent, user.publicKey]);

  const past = rideRequests
    .filter((r) => r.pubkey === user.publicKey && ["completed", "cancelled"].includes(rideStatus(r)))
    .sort((a, b) => (rideEnding(b)?.at || b.created_at) - (rideEnding(a)?.at || a.created_at))
    .slice(0, 50);

  const tripOf = (r) => exactTrip(r, user) || parse(r);

  return (
    <Screen title="Activity">
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
                    <Button size="md" variant="secondary" onClick={() => cancelRide(r)}>Cancel</Button>
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
            <p className="text-neutral-500 text-sm mt-1">Your completed rides show up here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {past.map((r) => {
              const t = tripOf(r);
              const done = rideStatus(r) === "completed";
              const offer = offerFrom(r, rideDriver(r));
              const fare = offer ? parse(offer)?.priceSats : parse(r)?.fareSats;
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
                      {!done && <span className="block text-xs text-neutral-500">Cancelled</span>}
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
  const { user } = useApp();
  const driverPubkey = rideDriver(request);
  const offer = offerFrom(request, driverPubkey);
  const o = offer ? parse(offer) : null;
  const done = rideStatus(request) === "completed";
  const ids = new Set(rideVersions(request).map((e) => e.id));
  const mine = relay
    .query({ kinds: [EVENT_KINDS.RATING], authors: [user.publicKey] })
    .find((r) => ids.has((r.tags.find((t) => t[0] === "e") || [])[1]));
  const review = mine ? parse(mine) : null;
  const driver = driverPubkey ? getProfile(driverPubkey) : null;

  return (
    <Modal open title={done ? "Trip details" : "Cancelled trip"} onClose={onClose}>
      <p className="text-neutral-500 text-sm mb-3">{fmt(rideEnding(request)?.at || request.created_at)}</p>
      {trip && (
        <div className="space-y-1 mb-4">
          <p className="text-[15px]"><span className="text-neutral-500">From </span>{trip.pickup.name}</p>
          <p className="text-[15px]"><span className="text-neutral-500">To </span>{trip.dropoff.name}</p>
        </div>
      )}
      {o && done && (
        <dl className="rounded-2xl bg-neutral-100 px-4 py-3 space-y-2 text-[15px] mb-4">
          <div className="flex justify-between"><dt className="font-semibold">Total</dt><dd><Money sats={o.priceSats} className="font-bold" /></dd></div>
          {o.upfrontSats > 0 && <div className="flex justify-between"><dt className="text-neutral-600">Deposit</dt><dd><Money sats={o.upfrontSats} /></dd></div>}
        </dl>
      )}
      {driverPubkey && <DriverInfo pubkey={driverPubkey} offerEvent={offer} compact />}
      {review && (
        <div className="mt-4 text-sm">
          <p className="font-semibold">Your rating: {"★".repeat(review.rating)}<span className="text-neutral-300">{"★".repeat(5 - review.rating)}</span></p>
          {review.review && <p className="text-neutral-600 mt-1">{review.review}</p>}
        </div>
      )}
      {!driver && !driverPubkey && <p className="text-neutral-500 text-sm">No driver was assigned.</p>}
    </Modal>
  );
}
