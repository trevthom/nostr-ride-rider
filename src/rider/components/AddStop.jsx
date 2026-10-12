// ════════════════════════════════════════════════════════════
//  ADD STOP (rider) — While the ride is under way, ask the driver to add a stop
//  on the way, or to go to a different destination. Pick a place (search), then
//  send it. The driver can accept it, or finish the ride instead.
//  The rider is told, before asking, what it does to the price: a FLAT price turns
//  into the driver's normal fare (base + miles + minutes), counted from the start of
//  the ride. A ride that is already on the driver's normal fare simply keeps adding
//  miles and minutes at the driver's rates.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useRider } from "../state/RiderContext.jsx";
import { searchAddress } from "../../lib/geocode.js";
import { STOP_NOTE_FLAT, STOP_NOTE_METERED } from "../../lib/stops.js";
import { rideTerms } from "../../lib/terms.js";
import { Modal, Spinner } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";

export default function AddStop({ request, onClose }) {
  const { here, myPosition, proposeStop } = useRider();
  const [mode, setMode] = useState("stop"); // "stop" | "destination"
  const flat = rideTerms(request)?.mode === "flat";
  const [text, setText] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState("");
  const timer = useRef(null);
  const req = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const type = (q) => {
    setText(q);
    setPicked(null);
    setError("");
    clearTimeout(timer.current);
    if (q.trim().length < 3) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const mine = ++req.current;
    timer.current = setTimeout(async () => {
      try {
        const found = await searchAddress(q, { near: myPosition });
        if (mine === req.current) setResults(found);
      } catch {
        if (mine === req.current) { setResults([]); setError("Search failed. Check your connection and try again."); }
      } finally {
        if (mine === req.current) setLoading(false);
      }
    }, 400);
  };
  const choose = (place) => { setPicked(place); setText(place.name); setResults([]); };
  const send = () => { if (picked && proposeStop(request, { mode, place: picked })) onClose(); };

  return (
    <Modal open title="Add a stop or change the destination" onClose={onClose}>
      <div className="flex gap-2 mb-3" role="group" aria-label="What to change">
        {[["stop", "Add a stop"], ["destination", "New destination"]].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}
            className={`flex-1 py-2.5 rounded-full text-sm font-semibold ${mode === id ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}>{label}</button>
        ))}
      </div>
      <p className="text-neutral-600 text-[15px] mb-3">
        Pick the place. Your driver can accept it, or finish the ride instead. Until they accept, the trip stays as it is.
      </p>
      <div className="flex items-center gap-2">
        <input
          aria-label="Place for the stop or destination"
          value={text}
          onChange={(e) => type(e.target.value)}
          placeholder="Where to?"
          autoComplete="off"
          className="flex-1 min-w-0 bg-neutral-100 rounded-xl px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-black"
        />
        <button
          type="button"
          onClick={() => here && choose(here)}
          disabled={!here}
          aria-label="Your location"
          className="shrink-0 inline-flex items-center gap-1 bg-white rounded-full px-3 py-2.5 text-xs font-semibold border border-neutral-300 active:bg-neutral-100 disabled:opacity-40"
        >
          <Icon name="locate" size={14} /> Your location
        </button>
      </div>
      {loading && <div className="mt-3"><Spinner size={16} /></div>}
      {error && <p className="text-red-600 text-sm mt-2" role="alert">{error}</p>}
      <ul className="mt-2">
        {results.map((p, i) => (
          <li key={`${p.name}-${i}`}>
            <button type="button" onClick={() => choose(p)} className="w-full flex items-center gap-3 py-2.5 text-left active:bg-neutral-50">
              <span className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center shrink-0"><Icon name="pin" size={16} /></span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium truncate">{p.name}</span>
                <span className="block text-sm text-neutral-500 truncate">{p.fullName || p.area}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className={`text-xs rounded-xl px-3 py-2 mt-3 ${flat ? "text-amber-800 bg-amber-50" : "text-neutral-600 bg-neutral-100"}`} role="note">
        {flat ? STOP_NOTE_FLAT : STOP_NOTE_METERED} Your driver is told this too.
      </p>
      <Button className="mt-3" onClick={send} disabled={!picked}>{picked ? "Ask my driver to go there" : "Pick a place first"}</Button>
    </Modal>
  );
}
