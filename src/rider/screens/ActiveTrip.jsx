// ════════════════════════════════════════════════════════════
//  ACTIVE TRIP (before pickup) — What the rider sees after requesting:
//    Searching     "Finding your driver…" while no one has replied; the rider
//                  can raise the offer
//    ChooseDriver  drivers who accepted the offer or countered it (preferred
//                  gender first if the rider asked, then fastest)
//    PayDeposit    the chosen driver's deposit (Lightning), then confirm
//  Once a driver is confirmed the ride is in_progress → OnTrip.jsx.
//  Which one shows is decided from the signed events, not app memory.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { getProfile } from "../../nostr/profiles.js";
import { rideStatus } from "../../lib/rides.js";
import { exactTrip } from "../../lib/privacy.js";
import { offersForRide, offerGender, rankOffers } from "../../lib/trips.js";
import { clampOffer, replyKind, usdToSats } from "../../lib/fare.js";
import { FALLBACK_BTC_USD } from "../../config/settings.js";
import { satsToUsd } from "../../ui/SatsAmount.jsx";
import MapView from "../../ui/MapView.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import PriceStepper from "../../ui/PriceStepper.jsx";
import Button from "../../ui/Button.jsx";
import { MapPage, Sheet, FloatButton } from "../../ui/Layout.jsx";
import { ConfirmDialog } from "../../ui/Parts.jsx";
import PayDriver from "../../features/payments/PayDriver.jsx";
import DriverInfo from "../components/DriverInfo.jsx";
import GenderPref from "../components/GenderPref.jsx";
import OnTrip from "./OnTrip.jsx";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
export const whenText = (time) => (time === "ASAP" ? "Now" : new Date(time).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }));

export default function ActiveTrip({ request }) {
  const { user, liveTick, isBlockedPk } = useApp();
  const { cancelRide, focused, focusRide, genderPref } = useRider();
  const [picked, setPicked] = useState(null); // offer id being confirmed
  const [asking, setAsking] = useState(false);
  void liveTick;

  const content = parse(request) || {};
  const trip = exactTrip(request, user) || content; // exact for the rider; coarse as a fallback
  const status = rideStatus(request);

  if (status === "in_progress") return <OnTrip request={request} trip={trip} />;

  // Never show a blocked driver. The rider's gender preference only changes the order.
  const offers = rankOffers(offersForRide(request).filter((o) => !isBlockedPk(o.pubkey)), genderPref);
  const chosen = offers.find((o) => o.id === picked);
  const back = focused ? <FloatButton icon="chevron-left" label="Back to home" onClick={() => focusRide(null)} /> : null;
  const cancelDialog = (
    <ConfirmDialog
      open={asking}
      title="Cancel this request?"
      message="Drivers will stop seeing your request."
      confirmLabel="Cancel request"
      cancelLabel="Keep looking"
      danger
      onConfirm={() => { setAsking(false); focusRide(null); cancelRide(request); }}
      onCancel={() => setAsking(false)}
    />
  );

  if (chosen) {
    return <PayDeposit request={request} trip={trip} offer={chosen} onBack={() => setPicked(null)} />;
  }
  if (offers.length) {
    return (
      <>
        <ChooseDriver request={request} trip={trip} offers={offers} onPick={(o) => setPicked(o.id)} onCancel={() => setAsking(true)} top={back} />
        {cancelDialog}
      </>
    );
  }
  return (
    <>
      <Searching request={request} trip={trip} onCancel={() => setAsking(true)} top={back} />
      {cancelDialog}
    </>
  );
}

function TripLines({ trip }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
        <span className="w-2 h-2 rounded-full bg-black" />
        <span className="h-5 w-px bg-neutral-300 my-0.5" />
        <span className="w-2 h-2 bg-black" />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-[15px] truncate">{trip.pickup.name}</p>
        <p className="text-[15px] truncate">{trip.dropoff.name}</p>
      </div>
    </div>
  );
}

