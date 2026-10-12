// ════════════════════════════════════════════════════════════
//  PLACE SEARCH — The "Plan your ride" page: pickup and dropoff fields
//  stacked like Uber, with live address results below (Photon /
//  OpenStreetMap, lib/geocode.js). The pickup is filled in from the rider's
//  GPS on its own (as soon as the address is known) unless the rider has
//  already typed or cleared it. A "Your location" button on the pickup field
//  fills it again at any time, and it can still be changed afterward. Recent places are suggested for the dropoff.
//  onChange(field, place) is called when a result is chosen.
//  onBack() is the back arrow (one screen back); onExit() is the X that cancels the planning and goes home;
//  onPin() opens the map pin picker for the pickup ("Set pickup on the map").
//  onDone() shows a "Done" button once both places are set, so a rider who
//  tapped Edit by mistake can go straight back to the quote.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { searchAddress } from "../../lib/geocode.js";
import Icon from "../../ui/Icon.jsx";
import { Spinner } from "../../ui/Parts.jsx";

export default function PlaceSearch({ pickup, dropoff, here, near, recents, onChange, onBack, onExit, onPin, onDone }) {
  const [focus, setFocus] = useState(pickup ? "dropoff" : "pickup");
  const [text, setText] = useState({ pickup: pickup?.name || "", dropoff: dropoff?.name || "" });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef(null);
  const req = useRef(0);
  const inputs = { pickup: useRef(null), dropoff: useRef(null) };

  useEffect(() => { inputs[focus].current?.focus(); }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fill the pickup from GPS once the address is known, if the rider has not touched that field.
  const touched = useRef(!!pickup);
  useEffect(() => {
    if (touched.current || pickup || !here) return;
    touched.current = true;
    setText((t) => ({ ...t, pickup: here.name }));
    onChange("pickup", here);
    setFocus((f) => (f === "pickup" ? "dropoff" : f));
  }, [here, pickup]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), []);

  const type = (field, q) => {
    if (field === "pickup") touched.current = true; // the rider is in charge of this field now
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
    if (field === "pickup") setFocus("dropoff");
  };

  const q = text[focus].trim();
  const showResults = q.length >= 3 && !(focus === "pickup" && pickup && q === pickup.name) && !(focus === "dropoff" && dropoff && q === dropoff.name);
  const suggestions = focus === "pickup" ? [] : recents; // the pickup has its own "Your location" button

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-white">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2 flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Back" className="p-2 -ml-1 rounded-full active:bg-neutral-100">
          <Icon name="chevron-left" size={24} />
        </button>
        <h1 className="text-xl font-bold">Plan your ride</h1>
        {onExit && (
          <button type="button" onClick={onExit} aria-label="Cancel and go home" className="ml-auto p-2 -mr-1 rounded-full active:bg-neutral-100">
            <Icon name="x" size={22} />
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
        <div className="flex-1 space-y-2">
          {["pickup", "dropoff"].map((field) => (
            <div key={field} className={`flex items-center rounded-xl px-4 ${focus === field ? "bg-white ring-2 ring-black" : "bg-neutral-100"}`}>
              <input
                ref={inputs[field]}
                aria-label={field === "pickup" ? "Pickup location" : "Where to?"}
                value={text[field]}
                onFocus={() => { setFocus(field); setResults([]); }}
                onChange={(e) => type(field, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && results.length && focus === field) { e.preventDefault(); choose(field, results[0]); } }}
                placeholder={field === "pickup" ? "Pickup location" : "Where to?"}
                autoComplete="off"
                className="bg-transparent flex-1 min-w-0 py-3.5 text-[15px] placeholder-neutral-500 focus:outline-none"
              />
              {field === "pickup" && (
                <button
                  type="button"
                  onClick={() => here && choose("pickup", here)}
                  disabled={!here}
                  aria-label="Your location"
                  className="shrink-0 ml-1 inline-flex items-center gap-1 bg-white rounded-full px-2.5 py-1.5 text-xs font-semibold border border-neutral-300 active:bg-neutral-100 disabled:opacity-40"
                >
                  <Icon name="locate" size={14} /> {here ? "Your location" : "Locating…"}
                </button>
              )}
              {focus === field && loading && <Spinner size={16} />}
              {text[field] && focus === field && !loading && (
                <button type="button" aria-label="Clear" onClick={() => type(field, "")} className="p-1 text-neutral-500"><Icon name="x" size={16} /></button>
              )}
            </div>
          ))}
        </div>
      </div>

      {pickup && dropoff && onDone && (
        <div className="px-5 mt-4">
          <button type="button" onClick={onDone} className="w-full py-3.5 rounded-xl bg-black text-white font-semibold active:bg-neutral-700">
            Done
          </button>
        </div>
      )}

      <ul className="mt-3 px-2">
        {focus === "pickup" && onPin && (
          <li>
            <button type="button" onClick={onPin} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl active:bg-neutral-100 text-left">
              <span className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center shrink-0"><Icon name="pin" size={18} /></span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium">Set pickup on the map</span>
                <span className="block text-sm text-neutral-500">Drag the map to pin the exact spot</span>
              </span>
            </button>
          </li>
        )}
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
      <p className="text-neutral-400 text-xs px-5 py-4">
        Drivers see only the approximate area until you confirm one.
      </p>
    </div>
  );
}
