// ════════════════════════════════════════════════════════════
//  ACTIVE TRIP (before pickup) — What the rider sees after requesting:
//    Searching     "Finding your driver…" while no one has replied (a request sent to every driver nearby)
//    Asked         a request the rider sent to chosen drivers (list, map, or "Notify nearest driver immediately") while none has accepted:
//                  who was asked, who declined, and the list/map to ask another driver (components/DriverBrowser.jsx)
//    ChooseDriver  drivers who accepted, each with their own rates (only the preferred gender if the rider asked, then fastest)
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
import { offersForRide, onlyPreferredOffers, isDirected, driverDeclines, declinedDrivers } from "../../lib/trips.js";
import { getAudience } from "../../lib/audienceStore.js";
import { rememberRates, seenRates, ratesChanged, rateDirection } from "../../lib/ratechange.js";
import DriverBrowser from "../components/DriverBrowser.jsx";
import { offerEstimate } from "../../lib/fare.js";
import { normalizeTerms, unitSats } from "../../lib/ticks.js";
import Icon from "../../ui/Icon.jsx";
import { isMintUrl, mintLabel } from "../../lib/mints.js";
import { isKnownMint, trustMint } from "../../features/ecash/myMint.js";
import MapView from "../../ui/MapView.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import { MapPage, Sheet, FloatButton, StickyActions } from "../../ui/Layout.jsx";
import { ConfirmDialog } from "../../ui/Parts.jsx";
import AddFunds from "../../features/payments/AddFunds.jsx";
import FareTerms, { offerRates, RatesLine } from "../components/FareTerms.jsx";
import DriverInfo from "../components/DriverInfo.jsx";
import GenderPref from "../components/GenderPref.jsx";
import OnTrip from "./OnTrip.jsx";
import { WalletPrompt } from "../../features/ecash/WalletStart.jsx";
import { useOutboxAge } from "../../ui/ConnectionBanner.jsx";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
export const whenText = (time) => (time === "ASAP" ? "Now" : new Date(time).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }));

const STUCK_MS = 15000; // how long the request must have waited before we say so

export default function ActiveTrip({ request }) {
  const { user, liveTick, isBlockedPk } = useApp();
  const { finishRide, focused, focusRide, genderPref, declineOffer, drivers, notifyDriver } = useRider();
  const [picked, setPicked] = useState(null); // the driver being confirmed (their newest offer is shown: a driver may change it)
  const [asking, setAsking] = useState(false);
  const [browsing, setBrowsing] = useState(false); // ask another driver, although a reply is already here
  void liveTick;

  const content = parse(request) || {};
  const trip = exactTrip(request, user) || content; // exact for the rider; coarse as a fallback
  const status = rideStatus(request);

  if (status === "in_progress") return <OnTrip request={request} trip={trip} />;

  // Never show a blocked driver. With "Female only" / "Male only" only the drivers who declared that gender stay.
  const offers = onlyPreferredOffers(offersForRide(request).filter((o) => !isBlockedPk(o.pubkey)), genderPref);
  const chosen = offers.find((o) => o.pubkey === picked);
  const d = (request.tags.find((t) => t[0] === "d") || [])[1];
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

  // A request sent to chosen drivers: who was asked, who said no, and the list / map to ask another driver.
  const directed = isDirected(request);
  const showAsked = directed && (!offers.length || browsing);
  if (showAsked) {
    const content = parse(request) || {};
    const tripMiles = { miles: Number(content.distanceMiles) || 0, minutes: Number(content.durationMin) || 0 };
    const said = driverDeclines(request), turnedDown = declinedDrivers(request);
    const replied = new Set(offers.map((o) => o.pubkey));
    const asked = new Set(getAudience(d));
    const status = {};
    for (const x of drivers) {
      if (said.has(x.pubkey)) status[x.pubkey] = "declined";
      else if (turnedDown.has(x.pubkey)) status[x.pubkey] = "passed";
      else if (asked.has(x.pubkey)) status[x.pubkey] = "waiting";
    }
    const waitingNames = drivers.filter((x) => status[x.pubkey] === "waiting" && !replied.has(x.pubkey)).map((x) => x.name || "A driver");
    const intro = waitingNames.length
      ? `Waiting for a reply from ${waitingNames.join(", ")}. You can ask another driver too.`
      : said.size
        ? "That driver declined. Choose another driver."
        : "Choose a driver to ask. They can accept or decline.";
    return (
      <>
        <DriverBrowser
          pickup={trip.pickup}
          drivers={drivers.filter((x) => !replied.has(x.pubkey))}
          trip={tripMiles}
          status={status}
          onRequest={(pk) => notifyDriver(request, pk, drivers.find((x) => x.pubkey === pk)?.rates)}
          title="Choose a driver"
          intro={intro}
          fitKey={request.id}
          top={back}
          footer={
            <div className="mt-3 space-y-2">
              {offers.length > 0 && <Button size="md" onClick={() => setBrowsing(false)}>See replies ({offers.length})</Button>}
              <Button variant="secondary" size="md" onClick={() => setAsking(true)}>Close request</Button>
            </div>
          }
        />
        {closeDialog}
      </>
    );
  }
  if (offers.length) {
    return (
      <>
        <ChooseDriver request={request} trip={trip} offers={offers} onPick={(o) => setPicked(o.pubkey)} onDecline={(o) => declineOffer(request, o)} onCancel={() => setAsking(true)} onAskMore={directed ? () => setBrowsing(true) : null} top={back} />
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
  const { drivers } = useRider();
  // The request is "stuck" only while it is STILL waiting in the outbox after several tries (never a one-time failure that a retry fixed).
  const stuck = useOutboxAge(request.id) >= STUCK_MS;
  const content = parse(request) || {};
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
              <span className="text-neutral-600">Standard fare, about</span>
              <Money sats={content.fareSats} className="font-bold" />
            </div>
          )}
        </div>
        <Button variant="secondary" className="mt-4" onClick={onCancel}>Close request</Button>
      </Sheet>
    </MapPage>
  );
}

