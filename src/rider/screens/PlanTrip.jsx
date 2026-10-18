// ════════════════════════════════════════════════════════════
//  PLAN TRIP — The rider's home when no ride is open. Four steps,
//  kept in RiderContext.plan so switching tabs doesn't lose them:
//    idle    map + "Where to?" bar + recent places
//    search  pickup / dropoff fields with live address results
//    pin     the pickup OR the drop-off set by dragging the map under a pin (components/PinPicker; plan.pinField says which)
//    quote   route on the map, the typical fares of the drivers nearby (each driver sets their own rates)
//            and a suggested price. The fare is always each driver's own rates (base, per mile,
//            per minute), paid tick by tick. Now/Later, notes → Request.
//  Going back: the back arrow on the search page returns to where it was opened from (plan.from: the
//  home screen, or the quote). The close button (X) on the search, pin and quote pages cancels the
//  planning and returns to the home screen (resetPlan).
// ════════════════════════════════════════════════════════════

import { formatDistance, ratePerUnit, unitName } from "../../lib/units.js";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { median, normalizeRates, quoteFare, typicalFare, typicalSats } from "../../lib/fare.js";
import { formatFiat } from "../../lib/currency.js";
import { FARE_RATES } from "../../config/settings.js";
import MapView from "../../ui/MapView.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import Icon from "../../ui/Icon.jsx";
import Button from "../../ui/Button.jsx";
import { MapPage, Sheet, FloatButton, StickyActions } from "../../ui/Layout.jsx";
import { inputCls } from "../../ui/Parts.jsx";
import PlaceSearch from "../components/PlaceSearch.jsx";
import PinPicker from "../components/PinPicker.jsx";
import { SAMPLE_LOCATIONS } from "../../lib/locations.js";
import GenderPref from "../components/GenderPref.jsx";
import { gpsMessage } from "../../lib/gps.js";

export default function PlanTrip() {
  const { plan, setPlan, resetPlan, here, myPosition, recentPlaces } = useRider();

  if (plan.step === "pin") {
    const field = plan.pinField === "dropoff" ? "dropoff" : "pickup";
    const other = field === "pickup" ? plan.dropoff : plan.pickup;
    // The pin starts on the place already chosen for this field; a drop-off starts near the pickup (the trip usually stays in the area).
    const start = (field === "dropoff" ? plan.dropoff || plan.pickup : plan.pickup) || myPosition || here || SAMPLE_LOCATIONS[0];
    return (
      <PinPicker
        key={field}
        field={field}
        start={start}
        me={myPosition}
        onBack={() => setPlan({ step: "search" })}
        onExit={resetPlan}
        onConfirm={(place) => setPlan({ [field]: place, step: other ? "quote" : "search" })}
      />
    );
  }
  if (plan.step === "search") {
    return (
      <PlaceSearch
        pickup={plan.pickup}
        dropoff={plan.dropoff}
        here={here}
        near={myPosition}
        recents={{ pickup: recentPlaces("pickup", 3), dropoff: recentPlaces("dropoff", 3) }}
        onBack={() => setPlan({ step: plan.from === "quote" && plan.pickup && plan.dropoff ? "quote" : "idle" })}
        onExit={resetPlan}
        onPin={(field) => setPlan({ step: "pin", pinField: field })}
        onDone={() => setPlan({ step: "quote" })}
        onChange={(field, place) => {
          const next = { [field]: place };
          const both = field === "pickup" ? place && plan.dropoff : plan.pickup && place;
          setPlan(both ? { ...next, step: "quote" } : next);
        }}
      />
    );
  }
  if (plan.step === "quote" && plan.pickup && plan.dropoff) return <Quote />;
  return <Idle />;
}

