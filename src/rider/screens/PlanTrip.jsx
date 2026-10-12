// ════════════════════════════════════════════════════════════
//  PLAN TRIP — The rider's home when no ride is open. Four steps,
//  kept in RiderContext.plan so switching tabs doesn't lose them:
//    idle    map + "Where to?" bar + recent places
//    search  pickup / dropoff fields with live address results
//    pin     the pickup set by dragging the map under a pin (components/PinPicker)
//    quote   route on the map, the typical fares of the drivers nearby (each
//            driver sets their own rates), a suggested price, and the choice of fare:
//              Standard fare  every driver's own rates (base, per mile, per minute), paid tick by tick
//              Flat price     the rider's own price (any amount, in local money or sats): a driver
//                             accepts it or counters; traffic and detours never raise it
//            Now/Later, notes → Request.
//  Going back: the back arrow on the search page returns to where it was opened from (plan.from: the
//  home screen, or the quote). The close button (X) on the search, pin and quote pages cancels the
//  planning and returns to the home screen (resetPlan).
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { median, normalizeRates, offerLevel, offerLimitsSats, quoteFare, typicalFare, typicalSats } from "../../lib/fare.js";
import { formatFiat } from "../../lib/currency.js";
import { FARE_RATES } from "../../config/settings.js";
import MapView from "../../ui/MapView.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import AmountInput from "../../ui/AmountInput.jsx";
import Icon from "../../ui/Icon.jsx";
import Button from "../../ui/Button.jsx";
import { MapPage, Sheet, FloatButton } from "../../ui/Layout.jsx";
import { inputCls } from "../../ui/Parts.jsx";
import PlaceSearch from "../components/PlaceSearch.jsx";
import PinPicker from "../components/PinPicker.jsx";
import { SAMPLE_LOCATIONS } from "../../lib/locations.js";
import GenderPref from "../components/GenderPref.jsx";
import { gpsMessage } from "../../lib/gps.js";

export default function PlanTrip() {
  const { plan, setPlan, resetPlan, here, myPosition, recentPlaces } = useRider();

  if (plan.step === "pin") {
    const start = plan.pickup || myPosition || here || SAMPLE_LOCATIONS[0];
    return (
      <PinPicker
        start={start}
        me={myPosition}
        onBack={() => setPlan({ step: "search" })}
        onExit={resetPlan}
        onConfirm={(place) => setPlan({ pickup: place, step: plan.dropoff ? "quote" : "search" })}
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
        recents={recentPlaces()}
        onBack={() => setPlan({ step: plan.from === "quote" && plan.pickup && plan.dropoff ? "quote" : "idle" })}
        onExit={resetPlan}
        onPin={() => setPlan({ step: "pin" })}
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
          <span className={`w-2 h-2 rounded-full ${drivers.length ? "bg-green-600" : "bg-neutral-300"}`} aria-hidden="true" />
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
  const flat = plan.fareMode === "flat";
  // A flat price belongs to one route: a new pickup or dropoff starts from the suggestion again.
  const limits = offerLimitsSats(suggestedSats, usdPrice);
  const offerSats = quote ? (plan.offerKey === key ? plan.offerSats : suggestedSats) : 0; // null while the field is empty
  const offerOk = Number.isFinite(offerSats) && offerSats >= limits.min && offerSats <= limits.max;
  const level = quote && offerOk ? offerLevel(offerSats, suggestedSats) : "fair";
  const eta = nearestDriverEta(pickup);
  const timed = plan.when !== "ASAP";
  const localNow = (offsetMs = 0) =>
    new Date(Date.now() + offsetMs - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const request = () => {
    if (!quote || (flat && !offerOk)) return;
    if (timed) {
      const t = Date.parse(plan.when);
      if (isNaN(t)) return setError("Pick a valid date and time.");
      if (t > Date.now() + 7 * 86400000) return setError("Scheduled rides can be at most 1 week ahead.");
      if (t < Date.now() - 60000) return setError("Pick a time in the future.");
    }
    requestRide({ pickup, dropoff, when: plan.when, notes: plan.notes.trim(), miles: route.miles, minutes: route.minutes, fareMode: flat ? "flat" : "standard", fareSats: flat ? Math.round(offerSats) : suggestedSats, suggestedSats });
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
              {route ? `${route.minutes} min · ${route.miles.toFixed(1)} mi${route.straight ? " (est.)" : ""}` : "Finding the best route…"}
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

        {/* The fare: each driver's standard fare, or the rider's flat price. */}
        {quote && (
          <div className="mt-3 flex gap-2" role="group" aria-label="Fare">
            {[["standard", "Standard fare"], ["flat", "Flat price"]].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={plan.fareMode === id} onClick={() => setPlan({ fareMode: id })}
                className={`flex-1 py-2.5 rounded-full text-sm font-semibold ${plan.fareMode === id ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        {quote && !flat && (
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
                {`App rates: ${formatFiat(FARE_RATES.base, "USD")} base + ${formatFiat(FARE_RATES.perMile, "USD")}/mi + ${formatFiat(FARE_RATES.perMinute, "USD")}/min.`}
              </p>
            )}
          </div>
        )}
        {quote && flat && (
          <div className="mt-3 rounded-2xl bg-neutral-100 px-4 pt-3 pb-3">
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">Your flat price</p>
            <AmountInput
              sats={offerSats}
              rate={btcPrice}
              min={limits.min}
              max={limits.max}
              label="Your flat price"
              onChange={(v) => setPlan({ offerSats: v, offerKey: key })}
            />
            {offerOk && (
              <p className={`text-center text-sm mt-2 ${level === "low" ? "text-amber-700" : "text-neutral-700"}`} role="status">
                {level === "low"
                  ? "Below the suggested price. Drivers may counter with a higher price."
                  : level === "high"
                  ? "Above the suggested price. Drivers are likely to accept fast."
                  : "Close to the suggested price. Drivers are likely to accept."}
              </p>
            )}
            <p className="text-center text-xs text-neutral-500 mt-1">
              Suggested {moneyText(suggestedSats, btcPrice)}: the {typicals.length ? "middle of what nearby drivers typically charge" : "app's rates"} for this trip.
              {offerSats !== suggestedSats && (
                <> <button type="button" onClick={() => setPlan({ offerSats: null, offerKey: null })} className="underline font-semibold">Use suggested</button></>
              )}
            </p>
            <p className="text-center text-xs text-neutral-600 mt-2">
              Once a driver accepts, the price does not change for traffic or detours. If you add a stop or change the destination during the ride, you pay the driver's normal fare instead, counted from the start.
            </p>
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
        <Button className="mt-4" onClick={request} disabled={!quote || (flat && !offerOk)}>
          {!quote ? "Finding route…" : flat ? (offerOk ? <>Request ride · {moneyText(offerSats, btcPrice)} flat</> : "Enter your price") : <>Request ride · about {moneyText(suggestedSats, btcPrice)}</>}
        </Button>
        <Button variant="secondary" className="mt-2" onClick={resetPlan}>Cancel and go home</Button>
        <p className="text-neutral-500 text-xs text-center mt-2">
          {flat ? "Drivers can accept your price or counter it. " : "Drivers who accept charge their own rates. "}You choose who to ride with, and drivers see only the approximate area until you do.
        </p>
      </Sheet>
    </MapPage>
  );
}
