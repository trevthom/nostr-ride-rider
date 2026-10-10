// ════════════════════════════════════════════════════════════
//  GENDER PREFERENCE — Optional. The rider can ask to see drivers of one
//  gender first. It only changes the ORDER of the driver list: nobody is
//  hidden, and the choice stays on this device (it is never published).
//  Drivers set their own gender, also optional, in the driver app.
// ════════════════════════════════════════════════════════════

import { useRider } from "../state/RiderContext.jsx";

const CHOICES = [["", "No preference"], ["female", "Female first"], ["male", "Male first"]];

export default function GenderPref({ className = "" }) {
  const { genderPref, setGenderPref } = useRider();
  return (
    <div className={className}>
      <p className="text-sm font-semibold mb-1.5">Driver preference <span className="font-normal text-neutral-500">(optional)</span></p>
      <div className="flex gap-2" role="group" aria-label="Driver preference">
        {CHOICES.map(([id, label]) => (
          <button
            key={id || "none"}
            type="button"
            aria-pressed={genderPref === id}
            onClick={() => setGenderPref(id)}
            className={`flex-1 py-2 rounded-full text-[13px] font-semibold ${genderPref === id ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-neutral-500 text-xs mt-1.5">Those drivers show at the top of your list. Other drivers still appear below them.</p>
    </div>
  );
}
