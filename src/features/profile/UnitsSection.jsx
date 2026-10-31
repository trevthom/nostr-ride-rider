// ════════════════════════════════════════════════════════════
//  UNITS — Account → Appearance → Units (drawn inside AppearanceSection): one switch like the dark mode switches. Off = miles, on = kilometers.
//  It saves and applies at once (lib/units.js). Only what is shown changes: fares are still worked out per mile underneath, so everyone agrees to the cent.
//  `small` follows the Appearance rows (slightly smaller text and switch).
// ════════════════════════════════════════════════════════════

import { useUnits } from "../../lib/units.js";
import { Toggle } from "../../ui/Parts.jsx";

export default function UnitsSection({ small = false }) {
  const [units, setUnits] = useUnits();
  return (
    <div className="flex items-center gap-3">
      <p className={`flex-1 min-w-0 font-medium ${small ? "text-sm" : "text-[15px]"}`}>Units (kilometers)</p>
      <Toggle checked={units === "km"} onChange={(on) => setUnits(on ? "km" : "mi")} label="Units (kilometers)" small={small} />
    </div>
  );
}