function ChooseDriver({ request, trip, offers, onPick, onDecline, onCancel, onAskMore = null, top }) {
  const { drivers } = useRider();
  const dTag = (request.tags.find((t) => t[0] === "d") || [])[1];
  const { prices: btcPrices } = useApp();
  const requestContent = parse(request);
  // The price shown is OUR estimate from the driver's rates and the trip, never the driver's own `priceSats` (lib/fare.js offerEstimate).
  const estimates = new Map(offers.map((o) => [o.id, offerEstimate(parse(o), requestContent, btcPrices)]));
  const etas = offers.map((o) => parse(o).etaMinutes || 0);
  const prices = offers.map((o) => estimates.get(o.id)).filter((x) => x != null);
  const fastest = offers.length > 1 ? Math.min(...etas) : null;
  const cheapest = prices.length > 1 && new Set(prices).size > 1 ? Math.min(...prices) : null;
  return (
    <MapPage map={<MapView pickup={trip.pickup} cars={drivers} fitKey={request.id} padBottom={420} />} top={top}>
      <Sheet label="Choose your driver">
        <h2 className="text-2xl font-bold">{offers.length === 1 ? "A driver can take you" : `${offers.length} drivers can take you`}</h2>
        <p className="text-neutral-600 text-[15px] mt-0.5 mb-2">
          You pay each driver's own rates as you ride. Pick one to continue, or tap "No thanks" to turn a driver down: your request stays open for other drivers. Nothing is paid until the ride starts.
        </p>
        <GenderPref className="mb-2" />
        <ul className="divide-y divide-neutral-100">
          {offers.map((o, i) => {
            const c = parse(o);
            const changed = ratesChanged(seenRates(dTag, o.pubkey), c.rates); // the rider saw other rates next to this driver when asking
            return (
              <li key={o.id} className="py-3">
                <DriverInfo pubkey={o.pubkey} offerEvent={o} compact />
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">
                      {c.etaMinutes} min away
                      {fastest != null && c.etaMinutes === fastest && <span className="ml-2 text-[11px] bg-black text-white rounded-full px-2 py-0.5 align-middle">Fastest</span>}
                      {cheapest != null && estimates.get(o.id) === cheapest && <span className="ml-1.5 text-[11px] bg-[#e6f4ec] text-[#05683a] rounded-full px-2 py-0.5 align-middle">Lowest price</span>}
                      {changed && <span className="ml-1.5 text-[11px] bg-amber-50 text-amber-800 rounded-full px-2 py-0.5 align-middle">Rates changed</span>}
                    </p>
                    {estimates.get(o.id) != null && (
                      <p className="text-sm">
                        <span className="text-neutral-500 text-xs mr-1">about</span>
                        <Money sats={estimates.get(o.id)} className="font-semibold" />
                      </p>
                    )}
                    <FareTerms offer={c} className="mt-0.5" />
                  </div>
                  <Button size="sm" variant="secondary" full={false} onClick={() => onDecline(o)} aria-label="Turn down this driver">No thanks</Button>
                  <Button size="sm" full={false} onClick={() => onPick(o)}>Choose</Button>
                </div>
              </li>
            );
          })}
        </ul>
        {onAskMore && <Button variant="secondary" size="md" className="mt-2" onClick={onAskMore}>Ask another driver</Button>}
        <Button variant="secondary" size="md" className="mt-2" onClick={onCancel}>Close request</Button>
      </Sheet>
    </MapPage>
  );
}

