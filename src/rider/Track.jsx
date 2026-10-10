// ════════════════════════════════════════════════════════════
//  TRACK — The page a friend opens from a "Share my trip" link. No login:
//  the link's #fragment holds the key that decrypts the trip updates
//  (nostr/share.js). Shows the car on a map, who is driving, the plate,
//  where it is going, and a red banner if the rider pressed SOS.
// ════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { parseShareHash, subscribeShare } from "../nostr/share.js";
import { DEFAULT_RELAYS } from "../config/relays.js";
import { AppFrame, MapPage, Sheet } from "../ui/Layout.jsx";
import MapView from "../ui/MapView.jsx";
import Icon from "../ui/Icon.jsx";

const STAGE = { enroute: "Driver is on the way to pick them up", arrived: "Driver is at the pickup", riding: "On the trip" };

export default function Track() {
  const link = useMemo(() => parseShareHash(window.location.hash), []);
  const [update, setUpdate] = useState(null); // { p: payload, at }
  const [, setNow] = useState(0);

  useEffect(() => {
    if (!link) return;
    return subscribeShare(link.token, link.relays.length ? link.relays : DEFAULT_RELAYS, (p, at) => setUpdate({ p, at }));
  }, [link]);
  useEffect(() => { const id = setInterval(() => setNow((n) => n + 1), 5000); return () => clearInterval(id); }, []);

  if (!link) {
    return (
      <AppFrame>
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div><h1 className="text-xl font-bold mb-1">This link doesn't work</h1><p className="text-neutral-600 text-[15px]">Ask the rider to send the trip link again.</p></div>
        </div>
      </AppFrame>
    );
  }

  const p = update?.p;
  const ended = p?.ended;
  const age = update ? Math.max(0, Math.round(Date.now() / 1000 - update.at)) : null;
  const car = p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !ended ? [{ pubkey: "car", lat: p.lat, lng: p.lng }] : [];

  return (
    <AppFrame>
      <MapPage
        map={<MapView pickup={p?.from} dropoff={p?.to} cars={car} fitKey={`${p?.stage}|${car.length}`} />}
      >
        <Sheet label="Shared trip">
          {p?.sos && !ended && (
            <p className="mb-3 rounded-xl bg-red-600 text-white font-semibold px-4 py-3" role="alert">
              {p.name || "The rider"} pressed SOS. Call them. If you cannot reach them, call emergency services.
            </p>
          )}
          {!p ? (
            <>
              <h1 className="text-2xl font-bold">Waiting for the trip…</h1>
              <p className="text-neutral-600 text-[15px] mt-1">The first update can take a few seconds. If nothing appears, the trip may have ended.</p>
            </>
          ) : ended ? (
            <>
              <h1 className="text-2xl font-bold">The trip has ended</h1>
              <p className="text-neutral-600 text-[15px] mt-1">{p.name || "The rider"} is no longer sharing.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold leading-tight">{p.name || "A rider"} is on a trip</h1>
              <p className="text-neutral-600 text-[15px] mt-0.5">{STAGE[p.stage] || "On the way"}{p.eta != null ? ` · about ${p.eta} min` : ""}</p>
              <p className={`text-xs mt-1 ${age > 60 ? "text-amber-700" : "text-neutral-500"}`} role="status">
                {age > 60 ? `Last update ${Math.round(age / 60)} min ago. They may be out of signal.` : "Live"}
              </p>
              <dl className="mt-4 rounded-2xl bg-neutral-100 px-4 py-3 space-y-2 text-[15px]">
                {p.driver && <div className="flex justify-between gap-3"><dt className="text-neutral-600">Driver</dt><dd className="font-medium text-right">{p.driver}</dd></div>}
                {p.car && <div className="flex justify-between gap-3"><dt className="text-neutral-600">Car</dt><dd className="font-medium text-right">{p.car}</dd></div>}
                {p.plate && <div className="flex justify-between gap-3"><dt className="text-neutral-600">Plate</dt><dd className="font-mono font-bold text-right">{p.plate}</dd></div>}
                {p.from?.name && <div className="flex justify-between gap-3"><dt className="text-neutral-600">From</dt><dd className="text-right">{p.from.name}</dd></div>}
                {p.to?.name && <div className="flex justify-between gap-3"><dt className="text-neutral-600">To</dt><dd className="text-right">{p.to.name}</dd></div>}
              </dl>
            </>
          )}
          <p className="text-neutral-400 text-xs mt-4 flex items-center gap-1"><Icon name="shield" size={12} /> Shared privately with this link only.</p>
        </Sheet>
      </MapPage>
    </AppFrame>
  );
}
