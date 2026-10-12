// ════════════════════════════════════════════════════════════
//  ON TRIP — The rider's screen once a driver is confirmed. The driver
//  moves it forward with signed stage markers (lib/rides.js rideStage):
//    enroute  driver is driving to the pickup (live car on the map)
//    arrived  driver is at the pickup
//    riding   trip underway to the dropoff
//  The driver's exact position arrives end-to-end encrypted
//  (subscribeRideLocation) and is only ever shown to this rider.
//  Starting: when the rider is at the car, each phone shows its own 2-digit code and each
//  person types the code on the other's phone (lib/startcode.js).
//  Paying: from the start, the rider's app pays the driver in ecash ticks (the base rate, then
//  each mile and each minute). The screen shows what the ride has cost so far.
//  Either person can "Finish ride" (after a confirmation). There are no cancellations and no fees:
//  the rider pays only what the ride earned. The rider can add a stop or change the destination.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { startCode, checkCode, attemptGate, recordAttempt } from "../../lib/startcode.js";
import { arrivalMismatch } from "../../lib/arrival.js";
import { fullTrip, nextStop, stopChanges, readStop } from "../../lib/stops.js";
import { milesAtTime } from "../../lib/ridemoney.js";
import { rideKey } from "../../lib/rides.js";
import { ARRIVE_RADIUS_METERS } from "../../config/settings.js";
import { getSetting, setSetting } from "../../config/relays.js";
import { useRideLink } from "../../features/payments/useRideLink.js";
import AddFunds from "../../features/payments/AddFunds.jsx";
import AddStop from "../components/AddStop.jsx";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { subscribeRideLocation } from "../../nostr/live.js";
import { haversineDistance } from "../../lib/geo.js";
import { pickupEta } from "../../lib/fare.js";
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
import { publishMeter } from "../../nostr/live.js";
import TripMeter, { peekMeter } from "../../ui/TripMeter.jsx";
import { useRiderMeter } from "../state/useRiderMeter.js";
import { readPickup } from "../../lib/privacy.js";

const r3 = (n) => Math.round(n * 1000) / 1000; // ~110 m: limits how often the route is re-fetched
const miles = (a, b) => haversineDistance(a.lat, a.lng, b.lat, b.lng);

