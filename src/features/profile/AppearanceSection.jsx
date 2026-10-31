// ════════════════════════════════════════════════════════════
//  APPEARANCE — Two dark switches: \"Dark Mode (application)\" for the screens and \"Dark Mode (map)\" for the map only, and the
//  distance units (a third switch: off = miles, on = kilometers, lib/units.js). Each saves and applies as soon as it is flipped: there is no Save button
//  (lib/appearance.js and lib/units.js keep them on this device). The rows and switches are a little smaller than the
//  other settings, so all three fit one glance on a phone (Account → Appearance).
// ════════════════════════════════════════════════════════════

import { useDark, useDarkMap } from "../../lib/appearance.js";
import { SectionLabel, Toggle } from "../../ui/Parts.jsx";
import UnitsSection from "./UnitsSection.jsx";

export default function AppearanceSection() {
  const [dark, setDark] = useDark();
  const [darkMap, setDarkMap] = useDarkMap();
  return (
    <section>
      <SectionLabel>Appearance</SectionLabel>
      <div className="space-y-3.5">
        <div className="flex items-center gap-3">
          <p className="flex-1 min-w-0 text-sm font-medium">Dark Mode (application)</p>
          <Toggle checked={dark} onChange={setDark} label="Dark Mode (application)" small />
        </div>
        <div className="flex items-center gap-3">
          <p className="flex-1 min-w-0 text-sm font-medium">Dark Mode (map)</p>
          <Toggle checked={darkMap} onChange={setDarkMap} label="Dark Mode (map)" small />
        </div>
        <UnitsSection small />
      </div>
    </section>
  );
}
