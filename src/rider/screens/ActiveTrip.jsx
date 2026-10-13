// ════════════════════════════════════════════════════════════
//  ACTIVE TRIP (before pickup) — What the rider sees after requesting:
//    Searching     "Finding your driver…" while no one has replied; with a flat
//                  price the rider can raise it
//    ChooseDriver  drivers who accepted (their standard fare, or the flat price)
//                  or countered it (preferred gender first if the rider asked, then fastest)
//    ConfirmDriver the chosen driver's terms and the rider's ecash balance. There is no deposit:
//                  the rider pays tick by tick once the ride starts.
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
import { offerLimitsSats, replyKind } from "../../lib/fare.js";
import { normalizeTerms, unitSats } from "../../lib/ticks.js";
import Icon from "../../ui/Icon.jsx";
import { isMintUrl } from "../../lib/mints.js";
import MapView from "../../ui/MapView.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import AmountInput from "../../ui/AmountInput.jsx";
import Button from "../../ui/Button.jsx";
import { MapPage, Sheet, FloatButton } from "../../ui/Layout.jsx";
import { ConfirmDialog } from "../../ui/Parts.jsx";
import AddFunds from "../../features/payments/AddFunds.jsx";
import FareTerms, { offerRates, RatesLine } from "../components/FareTerms.jsx";
import DriverInfo from "../components/DriverInfo.jsx";
import GenderPref from "../components/GenderPref.jsx";
import OnTrip from "./OnTrip.jsx";
import { useOutboxAge } from "../../ui/ConnectionBanner.jsx";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
export const whenText = (time) => (time === "ASAP" ? "Now" : new Date(time).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }));

const STUCK_MS = 15000; // how long the request must have waited before we say so

export default function ActiveTrip({ request }) {
  const { user, liveTick, isBlockedPk } = useApp();
  const { finishRide, focused, focusRide, genderPref, declineOffer } = useRider();
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
  const closeDialog = (
    <ConfirmDialog
      open={asking}
      title="Close this request?"
      message="Drivers will stop seeing your request. Nothing is owed."
      confirmLabel="Close request"
      cancelLabel="Keep looking"
      danger
      onConfirm={() => { setAsking(false); focusRide(null); finishRide(request); }}
      onCancel={() => setAsking(false)}
    />
  );

  if (chosen) {
    return <ConfirmDriver request={request} trip={trip} offer={chosen} onBack={() => setPicked(null)} onDecline={() => { setPicked(null); declineOffer(request, chosen); }} />;
  }
  if (offers.length) {
    return (
      <>
        <ChooseDriver request={request} trip={trip} offers={offers} onPick={(o) => setPicked(o.id)} onDecline={(o) => declineOffer(request, o)} onCancel={() => setAsking(true)} top={back} />
        {closeDialog}
      </>
    );
  }
  return (
    <>
      <Searching request={request} trip={trip} onCancel={() => setAsking(true)} top={back} />
      {closeDialog}
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
  const { drivers, raiseOffer } = useRider();
  // The request is "stuck" only while it is STILL waiting in the outbox after several tries (never a one-time failure that a retry fixed).
  const stuck = useOutboxAge(request.id) >= STUCK_MS;
  const { btcPrice } = useApp();
  const content = parse(request) || {};
  const [editing, setEditing] = useState(false);
  const { usdPrice } = useApp();
  const flat = content.fareMode === "flat";
  const offerNow = content.fareSats > 0 ? content.fareSats : 0;
  const suggestedNow = content.suggestedSats > 0 ? content.suggestedSats : offerNow;
  const limits = offerLimitsSats(suggestedNow, usdPrice);
  const [draft, setDraft] = useState(offerNow); // null while the field is empty
  const draftOk = Number.isFinite(draft) && draft >= limits.min && draft <= limits.max && draft !== offerNow;
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
        {stuck && (
          <p className="text-amber-700 text-sm bg-amber-50 rounded-xl px-3 py-2 mt-3" role="status">
            Your request is still waiting to be sent. We keep trying, and it goes out as soon as a relay answers. If this stays, check your connection or your relays in Account.
          </p>
        )}
        <div className="mt-4 pt-4 border-t border-neutral-100">
          <TripLines trip={trip} />
          {content.fareSats > 0 && (
            <div className="flex items-center justify-between mt-3 text-[15px]">
              <span className="text-neutral-600">{flat ? "Your flat price" : "Standard fare, about"}</span>
              <Money sats={content.fareSats} className="font-bold" />
            </div>
          )}
        </div>
        {flat && content.fareSats > 0 && !scheduled && (
          editing ? (
            <div className="mt-3 rounded-2xl bg-neutral-100 px-4 py-3">
              <AmountInput sats={draft} rate={btcPrice} min={limits.min} max={limits.max} onChange={setDraft} label="New price" />
              <div className="flex gap-2 mt-3">
                <Button variant="outline" size="md" onClick={() => { setEditing(false); setDraft(offerNow); }}>Keep {moneyText(offerNow, btcPrice)}</Button>
                <Button size="md" disabled={!draftOk} onClick={() => { raiseOffer(request, Math.round(draft)); setEditing(false); }}>
                  Update price
                </Button>
              </div>
            </div>
          ) : (
            waited > 30 && (
              <button type="button" onClick={() => { setDraft(Math.min(limits.max, Math.round(offerNow * 1.15))); setEditing(true); }} className="mt-3 text-sm font-semibold underline">
                No replies yet? Change your price
              </button>
            )
          )
        )}
        <Button variant="secondary" className="mt-4" onClick={onCancel}>Close request</Button>
      </Sheet>
    </MapPage>
  );
}

