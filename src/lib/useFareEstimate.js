// ════════════════════════════════════════════════════════════
//  FARE ESTIMATES during a ride (both apps). The ride is paid tick by tick, so every number here is an
//  ESTIMATE: the road, the traffic and the clock decide what is really paid.
//
//    changeRoutes({ from, ahead, mode, place })     the route before and after a proposed change, as point lists (pure)
//    useChangeEstimate({ from, ahead, mode, place, terms, price })
//                                                   { status: "idle"|"loading"|"ready"|"error", sats, miles, minutes }
//                                                   what a new stop / a new destination does to the fare (signed)
//    useTotalEstimate({ baseSats, trip, changed, terms, price })
//                                                   { sats, deltaSats }: the whole ride's estimated fare. With no accepted
//                                                   change it is the driver's own estimate (the offer); with one, the full route
//                                                   (pickup → stops → destination) is priced at the driver's frozen rates.
//  `ahead` = the places still ahead, the destination last. `terms` = rideTerms(request) (the driver's frozen rates).
//  Routes come from the same OSRM helper as the map (cached); a failed route gives status "error" and no number.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { getDrivingRoute, metersToMiles } from "./routing.js";
import { fareChangeSats, typicalSats } from "./fare.js";
import { FALLBACK_BTC_USD } from "../config/settings.js";
import { DEFAULT_CURRENCY } from "./currency.js";

// The price of one BTC in the rates' currency; the app's fallback price for dollars only (an estimate may use it, a payment never does).
export const estimatePrice = (currency, price) => price || (currency === DEFAULT_CURRENCY ? FALLBACK_BTC_USD : null);

// Before: from the car through everything still ahead. After: the same with a new stop before the destination, or a new destination.
export function changeRoutes({ from, ahead, mode, place }) {
  const dropoff = ahead[ahead.length - 1];
  const stops = ahead.slice(0, -1);
  return {
    before: [from, ...ahead],
    after: mode === "destination" ? [from, ...stops, place] : [from, ...stops, place, dropoff],
  };
}

async function totals(points) {
  const r = await getDrivingRoute(points);
  return r ? { miles: metersToMiles(r.distanceMeters), minutes: r.durationSeconds / 60 } : null;
}
const keyOf = (pts, digits = 4) => pts.map((p) => `${p.lat.toFixed(digits)},${p.lng.toFixed(digits)}`).join(";");
const ratesOf = (terms) => (terms ? { base: terms.base, perMile: terms.perMile, perMinute: terms.perMinute, currency: terms.currency } : null);

export function useChangeEstimate({ from, ahead, mode, place, terms, price }) {
  const [state, setState] = useState({ status: "idle" });
  const ready = !!(from && place && ahead?.length && terms);
  // The car moves while the box is open: its place counts to ~110 m, so the routes are asked again only when it has really moved on.
  const k = ready ? `${mode}|${keyOf([from], 3)}|${keyOf([...ahead, place])}` : "";
  const p = ready ? estimatePrice(terms.currency, price) : null;
  useEffect(() => {
    if (!k) { setState({ status: "idle" }); return undefined; }
    let alive = true;
    setState({ status: "loading" });
    const { before, after } = changeRoutes({ from, ahead, mode, place });
    Promise.all([totals(before), totals(after)])
      .then(([b, a]) => {
        if (!alive) return;
        if (!a || !b) return setState({ status: "error" });
        setState({ status: "ready", miles: a.miles - b.miles, minutes: a.minutes - b.minutes, sats: fareChangeSats(ratesOf(terms), b, a, p) });
      })
      .catch(() => { if (alive) setState({ status: "error" }); });
    return () => { alive = false; };
  }, [k, p, terms?.base, terms?.perMile, terms?.perMinute, terms?.currency]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function useTotalEstimate({ baseSats, trip, changed, terms, price }) {
  const [priced, setPriced] = useState(null);
  const pts = changed && trip ? [trip.pickup, ...trip.stops, trip.dropoff] : null;
  const k = pts ? keyOf(pts) : "";
  const p = terms ? estimatePrice(terms.currency, price) : null;
  useEffect(() => {
    if (!k || !terms) { setPriced(null); return undefined; }
    let alive = true;
    totals(pts)
      .then((t) => { if (alive) setPriced(t ? typicalSats(ratesOf(terms), t.miles, t.minutes, { [terms.currency]: p }) : null); })
      .catch(() => { if (alive) setPriced(null); });
    return () => { alive = false; };
  }, [k, p, terms?.base, terms?.perMile, terms?.perMinute, terms?.currency]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!(baseSats > 0)) return { sats: priced, deltaSats: null };
  if (!changed || priced == null) return { sats: baseSats, deltaSats: changed ? null : 0 };
  return { sats: priced, deltaSats: priced - baseSats };
}
