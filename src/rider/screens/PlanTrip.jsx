// ════════════════════════════════════════════════════════════
//  PLAN TRIP — The rider's home when no ride is open. Three steps,
//  kept in RiderContext.plan so switching tabs doesn't lose them:
//    idle    map + "Where to?" bar + recent places
//    search  pickup / dropoff fields with live address results
//    quote   route on the map, the suggested price, the rider's own offer,
//            Now/Later, notes → Request. Drivers accept the offer or counter.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { clampOffer, offerLevel, quoteFare, usdToSats } from "../../lib/fare.js";
import { FALLBACK_BTC_USD, FARE_RATES } from "../../config/settings.js";
import MapView from "../../ui/MapView.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import PriceStepper from "../../ui/PriceStepper.jsx";
import Icon from "../../ui/Icon.jsx";
import Button from "../../ui/Button.jsx";
import { MapPage, Sheet, FloatButton } from "../../ui/Layout.jsx";
import { inputCls } from "../../ui/Parts.jsx";
import PlaceSearch from "../components/PlaceSearch.jsx";
import GenderPref from "../components/GenderPref.jsx";
import { gpsMessage } from "../../lib/gps.js";

export default function PlanTrip() {
  const { plan, setPlan, here, myPosition, recentPlaces } = useRider();

  if (plan.step === "search") {
    return (
      <PlaceSearch
        pickup={plan.pickup}
        dropoff={plan.dropoff}
        here={here}
        near={myPosition}
        recents={recentPlaces()}
        onBack={() => setPlan({ step: plan.pickup && plan.dropoff ? "quote" : "idle" })}
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
  const { setPlan, plan, here, drivers, myPosition, geoError, gps, recentPlaces, nearestDriverEta } = useRider();
  const mapRef = useRef(null);
  const recents = recentPlaces();
  const eta = nearestDriverEta(myPosition);

  const openSearch = (dropoff) => {
    // No address for the rider's position yet? Open the search page: it fills the pickup in when it arrives.
    const pickup = plan.pickup || here;
    setPlan({ step: dropoff && pickup ? "quote" : "search", pickup, ...(dropoff ? { dropoff } : {}) });
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
            ? `${gpsMessage(gps, myPosition, geoError)} You can also search for a pickup.`
            : drivers.length
            ? `${drivers.length} driver${drivers.length === 1 ? "" : "s"} online nearby${eta ? ` · about ${eta} min away` : ""}`
            : "No drivers online nearby right now. You can still request a ride."}
        </p>
      </Sheet>
    </MapPage>
  );
}

function Quote() {
  const { btcUsd, wallet } = useApp();
  const { plan, setPlan, drivers, requestRide, nearestDriverEta, gps, myPosition, geoError } = useRider();
  const { pickup, dropoff } = plan;
  const [route, setRoute] = useState(null); // { miles, minutes, straight }
  const [error, setError] = useState("");
  const mapRef = useRef(null);

  const key = `${pickup.lat},${pickup.lng}|${dropoff.lat},${dropoff.lng}`;
  useEffect(() => setRoute(null), [key]);

  const quote = route ? quoteFare(route, btcUsd) : null;
  // The rider names the price. The suggestion (from distance and time) is only the starting point.
  const suggestedUsd = quote ? Math.max(1, Math.round(quote.usd)) : 0;
  // An offer belongs to one route: a different pickup or dropoff starts from the suggestion again.
  const offerUsd = quote ? clampOffer(plan.offerKey === key ? plan.offerUsd : suggestedUsd, suggestedUsd) : 0;
  const offerSats = quote ? usdToSats(offerUsd, btcUsd || FALLBACK_BTC_USD) : 0;
  const suggestedSats = quote ? usdToSats(suggestedUsd, btcUsd || FALLBACK_BTC_USD) : 0; // the suggestion in whole dollars, like the offer
  const level = quote ? offerLevel(offerUsd, suggestedUsd) : "fair";
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
    requestRide({ pickup, dropoff, when: plan.when, notes: plan.notes.trim(), miles: route.miles, minutes: route.minutes, fareSats: offerSats, suggestedSats });
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
      top={<FloatButton icon="chevron-left" label="Edit trip" onClick={() => setPlan({ step: "search" })} />}
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
          <button type="button" onClick={() => setPlan({ step: "search" })} className="text-sm font-semibold underline">Edit</button>
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

        {/* The rider's offer: drivers accept it or counter. */}
        {quote && (
          <div className="mt-3 rounded-2xl bg-neutral-100 px-4 pt-3 pb-3">
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">Your offer</p>
            <PriceStepper usd={offerUsd} suggestedUsd={suggestedUsd} onChange={(v) => setPlan({ offerUsd: v, offerKey: key })} label="Your offer in dollars" />
            <p className={`text-center text-sm mt-2 ${level === "low" ? "text-amber-700" : "text-neutral-700"}`} role="status">
              {level === "low"
                ? "Below the suggested price. Drivers may counter with a higher price."
                : level === "high"
                ? "Above the suggested price. Drivers are likely to accept fast."
                : "Close to the suggested price. Drivers are likely to accept."}
            </p>
            <p className="text-center text-xs text-neutral-500 mt-1">
              Suggested ${suggestedUsd}: ${FARE_RATES.base.toFixed(2)} base + ${FARE_RATES.perMile.toFixed(2)}/mi + ${FARE_RATES.perMinute.toFixed(2)}/min, for this trip.
              {offerUsd !== suggestedUsd && (
                <> <button type="button" onClick={() => setPlan({ offerUsd: null, offerKey: null })} className="underline font-semibold">Use suggested</button></>
              )}
            </p>
          </div>
        )}
        {pickup.fromGps && gps !== "good" && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-2" role="alert">
            Your pickup comes from a weak location. {gpsMessage(gps, myPosition, geoError)} Tap Edit to check the address.
          </p>
        )}
        {quote && !quote.live && (
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
          {wallet.connected ? "Pay with your connected wallet" : "Pay over Lightning from any wallet"}
        </div>

        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        <Button className="mt-4" onClick={request} disabled={!quote}>
          {quote ? <>Request ride · {moneyText(offerSats, btcUsd)}</> : "Finding route…"}
        </Button>
        <p className="text-neutral-500 text-xs text-center mt-2">
          Drivers can accept your price or counter it. You choose who to ride with, and drivers see only the approximate area until you do.
        </p>
      </Sheet>
    </MapPage>
  );
}