// What the rider needs in the ecash wallet before the ride can start: the base rate, two minutes and a mile (a small
// cushion, so the first payments are never late). The whole ride is not locked away: it is paid as it is used.
// Returns the parts too, so the confirm screen can show the sum.
function startParts(c, price) {
  const rates = offerRates(c);
  const terms = rates && normalizeTerms({ currency: rates.currency, base: rates.base, perMile: rates.perMile, perMinute: rates.perMinute });
  const per = terms && unitSats(terms, price);
  return per ? { base: per.base, minutes: 2 * per.minute, mile: per.mile, total: per.base + 2 * per.minute + per.mile } : null;
}

function ConfirmDriver({ request, trip, offer, onBack, onDecline }) {
  const { liveTick, ecash, ecashOff, prices, priceFor, btcPrice } = useApp();
  const { confirmDriver, drivers } = useRider();
  const c = parse(offer);
  const estimate = offerEstimate(c, parse(request), prices); // from the driver's rates and the trip, not the driver's own `priceSats`
  const [done, setDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const busy = useRef(false);
  // The driver may change their rates while the rider decides (a new offer replaces the old one). The rider must see that before accepting:
  // `baseline` = the rates the rider last saw for this driver; when the rates in front of the rider differ, a popup stops the confirm (lib/ratechange.js).
  const dTag = (request.tags.find((t) => t[0] === "d") || [])[1];
  const nowRates = offerRates(c);
  const [baseline, setBaseline] = useState(() => seenRates(dTag, offer.pubkey) || nowRates);
  const rateChange = ratesChanged(baseline, nowRates);
  const acceptNewRates = () => { rememberRates(dTag, offer.pubkey, nowRates); setBaseline(nowRates); };
  void liveTick; // the balance changes when funds arrive
  const rates = offerRates(c);
  const mint = isMintUrl(c.mint) ? c.mint : null;
  const price = rates ? priceFor(rates.currency) : null;
  const parts = startParts(c, price);
  const need = parts ? parts.total : null;
  const have = ecash && mint ? ecash.balance(mint) : 0;
  const short = need != null ? Math.max(0, need - have) : 0;
  const ready = !!rates && !!mint && need != null && short === 0 && !ecashOff && !rateChange;
  // The driver chose this mint. One the rider has never used is not trusted on the driver's word (features/ecash/myMint.js).
  const unknownMint = !!mint && !trusted && !isKnownMint(mint, ecash);
  void prices;

  const go = () => {
    if (busy.current || !ready || rateChange) return;
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
          {estimate != null && <div className="flex justify-between"><dt className="text-neutral-600">Estimated fare</dt><dd><Money sats={estimate} className="font-semibold" /></dd></div>}
          {rates && (
            <div className="text-xs text-neutral-600"><RatesLine rates={rates} /></div>
          )}
          {need != null && <div className="flex justify-between"><dt className="text-neutral-600">Needed to start</dt><dd><Money sats={need} /></dd></div>}
          {parts && (
            <div className="text-xs text-neutral-600">
              The base rate {moneyText(parts.base, btcPrice)} + 2 minutes {moneyText(parts.minutes, btcPrice)} + 1 mile {moneyText(parts.mile, btcPrice)}. The extra minute is a cushion, so your first payments are never late. Nothing is locked away.
            </div>
          )}
          {mint && <div className="flex justify-between"><dt className="text-neutral-600">Your ecash at {mintLabel(mint)}</dt><dd><Money sats={have} className={short ? "text-amber-700 font-semibold" : ""} /></dd></div>}
        </dl>
        <p className="text-neutral-500 text-xs mt-2">
          You pay as you ride: the base rate when the ride starts, then each mile and each minute. You can finish the ride at any time and pay only for what you used.
          {" "}If you miss two payments in a row, the driver may finish the ride. There is no deposit.
        </p>
        {unknownMint && (
          <div className="mt-3 rounded-xl bg-amber-50 text-amber-800 px-3 py-2" role="alert">
            <p className="text-sm font-semibold">This driver is paid at {mintLabel(mint)}, a mint you have not used.</p>
            <p className="text-xs mt-0.5">A mint holds the money you put into it, and the driver chose this one. If the mint is not honest, you can lose what you add there. Add funds only if you trust it.</p>
            <Button size="md" variant="secondary" className="mt-2" onClick={() => { trustMint(mint); setTrusted(true); }}>I trust this mint</Button>
          </div>
        )}
        {!rates || !mint ? (
          <p className="text-amber-700 text-sm mt-3" role="alert">This driver's reply is missing its rates or its ecash mint, so it cannot be used. Choose another driver.</p>
        ) : ecashOff ? (
          <WalletPrompt className="mt-3" />
        ) : need == null ? (
          <p className="text-amber-700 text-sm mt-3" role="alert">The bitcoin price for {rates.currency} is not available yet. Try again in a moment.</p>
        ) : null}
        <StickyActions className="mt-4 space-y-2">
          {short > 0 && mint && (
            <Button onClick={() => setAdding(true)} disabled={!ecash || unknownMint}><Icon name="zap" size={18} /> Add {moneyText(short, btcPrice)} to your wallet</Button>
          )}
          <Button variant="go" onClick={go} loading={done} disabled={!ready}>Confirm driver</Button>
        </StickyActions>
        <div className="mt-1 space-y-2">
          {!done && <Button variant="secondary" onClick={onDecline}>Not this driver</Button>}
          {!done && <p className="text-neutral-500 text-xs text-center">Your request stays open. Other drivers can still accept it.</p>}
        </div>
        {adding && mint && <AddFunds mint={mint} needSats={short} onClose={() => setAdding(false)} />}
        <ConfirmDialog
          open={rateChange && !done}
          title={`${getProfile(offer.pubkey)?.name || "This driver"} changed their rates`}
          danger={rateDirection(baseline, nowRates, parse(request)?.distanceMiles, parse(request)?.durationMin) === "higher"}
          confirmLabel="Continue with the new rates"
          cancelLabel="Choose a different driver"
          message={
            <span>
              <span className="block">Before: <RatesLine rates={baseline} /></span>
              <span className="block font-semibold text-black">Now: <RatesLine rates={nowRates} /></span>
              {(() => {
                const before = offerEstimate({ rates: baseline }, parse(request), prices), after = estimate;
                return before != null && after != null ? <span className="block mt-1">Estimated fare: {moneyText(before, btcPrice)} before, {moneyText(after, btcPrice)} now.</span> : null;
              })()}
              <span className="block mt-1">Nothing was paid. Continue only if the new rates are fine with you.</span>
            </span>
          }
          onConfirm={acceptNewRates}
          onCancel={onBack}
        />
      </Sheet>
    </MapPage>
  );
}
