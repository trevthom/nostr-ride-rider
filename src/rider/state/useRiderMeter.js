// ════════════════════════════════════════════════════════════
//  RIDER METER (rider app) — Works out the distances BOTH screens show.
//
//  Inputs:
//    • the driver's own odometer (pm / tm), sent inside each location update;
//    • the rider's own measure, kept inside the code and never shown:
//        - during the trip: the miles of the rider's own phone GPS (the rider
//          is in the car); if that is not available, the miles of the car's
//          position updates the rider receives;
//        - on the way to the pickup: the miles of the car's position updates
//          (the rider is not in the car yet).
//  Rule (lib/meter.js referenceMiles): the driver's distance, unless the
//  rider's differs from it by more than 5%, then the rider's.
//  The result is sent to the driver's app (nostr/live.js publishMeter), so
//  both screens show the same numbers.
//  The rider's odometers are saved on this device, so a reload keeps them.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { newOdo, stepOdo } from "../../lib/odometer.js";
import { referenceMiles, routeCapMiles } from "../../lib/meter.js";
import { rideKey } from "../../lib/rides.js";
import { getSetting, setSetting } from "../../config/relays.js";

const STORE = "riderOdo";
const SAVE_EVERY_MS = 5000;
const dist = (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 5000 ? x : null);

// request: the ride; stage: "enroute" | "arrived" | "riding"; loc: the driver's latest position
// update ({lat,lng,ts,pm,tm}); pos: the rider's own GPS fix.
export function useRiderMeter({ request, stage, loc, pos, quotedMiles = null }) {
  const key = rideKey(request);
  const ref = useRef({ key: null, sp: newOdo(), st: newOdo(), ot: newOdo(), drv: { pm: null, tm: null }, savedAt: 0 });
  const [out, setOut] = useState({ pickupMiles: null, tripMiles: null });

  const recompute = () => {
    const r = ref.current;
    const riderPickup = r.sp.last ? r.sp.miles : null;
    const riderTrip = r.ot.last ? r.ot.miles : r.st.last ? r.st.miles : null;
    // With no measure of our own, the driver's number is all there is: it is held to the quoted route (lib/meter.js).
    const cap = routeCapMiles(quotedMiles);
    const alone = (x) => (x != null ? Math.min(x, cap) : x);
    const next = {
      pickupMiles: referenceMiles(r.drv.pm, riderPickup),
      tripMiles: riderTrip == null ? alone(referenceMiles(r.drv.tm, riderTrip)) : referenceMiles(r.drv.tm, riderTrip),
    };
    setOut((prev) => (prev.pickupMiles === next.pickupMiles && prev.tripMiles === next.tripMiles ? prev : next));
  };
  const save = (force = false) => {
    const r = ref.current;
    if (!force && Date.now() - r.savedAt < SAVE_EVERY_MS) return;
    r.savedAt = Date.now();
    const all = getSetting(STORE, {});
    setSetting(STORE, Object.fromEntries(Object.entries({ ...all, [r.key]: { sp: r.sp, st: r.st, ot: r.ot, drv: r.drv } }).slice(-5)));
  };

  useEffect(() => {
    const saved = getSetting(STORE, {})[key];
    ref.current = { key, sp: saved?.sp || newOdo(), st: saved?.st || newOdo(), ot: saved?.ot || newOdo(), drv: saved?.drv || { pm: null, tm: null }, savedAt: 0 };
    recompute();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // The driver's position update: their odometer, and the car's track as the rider sees it.
  useEffect(() => {
    if (!loc || ref.current.key !== key) return;
    const r = ref.current;
    r.drv = { pm: dist(loc.pm) ?? r.drv.pm, tm: dist(loc.tm) ?? r.drv.tm };
    const fix = { lat: loc.lat, lng: loc.lng, t: Number.isFinite(loc.ts) ? loc.ts : Date.now() };
    if (stage === "enroute") r.sp = stepOdo(r.sp, fix);
    else if (stage === "riding") r.st = stepOdo(r.st, fix);
    recompute();
    save();
  }, [loc?.ts, loc?.lat, loc?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rider's own phone, during the trip only.
  useEffect(() => {
    if (!pos || stage !== "riding" || ref.current.key !== key) return;
    ref.current.ot = stepOdo(ref.current.ot, { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, t: Date.now() });
    recompute();
    save();
  }, [pos?.lat, pos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { save(true); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  return out;
}
