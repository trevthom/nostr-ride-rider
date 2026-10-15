// ════════════════════════════════════════════════════════════
//  PIN PICKER — "Set pickup on the map" and "Set drop-off on the map". A full-screen map with a fixed pin in the
//  middle. The rider drags the map until the pin is on the spot, and the address for
//  that spot is looked up (Photon reverse geocoding, lib/geocode.js) and shown below.
//  "Confirm pickup" / "Confirm drop-off" returns a place { name, fullName, area, lat, lng } like a search result.
//  `field` says which of the two places is being set ("pickup" by default); only the words differ.
//
//  The lookup sends the pin's position (rounded to ~10 m) to the geocoder, the same as
//  "Your location" does. If the lookup fails, the spot is still usable as "Dropped pin".
//
//    <PinPicker field="pickup"|"dropoff" start={{lat,lng}} me={{lat,lng}|null} onConfirm(place) onBack() onExit() />
//    onBack = one screen back (the search page); onExit = cancel the planning and go home.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { reverseGeocode } from "../../lib/geocode.js";
import { TILE_URL, TILE_ATTRIBUTION } from "../../config/services.js";
import Icon from "../../ui/Icon.jsx";
import Button from "../../ui/Button.jsx";
import { Spinner } from "../../ui/Parts.jsx";
import { FloatButton } from "../../ui/Layout.jsx";

const ZOOM = 17;
const WORDS = {
  pickup: { section: "Set pickup on the map", spot: "Pickup spot", confirm: "Confirm pickup" },
  dropoff: { section: "Set drop-off on the map", spot: "Drop-off spot", confirm: "Confirm drop-off" },
};
const LOOKUP_DELAY_MS = 450; // wait for the map to settle, and be kind to the geocoder

export default function PinPicker({ field = "pickup", start, me, onConfirm, onBack, onExit }) {
  const words = WORDS[field] || WORDS.pickup;
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const lookup = useRef(0);
  const timer = useRef(null);
  const [spot, setSpot] = useState(null);   // where the pin is: { lat, lng }
  const [place, setPlace] = useState(null); // the address for that spot, or null while it is looked up

  useEffect(() => {
    const map = L.map(boxRef.current, { zoomControl: false, attributionControl: true });
    map.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    map.setView([start.lat, start.lng], ZOOM);
    map.on("move", () => setPlace(null));
    map.on("moveend", () => { const c = map.getCenter(); setSpot({ lat: c.lat, lng: c.lng }); });
    mapRef.current = map;
    setSpot({ lat: start.lat, lng: start.lng });
    setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 0);
    return () => { clearTimeout(timer.current); map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Name the spot once the map has stopped moving.
  useEffect(() => {
    if (!spot) return;
    clearTimeout(timer.current);
    const mine = ++lookup.current;
    const fallback = { name: "Dropped pin", fullName: "Dropped pin", area: "Near the pin", lat: spot.lat, lng: spot.lng };
    timer.current = setTimeout(async () => {
      let found = null;
      try { found = await reverseGeocode(spot.lat, spot.lng); } catch { /* use the fallback */ }
      if (mine === lookup.current) setPlace(found || fallback);
    }, LOOKUP_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [spot?.lat, spot?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex-1 min-h-0 relative bg-neutral-200">
      <div ref={boxRef} className="absolute inset-0" aria-label="Map: drag to move the pin" />

      {/* The pin stays in the middle of the screen; its tip is the exact spot. */}
      <div className="absolute left-1/2 top-1/2 z-[500] pointer-events-none" style={{ transform: "translate(-50%, -100%)" }} aria-hidden="true">
        <Icon name="pin" size={44} strokeWidth={2} fill="#ffffff" className="text-black" />
      </div>
      <span className="absolute left-1/2 top-1/2 z-[500] w-2 h-2 -ml-1 -mt-1 rounded-full bg-black/50 pointer-events-none" aria-hidden="true" />

      <div className="absolute top-0 inset-x-0 z-[500] px-4 pt-[max(1rem,env(safe-area-inset-top))] pointer-events-none">
        <div className="flex items-center gap-3 [&>*]:pointer-events-auto">
          <FloatButton icon="chevron-left" label="Back" onClick={onBack} />
          {me && <FloatButton icon="locate" label="Center on my location" className="ml-auto" onClick={() => mapRef.current?.setView([me.lat, me.lng], ZOOM)} />}
          {onExit && <FloatButton icon="x" label="Close and go home" className={me ? "" : "ml-auto"} onClick={onExit} />}
        </div>
      </div>

      <section aria-label={words.section} className="absolute bottom-0 inset-x-0 z-[600] bg-white rounded-t-3xl shadow-[0_-6px_28px_rgba(0,0,0,0.16)] px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <p className="text-neutral-500 text-xs uppercase tracking-wider font-semibold">{words.spot}</p>
        <div className="flex items-center gap-2 min-h-[48px] mt-1">
          {place ? (
            <div className="min-w-0">
              <p className="text-[17px] font-semibold truncate">{place.name}</p>
              <p className="text-sm text-neutral-500 truncate">{place.fullName || place.area}</p>
            </div>
          ) : (
            <p className="text-neutral-500 text-[15px] flex items-center gap-2"><Spinner size={16} /> Finding the address…</p>
          )}
        </div>
        <Button className="mt-3" disabled={!place} onClick={() => place && onConfirm(place)}>{words.confirm}</Button>
        <p className="text-neutral-400 text-xs mt-2">Drag the map to move the pin. Drivers see only the approximate area until you confirm a ride.</p>
      </section>
    </div>
  );
}
