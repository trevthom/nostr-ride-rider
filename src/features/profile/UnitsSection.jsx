// ════════════════════════════════════════════════════════════
//  UNITS — Account → Appearance → Units (drawn inside AppearanceSection): show distances in miles or kilometers. It saves and applies at once (lib/units.js).
//  Only what is shown changes: fares are still worked out per mile underneath, so everyone agrees to the cent.
// ════════════════════════════════════════════════════════════

import { useUnits } from "../../lib/units.js";

export default function UnitsSection() {
  const [units, setUnits] = useUnits();
  return (
    <section>
      <div className="flex gap-2" role="group" aria-label="Distance units">
        {[["mi", "Miles"], ["km", "Kilometers"]].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={units === id} onClick={() => setUnits(id)}
            className={`flex-1 py-2.5 rounded-full text-sm font-semibold ${units === id ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}>{label}</button>
        ))}
      </div>
      <p className="text-sm text-neutral-500 mt-2">Shows distances and prices per distance in {units === "km" ? "kilometers" : "miles"}. Saved on this device. Fares are the same either way.</p>
    </section>
  );
}