function ChooseDriver({ request, trip, offers, onPick, onDecline, onCancel, top }) {
  const { drivers, genderPref } = useRider();
  const { btcPrice } = useApp();
  const content = parse(request) || {};
  const flat = content.fareMode === "flat";
  const etas = offers.map((o) => parse(o).etaMinutes || 0);
  const prices = offers.map((o) => parse(o).priceSats);
  const fastest = offers.length > 1 ? Math.min(...etas) : null;
  const cheapest = offers.length > 1 && new Set(prices).size > 1 ? Math.min(...prices) : null;
  return (
    <MapPage map={<MapView pickup={trip.pickup} cars={drivers} fitKey={request.id} padBottom={420} />} top={top}>
      <Sheet label="Choose your driver">
        <h2 className="text-2xl font-bold">{offers.length === 1 ? "A driver can take you" : `${offers.length} drivers can take you`}</h2>
        <p className="text-neutral-600 text-[15px] mt-0.5 mb-2">
          {flat
            ? <>Your flat price: <span className="font-semibold">{moneyText(content.fareSats, btcPrice)}</span>. Some drivers may ask for more. </>
            : <>You pay each driver's own rates as you ride. </>}
          Pick one to continue, or tap "No thanks" to turn a driver down: your request stays open for other drivers. Nothing is paid until the ride starts.
        </p>
        <GenderPref className="mb-2" />
        <ul className="divide-y divide-neutral-100">
          {offers.map((o, i) => {
            const c = parse(o);
            const kind = flat ? replyKind(c.priceSats, content.fareSats) : "same";
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
                      {!(c.mode === "flat") && <span className="text-neutral-500 text-xs mr-1">about</span>}
                      <Money sats={c.priceSats} className="font-semibold" />
                    </p>
                    <FareTerms offer={c} className="mt-0.5" />
                    {flat && (
                      <p className={`text-xs mt-0.5 ${kind === "counter" ? "text-amber-700" : "text-[#05683a]"}`}>
                        {kind === "counter"
                          ? `Counter-offer: ${moneyText(c.priceSats - content.fareSats, btcPrice)} more than your price`
                          : kind === "lower"
                          ? "Lower than your price"
                          : "Accepts your price"}
                      </p>
                    )}
                  </div>
                  <Button size="sm" variant="secondary" full={false} onClick={() => onDecline(o)} aria-label="Turn down this driver">No thanks</Button>
                  <Button size="sm" full={false} onClick={() => onPick(o)}>Choose</Button>
                </div>
              </li>
            );
          })}
        </ul>
        <Button variant="secondary" size="md" className="mt-2" onClick={onCancel}>Close request</Button>
      </Sheet>
    </MapPage>
  );
}

