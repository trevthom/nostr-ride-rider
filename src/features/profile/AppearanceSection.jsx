// ════════════════════════════════════════════════════════════
//  APPEARANCE — Two dark switches (both apps): "Dark Mode (application)" for the screens and "Dark Mode (map)" for the map only.
//  Each saves and applies as soon as it is flipped: there is no Save button (lib/appearance.js keeps them on this device).
// ════════════════════════════════════════════════════════════

import { useDark, useDarkMap } from "../../lib/appearance.js";
import { SectionLabel, Toggle } from "../../ui/Parts.jsx";

export default function AppearanceSection() {
  const [dark, setDark] = useDark();
  const [darkMap, setDarkMap] = useDarkMap();
  return (
    <section>
      <SectionLabel>Appearance</SectionLabel>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <p className="flex-1 min-w-0 text-[15px] font-medium">Dark Mode (application)</p>
          <Toggle checked={dark} onChange={setDark} label="Dark Mode (application)" />
        </div>
        <div className="flex items-center gap-3">
          <p className="flex-1 min-w-0 text-[15px] font-medium">Dark Mode (map)</p>
          <Toggle checked={darkMap} onChange={setDarkMap} label="Dark Mode (map)" />
        </div>
      </div>
    </section>
  );
}