function Idle() {
  const { setPlan, plan, drivers, myPosition, geoError, gps, recentPlaces, nearestDriverEta } = useRider();
  const mapRef = useRef(null);
  const recents = recentPlaces();
  const eta = nearestDriverEta(myPosition);

  const openSearch = (dropoff) => {
    // The pickup is never filled in for the rider: a recent place only sets the destination, and the search page asks for the pickup.
    const pickup = plan.pickup;
    setPlan({ step: dropoff && pickup ? "quote" : "search", from: "idle", ...(dropoff ? { dropoff } : {}) });
  };

  return (
    <MapPage
      map={<MapView ref={mapRef} me={myPosition} cars={drivers} fitKey={myPosition ? "pos" : "nopos"} padBottom={300} />}
      top={<FloatButton icon="locate" label="Center on my location" onClick={() => mapRef.current?.fit()} className="ml-auto" />}
    >
      <Sheet label="Where to?">
        <button
          type="button"
          onClick={() => openSearch()}
          className="w-full flex items-center gap-3 bg-neutral-100 rounded-xl px-4 py-4 text-left active:bg-neutral-200"
        >
          <Icon name="search" size={22} />
          <span className="text-lg font-semibold">Where to?</span>
          <span className="ml-auto inline-flex items-center gap-1.5 bg-white rounded-full px-3 py-1.5 text-sm font-semibold">
            <Icon name="clock" size={14} /> Now
          </span>
        </button>

        <ul className="mt-2">
          {recents.map((p) => (
            <li key={p.name}>
              <button type="button" onClick={() => openSearch(p)} className="w-full flex items-center gap-3 py-3 text-left active:bg-neutral-50">
                <span className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center shrink-0"><Icon name="clock" size={18} /></span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium truncate">{p.name}</span>
                  <span className="block text-sm text-neutral-500 truncate">{p.area}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="text-sm text-neutral-500 mt-3 flex items-center gap-2" role="status">
          <span className={`w-2 h-2 rounded-full ${drivers.length ? "bg-[#16a34a]" : "bg-neutral-300"}`} aria-hidden="true" />
          {gps !== "good"
            ? `${gpsMessage(gps, myPosition, geoError)} You can still search for a pickup or pin it on the map.`
            : drivers.length
            ? `${drivers.length} driver${drivers.length === 1 ? "" : "s"} online nearby${eta ? ` · about ${eta} min away` : ""}`
            : "No drivers online nearby right now. You can still request a ride."}
        </p>
      </Sheet>
    </MapPage>
  );
}

function Quote() {
  const { btcPrice, usdPrice, prices, currency } = useApp();
  const { plan, setPlan, resetPlan, drivers, requestRide, nearestDriverEta, gps, myPosition, geoError } = useRider();
  const { pickup, dropoff } = plan;
  const [route, setRoute] = useState(null); // { miles, minutes, straight }
  const [error, setError] = useState("");
  const mapRef = useRef(null);

  const key = `${pickup.lat},${pickup.lng}|${dropoff.lat},${dropoff.lng}`;
  useEffect(() => setRoute(null), [key]);

  // Use the trip as the request will publish it (miles to a tenth), so a driver's typical fare
  // works out to the same cents on both screens.
  const trip = route && { miles: Math.round(route.miles * 10) / 10, minutes: route.minutes };
  const quote = trip ? quoteFare(trip, usdPrice) : null; // the app's own rates (the fallback)
  // Every driver nearby sets their own rates (in their own currency). Show each one's fare for this trip in the rider's
  // currency, and suggest the middle one. Sats are the common ground, so drivers in other currencies compare fairly.
  const typicals = trip
    ? drivers
        .map((d) => {
          const r = normalizeRates(d.rates);
          const sats = typicalSats(r, trip.miles, trip.minutes, prices);
          return { id: d.pubkey, name: d.name || "Driver", custom: !!r, sats, own: r ? `${formatFiat(typicalFare(r, trip.miles, trip.minutes), r.currency)}` : "" };
        })
        .filter((t) => t.sats != null)
        .sort((a, b) => a.sats - b.sats)
    : [];
  const appSats = quote ? typicalSats(null, trip.miles, trip.minutes, { USD: usdPrice }) ?? quote.sats : 0;
  const suggestedSats = quote ? Math.round(typicals.length ? median(typicals.map((t) => t.sats)) : appSats) : 0;
  const eta = nearestDriverEta(pickup);
  const timed = plan.when !== "ASAP";
  const localNow = (offsetMs = 0) =>
    new Date(Date.now() + offsetMs - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const request = () => {
    if (!quote) return;
    if (timed) {
      const t = Date.parse(plan.when);
      if (isNaN(t)) return setError("Pick a valid date and time.");
      if (t > Date.now() + 7 * 86400000) return setError("Scheduled rides can be at most 1 week ahead.");
      if (t < Date.now() - 60000) return setError("Pick a time in the future.");
    }
    requestRide({ pickup, dropoff, when: plan.when, notes: plan.notes.trim(), miles: route.miles, minutes: route.minutes, fareSats: suggestedSats, suggestedSats });
  };

  const arrive = new Date(Date.now() + ((eta || 5) + (route?.minutes || 0)) * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <MapPage
      map={
        <MapView
          ref={mapRef}
          pickup={pickup}
          dropoff={dropoff}
          route={[pickup, dropoff]}
          cars={drivers}
          fitKey={key}
          padBottom={430}
          onRoute={setRoute}
        />
      }
      top={
        <>
          <FloatButton icon="chevron-left" label="Back" onClick={() => setPlan({ step: "search" })} />
          <FloatButton icon="x" label="Close and go home" onClick={resetPlan} className="ml-auto" />
        </>
      }
    >
      <Sheet label="Choose your ride">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
            <span className="w-2 h-2 rounded-full bg-black" />
            <span className="h-5 w-px bg-neutral-300 my-0.5" />
            <span className="w-2 h-2 bg-black" />
          </div>
          <div className="min-w-0 flex-1 space-y-2.5">
            <p className="text-[15px] font-medium truncate">{pickup.name}</p>
            <p className="text-[15px] font-medium truncate">{dropoff.name}</p>
          </div>
          <button type="button" onClick={() => setPlan({ step: "search", from: "quote" })} className="text-sm font-semibold underline">Edit</button>
        </div>

        {/* The ride (one type for now) */}
        <div className="flex items-center gap-3 rounded-2xl border-2 border-black px-4 py-3.5">
          <Icon name="car" size={34} strokeWidth={1.5} />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-[17px] leading-tight">NostrRide</p>
            <p className="text-sm text-neutral-600">
              {route ? `${route.minutes} min · ${formatDistance(route.miles)}${route.straight ? " (est.)" : ""}` : "Finding the best route…"}
            </p>
            <p className="text-xs text-neutral-500">
              {timed ? "Scheduled" : eta ? `Driver about ${eta} min away` : "No drivers online yet"}
              {!timed && route ? ` · arrive ${arrive}` : ""}
            </p>
          </div>
          <div className="text-right">
            {quote ? (
              <>
                <p className="text-[11px] text-neutral-500">Suggested</p>
                <Money sats={suggestedSats} stacked className="font-bold text-lg" />
              </>
            ) : <span className="block w-14 h-6 rounded bg-neutral-200 animate-pulse" />}
          </div>
        </div>

        {quote && (
          <div className="mt-3 rounded-2xl bg-neutral-100 px-4 py-3">
            <p className="text-sm text-neutral-800">
              You pay the driver's own rates as you ride: a base rate when the ride starts, then every mile and every minute. About <span className="font-semibold">{moneyText(suggestedSats, btcPrice)}</span> for this trip. Traffic can make it cost more.
            </p>
            {typicals.length > 0 ? (
              <div className="mt-3 pt-3 border-t border-neutral-200">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">Drivers nearby</p>
                <ul className="flex flex-wrap gap-1.5">
                  {typicals.slice(0, 6).map((t) => (
                    <li key={t.id} className="text-xs bg-white border border-neutral-200 rounded-full px-2.5 py-1">
                      <span className="font-semibold">{t.name}</span> {moneyText(t.sats, btcPrice)}
                      {!t.custom && <span className="text-neutral-400"> · app rates</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-neutral-500 mt-2">
                {`App rates: ${formatFiat(FARE_RATES.base, "USD")} base + ${formatFiat(ratePerUnit(FARE_RATES.perMile), "USD")}/${unitName()} + ${formatFiat(FARE_RATES.perMinute, "USD")}/min.`}
              </p>
            )}
          </div>
        )}
        {pickup.fromGps && gps !== "good" && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-2" role="alert">
            Your pickup comes from a weak location. {gpsMessage(gps, myPosition, geoError)} Tap Edit to check the address.
          </p>
        )}
        {quote && !btcPrice && (
          <p className="text-xs text-amber-700 mt-1.5">The bitcoin price for {currency} is not available yet, so amounts show in sats.</p>
        )}
        {quote && btcPrice && !quote.live && currency === "USD" && (
          <p className="text-xs text-amber-700 mt-1.5">Live bitcoin price unavailable, so this uses an estimated rate.</p>
        )}

        {/* When */}
        <div className="flex gap-2 mt-4" role="group" aria-label="When">
          {[["ASAP", "Now"], ["Later", "Schedule"]].map(([id, label]) => {
            const on = (id === "ASAP") === !timed;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => { setError(""); setPlan({ when: id === "ASAP" ? "ASAP" : localNow(3600000) }); }}
                className={`flex-1 py-2.5 rounded-full text-sm font-semibold ${on ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {timed && (
          <div className="mt-2">
            <input
              aria-label="Pick-up time"
              type="datetime-local"
              value={plan.when}
              min={localNow()}
              max={localNow(7 * 86400000)}
              onChange={(e) => { setPlan({ when: e.target.value || "ASAP" }); setError(""); }}
              className={inputCls}
            />
            <p className="text-neutral-500 text-xs mt-1">Up to 1 week ahead. Drivers can accept until 1 hour after this time.</p>
          </div>
        )}

        <GenderPref className="mt-4" />

        <input
          aria-label="Note for the driver"
          value={plan.notes}
          onChange={(e) => setPlan({ notes: e.target.value })}
          placeholder="Note for the driver (luggage, door, …)"
          maxLength={140}
          className={`${inputCls} mt-3`}
        />

        <div className="flex items-center gap-2 text-sm text-neutral-600 mt-3">
          <Icon name="zap" size={16} className="text-[#f7931a]" />
          You pay in ecash while you ride, from your wallet in Account.
        </div>

        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        <StickyActions className="mt-4">
          <Button onClick={request} disabled={!quote}>
            {!quote ? "Finding route…" : <>Request ride · about {moneyText(suggestedSats, btcPrice)}</>}
          </Button>
        </StickyActions>
        <Button variant="secondary" className="mt-2" onClick={resetPlan}>Cancel and go home</Button>
        <p className="text-neutral-500 text-xs text-center mt-2">
          Drivers who accept charge their own rates. You choose who to ride with, and drivers see only the approximate area until you do.
        </p>
      </Sheet>
    </MapPage>
  );
}