function Searching({ request, trip, onCancel, top }) {
  const { drivers, sendFailed, raiseOffer } = useRider();
  const { btcUsd } = useApp();
  const content = parse(request) || {};
  const [editing, setEditing] = useState(false);
  const rate = btcUsd || FALLBACK_BTC_USD;
  const offerNow = content.fareSats > 0 ? Math.max(1, Math.round(satsToUsd(content.fareSats, rate))) : 0;
  const suggestedUsd = content.suggestedSats > 0 ? Math.max(1, Math.round(satsToUsd(content.suggestedSats, rate))) : offerNow;
  const [draft, setDraft] = useState(offerNow);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(id); }, []);
  const waited = Math.max(0, Math.floor((now - request.created_at * 1000) / 1000));
  const scheduled = content.time && content.time !== "ASAP";

  return (
    <MapPage
      map={<MapView pickup={trip.pickup} cars={drivers} pulse fitKey={request.id} padBottom={330} />}
      top={top}
    >
      <Sheet label="Finding your driver">
        <div className="nr-bar mb-4" role="progressbar" aria-label="Finding your driver" />
        <h2 className="text-2xl font-bold">{scheduled ? "Waiting for a driver" : "Finding your driver…"}</h2>
        <p className="text-neutral-600 text-[15px] mt-1">
          {scheduled
            ? `Reserved for ${whenText(content.time)}. We'll tell you when a driver accepts.`
            : waited > 90
            ? "Still looking. Drivers can take a minute to see new requests."
            : "Your request is on its way to drivers nearby."}
        </p>
        {sendFailed && (
          <p className="text-amber-700 text-sm bg-amber-50 rounded-xl px-3 py-2 mt-3" role="alert">
            No relay accepted your request yet, so drivers may not see it. Check your relays in Account.
          </p>
        )}
        <div className="mt-4 pt-4 border-t border-neutral-100">
          <TripLines trip={trip} />
          {content.fareSats > 0 && (
            <div className="flex items-center justify-between mt-3 text-[15px]">
              <span className="text-neutral-600">Your offer</span>
              <Money sats={content.fareSats} className="font-bold" />
            </div>
          )}
        </div>
        {content.fareSats > 0 && !scheduled && (
          editing ? (
            <div className="mt-3 rounded-2xl bg-neutral-100 px-4 py-3">
              <PriceStepper usd={draft} suggestedUsd={suggestedUsd} onChange={setDraft} label="New offer in dollars" />
              <div className="flex gap-2 mt-3">
                <Button variant="outline" size="md" onClick={() => { setEditing(false); setDraft(offerNow); }}>Keep ${offerNow}</Button>
                <Button
                  size="md"
                  disabled={draft === offerNow}
                  onClick={() => { raiseOffer(request, usdToSats(clampOffer(draft, suggestedUsd), rate)); setEditing(false); }}
                >
                  Update offer
                </Button>
              </div>
            </div>
          ) : (
            waited > 30 && (
              <button type="button" onClick={() => { setDraft(Math.min(offerNow + 2, offerNow * 3)); setEditing(true); }} className="mt-3 text-sm font-semibold underline">
                No replies yet? Change your offer
              </button>
            )
          )
        )}
        <Button variant="secondary" className="mt-4" onClick={onCancel}>Cancel request</Button>
      </Sheet>
    </MapPage>
  );
}

