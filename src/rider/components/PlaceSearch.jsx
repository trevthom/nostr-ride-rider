// ════════════════════════════════════════════════════════════
//  PLACE SEARCH — The "Plan your ride" page: pickup and dropoff fields
//  stacked like Uber, with live address results below (Photon /
//  OpenStreetMap, lib/geocode.js). The pickup is NEVER filled in automatically:
//  the rider types an address or a business name, or pins the spot on the map, or taps "Your location" on the pickup field
//  (a deliberate tap that uses the GPS address).
//  Nothing but the two fields (and Back / Cancel) shows until a field is ACTIVE (it has the cursor). Then, for THAT field only:
//    1. the map button ("Set pickup on the map" / "Set drop-off on the map"),
//    2. below it the 3 most recent places for that field (`recents.pickup` / `recents.dropoff`), or the search results once the rider types.
//  onChange(field, place) is called when a result is chosen.
//  onBack() is the back arrow (one screen back); onExit() is the X that cancels the planning and goes home;
//  onPin(field) opens the map pin picker for the pickup or the drop-off.
//  onDone() shows a "Done" button (only while a field is active) once both places are set, so a rider who
//  tapped Edit by mistake can go straight back to the quote.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { searchAddress } from "../../lib/geocode.js";
import Icon from "../../ui/Icon.jsx";
import { Spinner } from "../../ui/Parts.jsx";