// What the rider needs in the ecash wallet before the ride can start: the base rate, two minutes and a mile, so the
// first payments are never late. (The whole ride is not locked away: it is paid as it is used.)
function startFunds(c, btcPrice) {
  const rates = offerRates(c);
  const terms = rates && normalizeTerms({ mode: c.mode === "flat" ? "flat" : "metered", currency: rates.currency, base: rates.base, perMile: rates.perMile, perMinute: rates.perMinute, flatSats: c.priceSats, tripMiles: c.tripMiles, tripMinutes: c.tripMinutes });
  const per = terms && unitSats(terms, btcPrice);
  return per ? per.base + 2 * per.minute + per.mile : null;
}

function ConfirmDriver({ request, trip, offer, onBack, onDecline }) {
  const { liveTick, ecash, prices, priceFor, btcPrice } = useApp();
  const { confirmDriver, drivers } = useRider();
  const c = parse(offer);
  const [done, setDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const busy = useRef(false);
  void liveTick; // the balance changes when funds arrive
  const rates = offerRates(c);
  const mint = isMintUrl(c.mint) ? c.mint : null;
  const price = rates ? priceFor(rates.currency) : null;
  const need = c.mode === "flat" ? startFunds(c, null) : startFunds(c, price);
  const have = ecash && mint ? ecash.balance(mint) : 0;
  const short = need != null ? Math.max(0, need - have) : 0;
  const ready = !!rates && !!mint && need != null && short === 0;
  void prices;

  const go = () => {
    if (busy.current || !ready) return;
    busy.current = true;
    setDone(true);
    confirmDriver(request, offer);
  };

  return (
    <MapPage map={<MapView pickup={trip.pickup} cars={drivers} fitKey={request.id} padBottom={500} />}
      top={<FloatButton icon="chevron-left" label="Choose a different driver" onClick={onBack} />}>
      <Sheet label="Confirm your driver">
        <h2 className="text-2xl font-bold mb-3">Confirm your driver</h2>
        <DriverInfo pubkey={offer.pubkey} offerEvent={offer} />
        <dl className="mt-4 rounded-2xl bg-neutral-100 px-4 py-3 space-y-2 text-[15px]">
          <div className="flex justify-between"><dt className="text-neutral-600">{c.mode === "flat" ? "Flat price" : "Estimated fare"}</dt><dd><Money sats={c.priceSats} className="font-semibold" /></dd></div>
          {c.mode !== "flat" && rates && (
            <div className="text-xs text-neutral-600"><RatesLine rates={rates} /></div>
          )}
          {need != null && <div className="flex justify-between"><dt className="text-neutral-600">Needed to start</dt><dd><Money sats={need} /></dd></div>}
          {mint && <div className="flex justify-between"><dt className="text-neutral-600">Your ecash here</dt><dd><Money sats={have} className={short ? "text-amber-700 font-semibold" : ""} /></dd></div>}
        </dl>
        <p className="text-neutral-500 text-xs mt-2">
          {c.mode === "flat"
            ? "You pay the flat price tick by tick as you ride, and never more, even in traffic. Adding a stop or changing the destination turns it into the driver's normal fare, counted from the start."
            : "You pay as you ride: the base rate when the ride starts, then each mile and each minute. You can finish the ride at any time and pay only for what you used."}
          {" "}If you miss two payments in a row, the driver may finish the ride. There is no deposit.
        </p>
        {!rates || !mint ? (
          <p className="text-amber-700 text-sm mt-3" role="alert">This driver's reply is missing its rates or its ecash mint, so it cannot be used. Choose another driver.</p>
        ) : need == null ? (
          <p className="text-amber-700 text-sm mt-3" role="alert">The bitcoin price for {rates.currency} is not available yet. Try again in a moment.</p>
        ) : null}
        <div className="mt-4 space-y-2">
          {short > 0 && mint && (
            <Button onClick={() => setAdding(true)} disabled={!ecash}><Icon name="zap" size={18} /> Add {moneyText(short, btcPrice)} to your wallet</Button>
          )}
          <Button variant="go" onClick={go} loading={done} disabled={!ready}>Confirm driver</Button>
          {!done && <Button variant="secondary" onClick={onDecline}>Not this driver</Button>}
          {!done && <p className="text-neutral-500 text-xs text-center">Your request stays open. Other drivers can still accept it.</p>}
        </div>
        {adding && mint && <AddFunds mint={mint} needSats={short} onClose={() => setAdding(false)} />}
      </Sheet>
    </MapPage>
  );
}
