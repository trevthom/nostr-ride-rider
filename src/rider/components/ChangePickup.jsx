// ════════════════════════════════════════════════════════════
//  CHANGE PICKUP (rider) — Ask the driver, who is already on the way, to
//  meet you somewhere else. Pick a place (search, or "Your location"), then
//  send it. The driver gets a notice and can accept or decline; until they
//  accept, the first pickup stays. Changing the pickup does not change the
//  miles or minutes already counted for a cancellation, and both people
//  are told so.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useRider } from "../state/RiderContext.jsx";
import { searchAddress } from "../../lib/geocode.js";
import { PICKUP_CHANGE_NOTE } from "../../lib/pickup.js";
import { Modal, Spinner } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";

export default function ChangePickup({ request, onClose }) {
  const { here, myPosition, proposePickup } = useRider();
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
  const send = () => { if (picked && proposePickup(request, picked)) onClose(); };

  return (
    <Modal open title="Change your pickup" onClose={onClose}>
      <p className="text-neutral-600 text-[15px] mb-3">
        Your driver is on the way. Pick the new place. Your driver can accept or decline, and you keep the first pickup until they accept.
      </p>
      <div className="flex items-center gap-2">
        <input
          aria-label="New pickup location"
          value={text}
          onChange={(e) => type(e.target.value)}
          placeholder="New pickup location"
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

      <p className="text-xs text-neutral-600 bg-neutral-100 rounded-xl px-3 py-2 mt-3">{PICKUP_CHANGE_NOTE} Your driver is told this too.</p>
      <Button className="mt-3" onClick={send} disabled={!picked}>{picked ? "Ask my driver to go there" : "Pick a place first"}</Button>
    </Modal>
  );
}
