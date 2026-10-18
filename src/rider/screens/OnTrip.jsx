// ════════════════════════════════════════════════════════════
//  ON TRIP — The rider's screen once a driver is confirmed. The driver
//  moves it forward with signed stage markers (lib/rides.js rideStage):
//    enroute  driver is driving to the pickup (live car on the map)
//    arrived  driver is at the pickup
//    riding   trip underway to the dropoff
//  The driver's exact position arrives end-to-end encrypted
//  (subscribeRideLocation) and is only ever shown to this rider.
//  Starting: when the rider is at the car, the DRIVER's phone shows a 4-digit code and the rider
//  types it here (lib/startcode.js); the driver types nothing.
//  Paying: from the start, the rider's app pays the driver in ecash ticks (the base rate, then
//  each mile and each minute). The screen shows what the ride has cost so far.
//  Either person can "Finish ride" (after a confirmation). There are no cancellations and no fees:
//  the rider pays only what the ride earned. The rider can add a stop or change the destination.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { startCode, checkCode, attemptGate, recordAttempt } from "../../lib/startcode.js";
import { arrivalMismatch } from "../../lib/arrival.js";
import { fullTrip, nextStop, stopChanges, readStop } from "../../lib/stops.js";
import { rideTerms } from "../../lib/terms.js";
import { milesAtTime } from "../../lib/ridemoney.js";
import { rideKey } from "../../lib/rides.js";
import { ARRIVE_RADIUS_METERS, LOCATION_PING_MS } from "../../config/settings.js";
import { sharePayload } from "../../lib/safety.js";
import { getSetting, setSetting } from "../../config/relays.js";
import { useRideLink } from "../../features/payments/useRideLink.js";
import AddFunds from "../../features/payments/AddFunds.jsx";
import AddStop from "../components/AddStop.jsx";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { subscribeRideLocation } from "../../nostr/live.js";
import { haversineDistance } from "../../lib/geo.js";
import { pickupEta, isLowBalance, offerEstimate } from "../../lib/fare.js";
import { rideConfirm, rideDriver, rideStage, rideTimes } from "../../lib/rides.js";
import { offerPlate } from "../../lib/privacy.js";
import { offerFrom } from "../../lib/trips.js";
import MapView from "../../ui/MapView.jsx";
import Button from "../../ui/Button.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import Icon from "../../ui/Icon.jsx";
import ContactSheet from "../../ui/ContactSheet.jsx";
import { MapPage, Sheet } from "../../ui/Layout.jsx";
import { ConfirmDialog } from "../../ui/Parts.jsx";
import DriverInfo, { Plate, useDriverInfo, carText } from "../components/DriverInfo.jsx";
import SafetySheet from "../components/SafetySheet.jsx";
import Avatar from "../../ui/Avatar.jsx";
import ChangePickup from "../components/ChangePickup.jsx";
import { pickupChange, PICKUP_CHANGE_NOTE } from "../../lib/pickup.js";
import { meterView } from "../../lib/meter.js";
import FareBreakdown from "../../ui/FareBreakdown.jsx";
import { EstimatedTotal, ChangeEstimate } from "../../ui/FareEstimate.jsx";
import { publishMeter } from "../../nostr/live.js";
import TripMeter, { peekMeter } from "../../ui/TripMeter.jsx";
import { useRiderMeter } from "../state/useRiderMeter.js";
import { readPickup } from "../../lib/privacy.js";

const r3 = (n) => Math.round(n * 1000) / 1000; // ~110 m: limits how often the route is re-fetched
const miles = (a, b) => haversineDistance(a.lat, a.lng, b.lat, b.lng);