function ChooseDriver({ request, trip, offers, onPick, onCancel, top }) {
  const { drivers, genderPref } = useRider();
  const { btcUsd } = useApp();
  const content = parse(request) || {};
  const etas = offers.map((o) => parse(o).etaMinutes || 0);
  const prices = offers.map((o) => parse(o).priceSats);
  const fastest = offers.length > 1 ? Math.min(...etas) : null;
  const cheapest = offers.length > 1 && new Set(prices).size > 1 ? Math.min(...prices) : null;
  return (
    <MapPage map={<MapView pickup={trip.pickup} cars={drivers} fitKey={request.id} padBottom={420} />} top={top}>
      <Sheet label="Choose your driver">
        <h2 className="text-2xl font-bold">{offers.length === 1 ? "A driver can take you" : `${offers.length} drivers can take you`}</h2>
        <p className="text-neutral-600 text-[15px] mt-0.5 mb-2">
          Your offer: <span className="font-semibold">{moneyText(content.fareSats, btcUsd)}</span>. Some drivers may ask for more. Pick one to continue. You pay only after you choose.
        </p>
        <GenderPref className="mb-2" />
        <ul className="divide-y divide-neutral-100">
          {offers.map((o, i) => {
            const c = parse(o);
            const kind = replyKind(c.priceSats, content.fareSats);
            const preferred = !!genderPref && offerGender(o) === genderPref;
            return (
              <li key={o.id} className="py-3">
                <DriverInfo pubkey={o.pubkey} offerEvent={o} compact />
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">
                      {c.etaMinutes} min away
                      {fastest != null && c.etaMinutes === fastest && <span className="ml-2 text-[11px] bg-black text-white rounded-full px-2 py-0.5 align-middle">Fastest</span>}
                      {cheapest != null && c.priceSats === cheapest && <span className="ml-1.5 text-[11px] bg-[#e6f4ec] text-[#05683a] rounded-full px-2 py-0.5 align-middle">Lowest price</span>}
                      {preferred && <span className="ml-1.5 text-[11px] bg-neutral-100 text-neutral-700 rounded-full px-2 py-0.5 align-middle">Your preference</span>}
                    </p>
                    <p className="text-sm">
                      <Money sats={c.priceSats} className="font-semibold" />
                    </p>
                    <p className={`text-xs ${kind === "counter" ? "text-amber-700" : "text-[#05683a]"}`}>
                      {kind === "counter"
                        ? `Counter-offer: ${moneyText(c.priceSats - content.fareSats, btcUsd)} more than your offer`
                        : kind === "lower"
                        ? "Lower than your offer"
                        : "Accepts your price"}
                    </p>
                  </div>
                  <Button size="sm" full={false} onClick={() => onPick(o)}>Choose</Button>
                </div>
              </li>
            );
          })}
        </ul>
        <Button variant="secondary" size="md" className="mt-2" onClick={onCancel}>Cancel request</Button>
      </Sheet>
    </MapPage>
  );
}

function PayDeposit({ request, trip, offer, onBack }) {
  const { liveTick } = useApp();
  const { confirmDriver, drivers } = useRider();
  const c = parse(offer);
  const driver = getProfile(offer.pubkey);
  const [done, setDone] = useState(false);
  const busy = useRef(false);
  void liveTick; // the driver's Lightning address arrives with their profile
  const upfront = c.upfrontSats || 0;
  const rest = Math.max(0, c.priceSats - upfront);

  const go = (proof) => {
    if (busy.current) return;
    busy.current = true;
    setDone(true);
    confirmDriver(request, offer, proof);
  };

  return (
    <MapPage map={<MapView pickup={trip.pickup} cars={drivers} fitKey={request.id} padBottom={460} />}
      top={<FloatButton icon="chevron-left" label="Choose a different driver" onClick={onBack} />}>
      <Sheet label="Confirm your driver">
        <h2 className="text-2xl font-bold mb-3">Confirm your driver</h2>
        <DriverInfo pubkey={offer.pubkey} offerEvent={offer} />
        <dl className="mt-4 rounded-2xl bg-neutral-100 px-4 py-3 space-y-2 text-[15px]">
          <div className="flex justify-between"><dt className="text-neutral-600">Fare</dt><dd><Money sats={c.priceSats} className="font-semibold" /></dd></div>
          {upfront > 0 && (
            <>
              <div className="flex justify-between"><dt className="font-semibold">Deposit due now</dt><dd><Money sats={upfront} className="font-bold" /></dd></div>
              <div className="flex justify-between"><dt className="text-neutral-600">Rest, after the trip</dt><dd><Money sats={rest} /></dd></div>
            </>
          )}
        </dl>
        {upfront > 0 && (
          <p className="text-neutral-500 text-xs mt-2">
            The deposit goes straight to the driver over Lightning (no escrow). It covers their drive to you and is
            not refunded if you cancel after they are on the way.
          </p>
        )}
        <div className="mt-4">
          {upfront === 0 ? (
            <Button variant="go" onClick={() => go({ verified: false })} loading={done}>Confirm driver</Button>
          ) : (
            <PayDriver amountSats={upfront} address={driver?.lud16} memo="NostrRide deposit" onPaid={go} />
          )}
        </div>
      </Sheet>
    </MapPage>
  );
}
