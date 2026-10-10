// ════════════════════════════════════════════════════════════
//  ON TRIP — The rider's screen once a driver is confirmed. The driver
//  moves it forward with signed stage markers (lib/rides.js rideStage):
//    enroute  driver is driving to the pickup (live car on the map)
//    arrived  driver is at the pickup
//    riding   trip underway to the dropoff
//  The driver's exact position arrives end-to-end encrypted
//  (subscribeRideLocation) and is only ever shown to this rider.
//  The driver ends the trip; the rider can cancel it.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { subscribeRideLocation } from "../../nostr/live.js";
import { haversineDistance } from "../../lib/geo.js";
import { pickupEta } from "../../lib/fare.js";
import { rideConfirm, rideDriver, rideStage } from "../../lib/rides.js";
import { offerPlate } from "../../lib/privacy.js";
import { offerFrom } from "../../lib/trips.js";
import MapView from "../../ui/MapView.jsx";
import Button from "../../ui/Button.jsx";
import Money from "../../ui/Money.jsx";
import Icon from "../../ui/Icon.jsx";
import ContactSheet from "../../ui/ContactSheet.jsx";
import { MapPage, Sheet } from "../../ui/Layout.jsx";
import { ConfirmDialog } from "../../ui/Parts.jsx";
import DriverInfo, { Plate, useDriverInfo, carText } from "../components/DriverInfo.jsx";
import SafetySheet from "../components/SafetySheet.jsx";
import Avatar from "../../ui/Avatar.jsx";

const r3 = (n) => Math.round(n * 1000) / 1000; // ~110 m: limits how often the route is re-fetched
const miles = (a, b) => haversineDistance(a.lat, a.lng, b.lat, b.lng);

export default function OnTrip({ request, trip }) {
  const { user, pushNotice } = useApp();
  const { cancelRide, myPosition, share, shareUpdate, confirmRide } = useRider();
  const driverPubkey = rideDriver(request);
  const stage = rideStage(request);
  const offer = offerFrom(request, driverPubkey);
  const { profile } = useDriverInfo(driverPubkey);
  const [loc, setLoc] = useState(null); // driver's live position
  const [contact, setContact] = useState(false);
  const [asking, setAsking] = useState(false);
  const [safety, setSafety] = useState(false);
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

  const { pickup, dropoff } = trip;
  const age = loc ? Math.round((Date.now() - loc.ts) / 1000) : null;
  const live = age != null && age < 45;
  // Minutes left: the road route from the car when the router answered, else a straight-line guess.
  const toTarget = !loc ? null : routeInfo && !routeInfo.straight ? routeInfo.minutes : pickupEta(miles(loc, stage === "riding" ? dropoff : pickup));

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

  const confirm = rideConfirm(request);

  const headline =
    stage === "arrived" ? "Your driver has arrived"
    : stage === "riding" ? `On the way to ${dropoff.name}`
    : toTarget != null ? `Driver arriving in ${toTarget} min`
    : offer ? `Driver arriving in about ${JSON.parse(offer.content).etaMinutes} min`
    : "Your driver is on the way";
  const sub =
    stage === "arrived" ? `Meet at ${pickup.name}`
    : stage === "riding" ? (toTarget != null ? `About ${toTarget} min left` : "Sit back and relax")
    : `Meet at ${pickup.name}`;

  // The line always starts at the car, so it shows what is LEFT of the trip.
  const route = loc ? [{ lat: r3(loc.lat), lng: r3(loc.lng) }, stage === "riding" ? dropoff : pickup] : stage === "riding" ? [pickup, dropoff] : null;
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
        />
      }
    >
      <Sheet label="Your trip">
        <h2 className="text-2xl font-bold leading-tight">{headline}</h2>
        <p className="text-neutral-600 text-[15px] mt-0.5">{sub}</p>
        {stage !== "arrived" && (
          <p className="text-xs text-neutral-500 mt-1" role="status">
            {loc ? (live ? "Live location" : `Driver's location updated ${age < 120 ? `${age}s` : `${Math.round(age / 60)} min`} ago`) : "Waiting for your driver's location…"}
          </p>
        )}

        <div className="mt-4 pt-4 border-t border-neutral-100">
          {driverPubkey ? <DriverInfo pubkey={driverPubkey} offerEvent={offer} /> : <p className="text-neutral-500">Driver details are loading…</p>}
          {stage !== "riding" && car && <p className="text-xs text-neutral-500 mt-2">Look for a {car}.</p>}
        </div>

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
            Do not get in. Cancel the ride below, and use Safety if you feel unsafe.
          </p>
        )}
        {confirm.boarded?.ok && stage === "arrived" && <p className="mt-3 text-sm text-[#05944f] font-medium">You confirmed the car matches.</p>}

        <div className="flex gap-3 mt-4">
          <button type="button" onClick={() => setContact(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] active:bg-neutral-200">
            <Icon name="phone" size={18} /> Contact
          </button>
          <button type="button" onClick={() => setSafety(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] active:bg-neutral-200">
            <Icon name="shield" size={18} /> Safety{share ? " ●" : ""}
          </button>
          <button type="button" onClick={() => setAsking(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] text-red-600 active:bg-neutral-200">
            <Icon name="x" size={18} /> Cancel
          </button>
        </div>

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
              {contentOffer.upfrontSats > 0 && <p className="text-xs text-neutral-500">deposit paid</p>}
            </div>
          )}
        </div>
      </Sheet>

      <SafetySheet open={safety} onClose={() => setSafety(false)} request={request} destination={dropoff.name} />
      <ContactSheet open={contact} onClose={() => setContact(false)} pubkey={driverPubkey} name={profile?.name} />
      <ConfirmDialog
        open={asking}
        title="Cancel this ride?"
        message={stage === "riding" ? "The trip is underway. You may still owe the fare." : "Your deposit goes to the driver and is not refunded."}
        confirmLabel="Cancel ride"
        cancelLabel="Keep ride"
        danger
        onConfirm={() => { setAsking(false); cancelRide(request); }}
        onCancel={() => setAsking(false)}
      />
    </MapPage>
  );
}