export default function OnTrip({ request, trip }) {
  const { user, pushNotice, btcPrice, usdPrice, ecash, prices } = useApp();
  const { finishRide, myPosition, gps, share, shareUpdate, confirmRide, money, allowMore, reportMiles, payMint, screenMayDim } = useRider();
  const driverPubkey = rideDriver(request);
  const stage = rideStage(request);
  const offer = offerFrom(request, driverPubkey);
  const { profile } = useDriverInfo(driverPubkey);
  const [loc, setLoc] = useState(null); // driver's live position
  const [contact, setContact] = useState(false);
  const [asking, setAsking] = useState(false);
  const [safety, setSafety] = useState(false);
  const [changing, setChanging] = useState(false); // the change-pickup window
  const [stopping, setStopping] = useState(false); // the add-a-stop window
  const [adding, setAdding] = useState(false); // the add-funds window
  const [typed, setTyped] = useState("");
  const [gate, setGate] = useState(null); // wrong-code tries
  const [codeMsg, setCodeMsg] = useState("");
  const [, setNow] = useState(0);
  const vehicleSeen = useRef(null);
  const [routeInfo, setRouteInfo] = useState(null); // road time from the map's route

  useEffect(() => {
    if (!driverPubkey) return;
    return subscribeRideLocation(user, driverPubkey, (l) => {
      if (l && Number.isFinite(l.lat) && Number.isFinite(l.lng)) setLoc(l);
    });
  }, [user, driverPubkey]);

  // Re-render every second: the trip clock and the waiting clock show seconds ("updated Xs ago" and the ETAs ride along).
  useEffect(() => { const id = setInterval(() => setNow((n) => n + 1), 1000); return () => clearInterval(id); }, []);

  // Tell the rider if the driver changes their car mid-ride.
  const vehicleKey = JSON.stringify(profile?.vehicle || null);
  useEffect(() => {
    if (!profile?.vehicle) return;
    if (vehicleSeen.current === null) { vehicleSeen.current = vehicleKey; return; }
    if (vehicleKey !== vehicleSeen.current) { vehicleSeen.current = vehicleKey; pushNotice("Your driver updated their vehicle details."); }
  }, [vehicleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The trip with the stops and destination change the driver accepted. While riding, the car heads for the next stop.
  const full = fullTrip(request, user);
  const stops = full?.stops || [];
  const { pickup } = trip;
  const dropoff = full?.dropoff || trip.dropoff;
  const key = rideKey(request);
  const [passed, setPassed] = useState(() => getSetting("stopsPassed", {})[key] || 0);
  useEffect(() => {
    if (stage !== "riding" || !loc || !stops[passed]) return;
    if (miles(loc, stops[passed]) * 1609.344 <= ARRIVE_RADIUS_METERS) {
      setPassed(passed + 1);
      setSetting("stopsPassed", { ...getSetting("stopsPassed", {}), [key]: passed + 1 });
    }
  }, [loc?.lat, loc?.lng, stage, stops.length, passed]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = stage === "riding" ? nextStop(stops, dropoff, passed) : pickup;
  const waypoints = stage === "riding" ? [...stops.slice(passed), dropoff] : [pickup];
  const age = loc ? Math.round((Date.now() - loc.ts) / 1000) : null;
  const live = age != null && age < 45;
  // Minutes left: the road route from the car when the router answered, else a straight-line guess.
  const toTarget = !loc ? null : routeInfo && !routeInfo.straight ? routeInfo.minutes : pickupEta(miles(loc, target));

  // Keep a shared trip current for the people following the link: the RIDER's own phone position, as often as the driver's pings (6 s).
  const plateInfo = offerPlate(offer, user);
  const carName = carText(profile?.vehicle);
  // The timer reads the latest values through a ref, so it keeps one steady beat (a moving phone must not make it send faster).
  const shareNow = useRef({});
  shareNow.current = { name: user.name, driver: profile?.name || "", car: carName, plate: plateInfo ? `${plateInfo.plateState} ${plateInfo.plateNumber}` : "", stage, riderPos: myPosition, gps, carLoc: loc, eta: toTarget, from: pickup, to: dropoff };
  useEffect(() => {
    if (!share) return;
    const send = (force) => {
      const v = shareNow.current;
      shareUpdate(sharePayload({ ...v, from: { name: v.from.name, lat: v.from.lat, lng: v.from.lng }, to: { name: v.to.name, lat: v.to.lat, lng: v.to.lng } }), { force });
    };
    send(true);
    const id = setInterval(() => send(false), LOCATION_PING_MS);
    return () => clearInterval(id);
  }, [share?.token, share?.sos, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Time and distance so far (the same on the driver's screen). The rider's own GPS figure is used inside
  // the code only (lib/meter.js); it is sent to the driver's app, so both screens agree.
  const meter = useRiderMeter({ request, stage, loc, pos: myPosition, quotedMiles: (() => { try { return JSON.parse(request.content).distanceMiles; } catch { return null; } })() });
  useEffect(() => { reportMiles(meter.tripMiles); }, [meter.tripMiles, reportMiles]);
  const view = meterView({ stage, times: rideTimes(request), nowMs: Date.now(), pickupMiles: meter.pickupMiles, tripMiles: meter.tripMiles });
  const latestMeter = useRef(meter);
  latestMeter.current = meter;
  useEffect(() => {
    if (!driverPubkey) return;
    const send = () => publishMeter(user, driverPubkey, { pm: latestMeter.current.pickupMiles, tm: latestMeter.current.tripMiles });
    send();
    const id = setInterval(send, 6000);
    return () => clearInterval(id);
  }, [driverPubkey, user]);

  const confirm = rideConfirm(request);
  const gateState = attemptGate(gate, Date.now());
  const startCodeNow = driverPubkey ? startCode(user.sk, driverPubkey, key) : ""; // the code the driver's phone shows
  const enterCode = () => {
    if (!gateState.open) return;
    const ok = checkCode(typed, startCodeNow);
    setGate(recordAttempt(gate, ok, Date.now()));
    if (ok) { confirmRide(request, "code", true); setCodeMsg(""); setTyped(""); }
    else setCodeMsg("That is not the 4-digit code on your driver's phone. Check it and try again.");
  };
  // The driver's phone going quiet is not the end of the ride; the driver is asked, not the rider. If both
  // phones were silent for 10 minutes the ride finishes at the last signal.
  const riding = stage === "riding";
  const link = useRideLink({
    request, role: "rider", otherHeardAt: loc?.ts ?? null, active: riding,
    onSilence: ({ cutoff }) => finishRide(request, { miles: milesAtTime(request, cutoff), reason: "silence", at: cutoff }),
  });
  const mismatch = stage === "arrived" && arrivalMismatch(loc, pickup);
  const pendingStop = stopChanges(request).filter((c) => c.status === "pending").pop();
  const change = pickupChange(request); // the rider's latest request to move the pickup, and the driver's answer
  const proposedName = change ? readPickup(change.proposal, request, user)?.name : null;

  const headline =
    stage === "arrived" ? "Your driver has arrived"
    : stage === "riding" ? `On the way to ${target.name}`
    : toTarget != null ? `Driver arriving in ${toTarget} min`
    : offer ? `Driver arriving in about ${JSON.parse(offer.content).etaMinutes} min`
    : "Your driver is on the way";
  const sub =
    stage === "arrived" ? `Meet at ${pickup.name}`
    : stage === "riding" ? (toTarget != null ? `About ${toTarget} min left` : "Sit back and relax")
    : `Meet at ${pickup.name}`;

  // The line always starts at the car, so it shows what is LEFT of the trip (through the stops still ahead).
  const route = loc ? [{ lat: r3(loc.lat), lng: r3(loc.lng) }, ...waypoints] : stage === "riding" ? [pickup, ...stops, dropoff] : null;
  const car = carText(profile?.vehicle);
  const contentOffer = offer ? JSON.parse(offer.content) : null;
  // Our own estimate from the driver's frozen rates and the trip (lib/fare.js offerEstimate), not the driver's `priceSats`.
  const quotedSats = contentOffer ? offerEstimate(contentOffer, (() => { try { return JSON.parse(request.content); } catch { return null; } })(), prices) : null;
  // The rider's ecash at the mint that pays this ride, live (the wallet tells the app on every change). Red at LOW_BALANCE_USD or less.
  const walletSats = ecash && payMint ? ecash.balance(payMint) : null;
  const lowWallet = walletSats != null && isLowBalance(walletSats, usdPrice);
  // The estimated total: the driver's own estimate, or (after an accepted stop / new destination) the whole new route at the driver's rates.
  const terms = rideTerms(request);
  const accepted = stopChanges(request).filter((c) => c.status === "accepted");
  const changeKinds = [...new Set(accepted.map((c) => c.mode))];
  const pendingPlace = pendingStop ? readStop(pendingStop, request, user) : null;

  return (
    <MapPage
      map={
        <MapView
          pickup={pickup}
          dropoff={dropoff}
          route={route}
          routeDashed={stage !== "riding"}
          onRoute={setRouteInfo}
          cars={loc ? [{ pubkey: driverPubkey || "driver", lat: loc.lat, lng: loc.lng }] : []}
          me={stage === "riding" ? null : myPosition}
          fitKey={`${request.id}|${stage}|${loc ? "loc" : "noloc"}`}
          padBottom={400}
          navigation
          follow={loc ? { lat: loc.lat, lng: loc.lng, id: driverPubkey || "driver" } : null}
        />
      }
    >
      {/* Nearly collapsed while riding; it opens by itself when the driver arrives (to check the car). */}
      <Sheet
        label="Your trip"
        peek={
          <div className="flex items-baseline gap-2">
            <p className="font-bold text-[17px] leading-6 truncate flex-1">{headline}</p>
            <span className="text-sm text-neutral-500 shrink-0 tabular-nums">{peekMeter(view)}</span>
          </div>
        }
        openKey={stage === "arrived" ? "arrived" : ""}
        closeKey={stage}
      >
        <h2 className="text-2xl font-bold leading-tight">{headline}</h2>
        <p className="text-neutral-600 text-[15px] mt-0.5">{sub}</p>
        {stage !== "arrived" && (
          <p className="text-xs text-neutral-500 mt-1" role="status">
            {loc ? (live ? "Live location" : `Driver's location updated ${age < 120 ? `${age}s` : `${Math.round(age / 60)} min`} ago`) : "Waiting for your driver's location…"}
          </p>
        )}

        {/* Starting the ride: the rider types the 4-digit code shown on the driver's phone. It comes FIRST, so a small phone shows it without scrolling. */}
        {stage === "arrived" && (
          <div className="mt-3 rounded-2xl border-2 border-black p-4" role="group" aria-label="Start code">
            <p className="font-bold">Start the ride</p>
            <p className="text-xs text-neutral-600 mb-3">Once you are at the car, ask your driver for the <span className="whitespace-nowrap">4-digit</span> start code on their phone and type it here.</p>
            {confirm.code?.ok ? (
              <p className="text-sm text-[#05944f] font-medium flex items-center gap-1"><Icon name="check" size={16} /> Code accepted. Waiting for your driver to start the trip.</p>
            ) : (
              <div>
                <label className="block text-sm font-semibold mb-1" htmlFor="start-code">Start code</label>
                {/* The field gets the whole row and the button sits below it: a button in the same row once squeezed the field to two digits on a phone. */}
                <input id="start-code" inputMode="numeric" autoComplete="off" maxLength={4} value={typed}
                  onChange={(e) => { setTyped(e.target.value.replace(/\D/g, "")); setCodeMsg(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enterCode(); } }}
                  placeholder="0000" className="block w-full min-w-0 bg-neutral-100 rounded-xl px-4 py-3 text-3xl text-center font-bold tracking-[0.4em] tabular-nums focus:outline-none focus:ring-2 focus:ring-black" />
                <Button size="md" className="mt-2" onClick={enterCode} disabled={typed.length !== 4 || !gateState.open}>Confirm</Button>
                {!gateState.open && <p className="text-xs text-amber-700 mt-1" role="alert">Too many tries. Wait {Math.ceil(gateState.waitMs / 1000)} s.</p>}
                {codeMsg && gateState.open && <p className="text-xs text-red-600 mt-1" role="alert">{codeMsg}</p>}
              </div>
            )}
          </div>
        )}

        <TripMeter view={view} className="mt-3" />

        <div className="mt-4 pt-4 border-t border-neutral-100">
          {driverPubkey ? <DriverInfo pubkey={driverPubkey} offerEvent={offer} /> : <p className="text-neutral-500">Driver details are loading…</p>}
          {stage === "arrived" && <p className="text-xs text-neutral-500 mt-2">Check that the plate, car and driver match before you get in. If they do not, do not get in: use Safety.</p>}
          {stage === "enroute" && car && <p className="text-xs text-neutral-500 mt-2">Look for a {car}.</p>}
        </div>

        {/* What the ride costs, tick by tick */}
        {(riding || money?.owed > 0) && (
          <div className="mt-4 rounded-2xl bg-neutral-100 px-4 py-3" role="group" aria-label="Fare so far">
            {riding && walletSats != null && (
              <div className="flex items-baseline justify-between mb-2 pb-2 border-b border-neutral-200" role="status" aria-label="Your ecash balance">
                <span className={`text-sm ${lowWallet ? "text-red-600 font-semibold" : "text-neutral-600"}`}>Your ecash</span>
                <Money sats={walletSats} className={`text-xl font-extrabold ${lowWallet ? "text-red-600" : ""}`} subClassName={lowWallet ? "text-red-600 text-xs" : "text-neutral-500 text-xs"} />
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-neutral-600">Fare so far</span>
              <Money sats={money?.owed || 0} className="text-xl font-extrabold" />
            </div>
            <div className="flex items-baseline justify-between text-sm mt-1">
              <span className="text-neutral-600">Paid</span>
              <Money sats={money?.paid || 0} />
            </div>
            {riding && contentOffer && (
              <EstimatedTotal className="mt-2" baseSats={quotedSats ?? contentOffer.priceSats} trip={full} changed={accepted.length > 0} changeKinds={changeKinds} terms={terms} />
            )}
            <FareBreakdown ledger={money?.ledger} paidSats={money?.paid || 0} className="mt-3 pt-3 border-t border-neutral-200" />
            <p className="text-xs text-neutral-500 mt-2">
              You pay as you ride: the base rate at the start, then each mile and each minute{money?.status === "paid" ? ". A payment just went out." : "."}
            </p>
            {riding && screenMayDim && (
              <p className="mt-2 text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2" role="status">
                Keep this app open on your screen. Payments stop while your phone sleeps, and your driver sees them as missed.
              </p>
            )}
            {money?.status === "short" && (
              <div className="mt-2 rounded-xl bg-amber-50 text-amber-800 px-3 py-2" role="alert">
                <p className="text-sm font-semibold">Your ecash wallet is short by {moneyText(Math.max(1, money.shortSats || money.due), btcPrice)}.</p>
                <p className="text-xs mt-0.5">If two payments are missed, your driver may finish the ride. Add funds and everything missed is paid at once.</p>
                <Button size="md" className="mt-2" onClick={() => setAdding(true)}><Icon name="zap" size={16} /> Add funds</Button>
              </div>
            )}
            {money?.status === "capped" && (
              <div className="mt-2 rounded-xl bg-amber-50 text-amber-800 px-3 py-2" role="alert">
                <p className="text-sm font-semibold">Payments paused at {moneyText(money.capSats, btcPrice)}.</p>
                <p className="text-xs mt-0.5">This ride has already cost much more than expected. {moneyText(money.held, btcPrice)} more is due. Your driver sees missed payments and may finish the ride. If the fare is right, allow more.</p>
                <Button size="md" className="mt-2" onClick={() => allowMore(request)}>Allow more</Button>
              </div>
            )}
            {money?.status === "error" && <p className="mt-2 text-xs text-red-700" role="alert">A payment did not go through: {money.message}</p>}
            {money?.status === "wait" && riding && <p className="mt-2 text-xs text-neutral-500">Getting your wallet ready…</p>}
          </div>
        )}
        {link.askVouch && (
          <div className="mt-3 rounded-2xl bg-amber-50 text-amber-900 px-4 py-3" role="alert">
            <p className="text-sm font-semibold">Your driver's phone has been quiet for {Math.floor(link.quiet / 60000)} min.</p>
            <p className="text-xs mt-0.5">The ride does not end by itself. If your driver is still driving you, tap below. If both phones stay silent for 10 minutes, the ride finishes at the last signal.</p>
            <Button size="md" variant="secondary" className="mt-2" onClick={link.vouch}>Still driving</Button>
          </div>
        )}
        {pendingStop && (
          <div className="mt-3" role="status">
            <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
              Waiting for your driver to accept {pendingStop.mode === "destination" ? "the new destination" : "the extra stop"}: {pendingPlace?.name || ""}.
            </p>
            <ChangeEstimate className="mt-2" from={loc || myPosition} ahead={waypoints} mode={pendingStop.mode} place={pendingPlace} terms={terms} />
          </div>
        )}

        {mismatch && (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2" role="alert">
            Your driver says they have arrived, but their location is not at your pickup. Check where they are before you go.
          </p>
        )}
        <div className="flex gap-3 mt-4">
          <button type="button" onClick={() => setContact(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] active:bg-neutral-200">
            <Icon name="phone" size={18} className="max-[380px]:hidden" /> Contact
          </button>
          <button type="button" onClick={() => setSafety(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] active:bg-neutral-200">
            <Icon name="shield" size={18} className="max-[380px]:hidden" /> Safety{share ? " ●" : ""}
          </button>
          <button type="button" onClick={() => setAsking(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] text-red-600 active:bg-neutral-200">
            <Icon name="x" size={18} className="max-[380px]:hidden" /> Finish ride
          </button>
        </div>
        {riding && !pendingStop && (
          <button type="button" onClick={() => setStopping(true)} className="mt-3 text-sm font-semibold underline">Add stop / update fare</button>
        )}

        {/* Changing the pickup (only while the driver is still on the way) */}
        {stage === "enroute" && (
          <div className="mt-3">
            {change?.status === "pending" && (
              <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2" role="status">
                Waiting for your driver to accept the new pickup{proposedName ? `: ${proposedName}` : ""}. You still meet at {pickup.name} until they do.
              </p>
            )}
            {change?.status === "declined" && (
              <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2" role="status">Your driver declined the new pickup, so you still meet at {pickup.name}.</p>
            )}
            {change?.status === "accepted" && (
              <p className="text-sm text-[#05683a] bg-[#e6f4ec] rounded-xl px-3 py-2" role="status">Your driver accepted the new pickup: {pickup.name}.</p>
            )}
            {change && <p className="text-xs text-neutral-500 mt-1.5">{PICKUP_CHANGE_NOTE}</p>}
            <button type="button" onClick={() => setChanging(true)} className="mt-2 text-sm font-semibold underline">
              {change?.status === "pending" ? "Change it again" : "Change pickup"}
            </button>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-neutral-100 flex items-start gap-3">
          <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
            <span className="w-2 h-2 rounded-full bg-black" />
            <span className="h-5 w-px bg-neutral-300 my-0.5" />
            <span className="w-2 h-2 bg-black" />
          </div>
          <div className="min-w-0 flex-1 space-y-2.5">
            <p className="text-[15px] truncate">{pickup.name}</p>
            <p className="text-[15px] truncate">{dropoff.name}</p>
          </div>
          {contentOffer && !riding && (
            <div className="text-right">
              {quotedSats != null && <><Money sats={quotedSats} stacked className="font-bold" /><p className="text-xs text-neutral-500">estimate</p></>}
            </div>
          )}
        </div>
      </Sheet>

      {changing && <ChangePickup request={request} onClose={() => setChanging(false)} />}
      {stopping && <AddStop request={request} from={loc || myPosition} ahead={waypoints} terms={terms} onClose={() => setStopping(false)} />}
      {adding && payMint && <AddFunds mint={payMint} needSats={Math.max(1, money?.shortSats || money?.due || 0)} onClose={() => setAdding(false)} />}
      <SafetySheet open={safety} onClose={() => setSafety(false)} request={request} destination={dropoff.name} />
      <ContactSheet open={contact} onClose={() => setContact(false)} pubkey={driverPubkey} name={profile?.name} />
      <ConfirmDialog
        open={asking}
        title="Finish this ride?"
        message={riding
          ? `You pay for what the ride has earned so far: the base rate, the miles and the minutes${money ? ` (${moneyText(money.owed, btcPrice)} so far)` : ""}. Most of it is already paid. The ride ends for both of you.`
          : "The ride has not started, so you owe nothing. The ride ends for both of you."}
        confirmLabel="Finish ride"
        cancelLabel="Keep riding"
        danger
        onConfirm={() => { setAsking(false); finishRide(request, { miles: meter.tripMiles ?? 0 }); }}
        onCancel={() => setAsking(false)}
      />
    </MapPage>
  );
}