export default function OnTrip({ request, trip }) {
  const { user, pushNotice, btcPrice } = useApp();
  const { finishRide, myPosition, share, shareUpdate, confirmRide, money, reportMiles, payMint } = useRider();
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

  // Re-render every 10 s so "updated Xs ago" and ETAs stay current.
  useEffect(() => { const id = setInterval(() => setNow((n) => n + 1), 10000); return () => clearInterval(id); }, []);

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

  // Keep a shared trip current for the people following the link.
  const plateInfo = offerPlate(offer, user);
  const carName = carText(profile?.vehicle);
  useEffect(() => {
    if (!share) return;
    const send = (force) => shareUpdate({
      name: user.name, driver: profile?.name || "", car: carName, plate: plateInfo ? `${plateInfo.plateState} ${plateInfo.plateNumber}` : "",
      stage, lat: loc?.lat, lng: loc?.lng, locTs: loc?.ts, eta: toTarget,
      from: { name: pickup.name, lat: pickup.lat, lng: pickup.lng }, to: { name: dropoff.name, lat: dropoff.lat, lng: dropoff.lng },
    }, { force });
    send(true);
    const id = setInterval(() => send(false), 15000);
    return () => clearInterval(id);
  }, [share?.token, share?.sos, stage, loc?.lat, loc?.lng, toTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // Time and distance so far (the same on the driver's screen). The rider's own GPS figure is used inside
  // the code only (lib/meter.js); it is sent to the driver's app, so both screens agree.
  const meter = useRiderMeter({ request, stage, loc, pos: myPosition });
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
  const driverCode = driverPubkey ? startCode(user.sk, driverPubkey, key, "driver") : "";
  const riderCode = driverPubkey ? startCode(user.sk, driverPubkey, key, "rider") : "";
  const enterCode = () => {
    if (!gateState.open) return;
    const ok = checkCode(typed, driverCode);
    setGate(recordAttempt(gate, ok, Date.now()));
    if (ok) { confirmRide(request, "code", true); setCodeMsg(""); setTyped(""); }
    else setCodeMsg("That is not the code on your driver's phone. Check it and try again.");
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

        <TripMeter view={view} className="mt-3" />

        <div className="mt-4 pt-4 border-t border-neutral-100">
          {driverPubkey ? <DriverInfo pubkey={driverPubkey} offerEvent={offer} /> : <p className="text-neutral-500">Driver details are loading…</p>}
          {stage !== "riding" && car && <p className="text-xs text-neutral-500 mt-2">Look for a {car}.</p>}
        </div>

        {/* What the ride costs, tick by tick */}
        {(riding || money?.owed > 0) && (
          <div className="mt-4 rounded-2xl bg-neutral-100 px-4 py-3" role="group" aria-label="Fare so far">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-neutral-600">Fare so far</span>
              <Money sats={money?.owed || 0} className="text-xl font-extrabold" />
            </div>
            <div className="flex items-baseline justify-between text-sm mt-1">
              <span className="text-neutral-600">Paid</span>
              <Money sats={money?.paid || 0} />
            </div>
            <p className="text-xs text-neutral-500 mt-2">
              You pay as you ride: the base rate at the start, then each mile and each minute{money?.status === "paid" ? ". A payment just went out." : "."}
            </p>
            {money?.status === "short" && (
              <div className="mt-2 rounded-xl bg-amber-50 text-amber-800 px-3 py-2" role="alert">
                <p className="text-sm font-semibold">Your ecash wallet is short by {moneyText(Math.max(1, money.shortSats || money.due), btcPrice)}.</p>
                <p className="text-xs mt-0.5">If two payments are missed, your driver may finish the ride. Add funds and everything missed is paid at once.</p>
                <Button size="md" className="mt-2" onClick={() => setAdding(true)}><Icon name="zap" size={16} /> Add funds</Button>
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
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2" role="status">
            Waiting for your driver to accept {pendingStop.mode === "destination" ? "the new destination" : "the extra stop"}: {readStop(pendingStop, request, user)?.name || ""}.
          </p>
        )}

        {/* Check the car before getting in (a common safety step) */}
        {stage === "arrived" && !confirm.boarded && (
          <div className="mt-4 rounded-2xl border-2 border-black p-4" role="group" aria-label="Check before you get in">
            <p className="font-bold mb-2">Check before you get in</p>
            <div className="flex items-center gap-3 mb-2">
              <Avatar src={profile?.picture} name={profile?.name} size={44} />
              <div className="min-w-0">
                <p className="font-semibold truncate">{profile?.name}</p>
                <p className="text-sm text-neutral-600 truncate">{carName}</p>
              </div>
              <div className="ml-auto"><Plate plate={plateInfo} /></div>
            </div>
            <p className="text-xs text-neutral-600 mb-3">Does the plate, car and driver match? Ask the driver to say your name.</p>
            <div className="flex gap-2">
              <Button size="md" variant="go" onClick={() => confirmRide(request, "boarded", true)}>It matches</Button>
              <Button size="md" variant="danger" onClick={() => confirmRide(request, "boarded", false, "Plate, car or driver did not match")}>Doesn't match</Button>
            </div>
          </div>
        )}
        {confirm.boarded && !confirm.boarded.ok && (
          <p className="mt-4 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-3" role="alert">
            Do not get in. Finish the ride below, and use Safety if you feel unsafe.
          </p>
        )}
        {mismatch && (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2" role="alert">
            Your driver says they have arrived, but their location is not at your pickup. Check where they are before you go.
          </p>
        )}
        {confirm.boarded?.ok && stage === "arrived" && <p className="mt-3 text-sm text-[#05944f] font-medium">You confirmed the car matches.</p>}

        {/* Starting the ride: both people confirm they are at the car with a 2-digit code */}
        {stage === "arrived" && confirm.boarded?.ok && !confirm.boarded.note?.includes("did not match") && (
          <div className="mt-4 rounded-2xl border-2 border-black p-4" role="group" aria-label="Start code">
            <p className="font-bold">Start the ride</p>
            <p className="text-xs text-neutral-600 mb-3">Both of you must be at the car. Show your code to your driver, and type the code on your driver's phone.</p>
            <div className="flex items-center justify-between rounded-xl bg-neutral-100 px-4 py-3">
              <span className="text-sm text-neutral-600">Your code</span>
              <span className="text-3xl font-extrabold tracking-widest tabular-nums" aria-label={`Your code is ${riderCode}`}>{riderCode}</span>
            </div>
            {confirm.code?.ok ? (
              <p className="mt-3 text-sm text-[#05944f] font-medium flex items-center gap-1"><Icon name="check" size={16} /> You entered your driver's code. Waiting for your driver to start the trip.</p>
            ) : (
              <div className="mt-3">
                <label className="block text-sm font-semibold mb-1" htmlFor="driver-code">Your driver's code</label>
                <div className="flex gap-2">
                  <input id="driver-code" inputMode="numeric" autoComplete="off" maxLength={2} value={typed}
                    onChange={(e) => { setTyped(e.target.value.replace(/\D/g, "")); setCodeMsg(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enterCode(); } }}
                    placeholder="00" className="w-24 bg-neutral-100 rounded-xl px-4 py-3 text-2xl text-center font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-black" />
                  <Button size="md" onClick={enterCode} disabled={typed.length !== 2 || !gateState.open}>Confirm</Button>
                </div>
                {!gateState.open && <p className="text-xs text-amber-700 mt-1" role="alert">Too many tries. Wait {Math.ceil(gateState.waitMs / 1000)} s.</p>}
                {codeMsg && gateState.open && <p className="text-xs text-red-600 mt-1" role="alert">{codeMsg}</p>}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button type="button" onClick={() => setContact(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] active:bg-neutral-200">
            <Icon name="phone" size={18} /> Contact
          </button>
          <button type="button" onClick={() => setSafety(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] active:bg-neutral-200">
            <Icon name="shield" size={18} /> Safety{share ? " ●" : ""}
          </button>
          <button type="button" onClick={() => setAsking(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] text-red-600 active:bg-neutral-200">
            <Icon name="x" size={18} /> Finish ride
          </button>
        </div>
        {riding && !pendingStop && (
          <button type="button" onClick={() => setStopping(true)} className="mt-3 text-sm font-semibold underline">Add a stop or change the destination</button>
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
          {contentOffer && (
            <div className="text-right">
              <Money sats={contentOffer.priceSats} stacked className="font-bold" />
              <p className="text-xs text-neutral-500">{money?.ledger?.mode === "metered" || contentOffer.mode !== "flat" ? "estimate" : "flat price"}</p>
            </div>
          )}
        </div>
      </Sheet>

      {changing && <ChangePickup request={request} onClose={() => setChanging(false)} />}
      {stopping && <AddStop request={request} onClose={() => setStopping(false)} />}
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