export default function PlaceSearch({ pickup, dropoff, here, near, recents, onChange, onBack, onExit, onPin, onDone }) {
  const [focus, setFocus] = useState(null); // the active field: "pickup" | "dropoff" | null (no cursor in either)
  const [text, setText] = useState({ pickup: pickup?.name || "", dropoff: dropoff?.name || "" });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef(null);
  const req = useRef(0);
  const blurTimer = useRef(null);
  const inputs = { pickup: useRef(null), dropoff: useRef(null) };

  // Open with the cursor in the field that still needs a place.
  useEffect(() => { inputs[pickup ? "dropoff" : "pickup"].current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(blurTimer.current); }, []);

  // A tap on a button must not move the cursor out of the field (the buttons would vanish before the tap lands).
  const keepFocus = (e) => e.preventDefault();

  const type = (field, q) => {
    setText((t) => ({ ...t, [field]: q }));
    onChange(field, null); // typing invalidates the earlier pick
    setError("");
    clearTimeout(timer.current);
    if (q.trim().length < 3) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const mine = ++req.current;
    // Wait 400 ms after the last keystroke before searching (be kind to the API).
    timer.current = setTimeout(async () => {
      try {
        const found = await searchAddress(q, { near: field === "dropoff" ? pickup || near : near });
        if (mine === req.current) setResults(found);
      } catch {
        if (mine === req.current) { setResults([]); setError("Search failed. Check your connection and try again."); }
      } finally {
        if (mine === req.current) setLoading(false);
      }
    }, 400);
  };

  const choose = (field, place) => {
    setText((t) => ({ ...t, [field]: place.name }));
    setResults([]);
    onChange(field, place);
    if (field === "pickup") inputs.dropoff.current?.focus();
  };

  const q = focus ? text[focus].trim() : "";
  const showResults = q.length >= 3 && !(focus === "pickup" && pickup && q === pickup.name) && !(focus === "dropoff" && dropoff && q === dropoff.name);
  const suggestions = focus ? recents?.[focus] || [] : [];
  const pinLabel = focus === "pickup"
    ? ["Set pickup on the map", "Drag the map to pin the exact spot"]
    : ["Set drop-off on the map", "Drag the map to pin where you are going"];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-white">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2 flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Back" className="p-2 -ml-1 rounded-full active:bg-neutral-100">
          <Icon name="chevron-left" size={24} />
        </button>
        <h1 className="text-xl font-bold">Plan your ride</h1>
        {onExit && (
          <button type="button" onClick={onExit} className="ml-auto px-3 py-2 -mr-1 rounded-full text-[15px] font-semibold active:bg-neutral-100">
            Cancel
          </button>
        )}
      </header>

      {/* The two fields, joined by a line like the Uber trip planner. */}
      <div className="px-5 flex gap-3">
        <div className="flex flex-col items-center py-4" aria-hidden="true">
          <span className="w-2.5 h-2.5 rounded-full bg-black" />
          <span className="flex-1 w-px bg-neutral-300 my-1" />
          <span className="w-2.5 h-2.5 bg-black" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {["pickup", "dropoff"].map((field) => (
            <div key={field} className={`flex items-center rounded-xl px-4 ${focus === field ? "bg-white ring-2 ring-black" : "bg-neutral-100"}`}>
              <input
                ref={inputs[field]}
                aria-label={field === "pickup" ? "Pickup location" : "Where to?"}
                value={text[field]}
                onFocus={() => { clearTimeout(blurTimer.current); setFocus(field); setResults([]); }}
                onBlur={() => { blurTimer.current = setTimeout(() => setFocus(null), 150); }}
                onChange={(e) => type(field, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && results.length && focus === field) { e.preventDefault(); choose(field, results[0]); } }}
                placeholder={field === "pickup" ? "Address or business" : "Where to?"}
                autoComplete="off"
                className="bg-transparent flex-1 min-w-0 py-3.5 text-[15px] placeholder-neutral-500 focus:outline-none"
              />
              {field === "pickup" && focus === "pickup" && (
                <button
                  type="button"
                  onMouseDown={keepFocus}
                  onClick={() => here && choose("pickup", here)}
                  disabled={!here}
                  aria-label="Your location"
                  className="shrink-0 ml-1 inline-flex items-center gap-1 bg-white rounded-full px-2.5 py-1.5 max-[380px]:p-2 text-xs font-semibold border border-neutral-300 active:bg-neutral-100 disabled:opacity-40"
                >
                  <Icon name="locate" size={14} /> <span className="max-[380px]:sr-only">{here ? "Your location" : "Locating…"}</span>
                </button>
              )}
              {focus === field && loading && <Spinner size={16} />}
              {text[field] && focus === field && !loading && (
                <button type="button" aria-label="Clear" onMouseDown={keepFocus} onClick={() => type(field, "")} className="p-1 text-neutral-500"><Icon name="x" size={16} /></button>
              )}
            </div>
          ))}
        </div>
      </div>

      {focus && (
        <div onMouseDown={keepFocus}>
          {onPin && (
            <div className="px-5 mt-3">
              <button type="button" onClick={() => onPin(focus)} className="w-full flex items-center gap-3 rounded-xl border border-neutral-300 px-4 py-3 text-left active:bg-neutral-100">
                <span className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center shrink-0"><Icon name="pin" size={18} /></span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{pinLabel[0]}</span>
                  <span className="block text-sm text-neutral-500">{pinLabel[1]}</span>
                </span>
              </button>
            </div>
          )}

          <ul className="mt-2 px-2">
            {error && <li className="px-3 py-3 text-sm text-red-600">{error}</li>}
            {showResults && !loading && !error && results.length === 0 && <li className="px-3 py-3 text-sm text-neutral-500">No matches. Try a street and city.</li>}
            {(showResults ? results : suggestions).map((place, i) => (
              <li key={`${place.name}-${i}`}>
                <button type="button" onClick={() => choose(focus, place)} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl active:bg-neutral-100 text-left">
                  <span className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                    <Icon name={showResults ? "pin" : "clock"} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium truncate">{place.name}</span>
                    <span className="block text-sm text-neutral-500 truncate">{place.fullName || place.area}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {focus === "pickup" && !pickup && (
            <p className="px-5 mt-3 text-sm text-neutral-600" role="note">
              Not sure of the address? Try entering the name of a business or landmark near you, like a store, a restaurant or a hotel.
            </p>
          )}

          {pickup && dropoff && onDone && (
            <div className="px-5 mt-4">
              <button type="button" onClick={onDone} className="w-full py-3.5 rounded-xl bg-black text-white font-semibold active:bg-neutral-700">
                Done
              </button>
            </div>
          )}
        </div>
      )}
      <p className="text-neutral-400 text-xs px-5 py-4">
        Drivers see only the approximate area until you confirm one.
      </p>
    </div>
  );
}
