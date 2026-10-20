// ════════════════════════════════════════════════════════════
//  DRIVER BROWSER — The rider chooses a driver to ask, from the drivers online nearby. Used before the request is made (more than one
//  driver is nearby) and while a request waits (to ask one more driver, or after a driver said no).
//    • List   each driver's name and what THIS trip would cost at THAT driver's rates; the list scrolls when there are many; "Request" asks that driver
//    • Map    "See map": the drivers around the rider with their price next to them; tap one, then "Request <name>"
//  Asking a driver sends the request to that driver alone. The driver can accept (the rider then sees the offer) or decline (the rider is told).
//  `status`: { [driverPubkey]: "waiting" | "declined" | "passed" } for drivers already asked ("declined": the driver said no; "passed": the rider turned them down). The prices come from the rates in the drivers' public
//  presence (the driver's own rates; a driver with none uses the app's rates), at the current bitcoin price.
//  The map frames the PICKUP and the drivers around it (not the route to the drop-off).
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { normalizeRates, typicalSats } from "../../lib/fare.js";
import { moneyText } from "../../ui/Money.jsx";
import MapView from "../../ui/MapView.jsx";
import Button from "../../ui/Button.jsx";
import { MapPage, Sheet } from "../../ui/Layout.jsx";
import { Spinner } from "../../ui/Parts.jsx";

// What the trip costs at this driver's rates, in sats (null while the price of their currency is unknown).
export const driverFare = (d, trip, prices) => (trip ? typicalSats(normalizeRates(d.rates), trip.miles, trip.minutes, prices) : null);

const PILL_LIFT = 0.00025; // the price tag sits a little north of the car, not on top of it

export default function DriverBrowser({ pickup, me = null, drivers, trip, status = {}, onRequest, top = null, title = "Choose a driver", intro = "", footer = null, fitKey = "browse" }) {
  const { btcPrice, prices } = useApp();
  const [showMap, setShowMap] = useState(false);
  const [selected, setSelected] = useState(null); // driver pubkey picked on the map

  const rows = drivers
    .map((d) => ({ d, name: d.name || "Driver", sats: driverFare(d, trip, prices) }))
    .sort((a, b) => (a.sats ?? Infinity) - (b.sats ?? Infinity));
  const open = rows.filter((r) => !status[r.d.pubkey]);
  const picked = rows.find((r) => r.d.pubkey === selected && !status[r.d.pubkey]) || null;
  const priceText = (sats) => (sats != null ? moneyText(sats, btcPrice) : "price unknown");

  const pills = showMap ? rows.filter((r) => r.sats != null).map((r) => ({ id: r.d.pubkey, lat: r.d.lat + PILL_LIFT, lng: r.d.lng, text: moneyText(r.sats, btcPrice) })) : [];

  const ask = (pk) => { setSelected(null); onRequest(pk); };

  return (
    <MapPage
      map={<MapView pickup={pickup} me={me} cars={drivers} pills={pills} onPill={setSelected} fitKey={`${fitKey}|${drivers.length}|${showMap}`} padBottom={showMap ? 300 : 420} />}
      top={top}
    >
      <Sheet label={title}>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold flex-1 min-w-0">{title}</h2>
          <button type="button" onClick={() => { setShowMap((v) => !v); setSelected(null); }} className="text-sm font-semibold underline shrink-0">
            {showMap ? "See list" : "See map"}
          </button>
        </div>
        {intro && <p className="text-neutral-600 text-sm mt-1">{intro}</p>}

        {rows.length === 0 && <p className="text-neutral-500 text-sm mt-3" role="status">No drivers are online nearby right now.</p>}

        {showMap ? (
          rows.length > 0 && (
            picked ? (
              <div className="mt-3 rounded-2xl border-2 border-black p-4" role="group" aria-label={`Request ${picked.name}`}>
                <p className="font-bold text-[17px]">{picked.name}</p>
                <p className="text-sm text-neutral-600">{picked.d.vehicle || "Car"} · {priceText(picked.sats)} for this trip</p>
                <div className="flex gap-2 mt-3">
                  <Button variant="secondary" size="md" full={false} onClick={() => setSelected(null)}>Close</Button>
                  <Button size="md" onClick={() => ask(picked.d.pubkey)} disabled={picked.sats == null}>Request {picked.name}</Button>
                </div>
              </div>
            ) : (
              <p className="text-neutral-500 text-sm mt-3">{open.length ? "Tap a driver's price on the map to ask that driver." : "Every driver nearby has already been asked."}</p>
            )
          )
        ) : (
          rows.length > 0 && (
            <ul className="mt-2 max-h-72 overflow-y-auto divide-y divide-neutral-100" aria-label="Drivers nearby">
              {rows.map((r) => {
                const st = status[r.d.pubkey];
                return (
                  <li key={r.d.pubkey} className="flex items-center gap-3 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold truncate">{r.name}</p>
                      <p className="text-sm text-neutral-600">{priceText(r.sats)}</p>
                    </div>
                    {st === "waiting" ? (
                      <span className="flex items-center gap-2 text-sm text-neutral-600"><Spinner size={16} /> Waiting for a reply</span>
                    ) : st === "declined" ? (
                      <span className="text-sm text-neutral-500">Declined</span>
                    ) : st === "passed" ? (
                      <span className="text-sm text-neutral-500">You passed</span>
                    ) : (
                      <Button size="sm" full={false} onClick={() => ask(r.d.pubkey)} disabled={r.sats == null} aria-label={`Request ${r.name}`}>Request</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        )}
        {footer}
      </Sheet>
    </MapPage>
  );
}
