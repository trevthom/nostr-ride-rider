// ════════════════════════════════════════════════════════════
//  GENDER PREFERENCE — Optional. "Female only" or "Male only" shows the rider ONLY the drivers who declared that gender
//  (their own setting, also optional). A driver who has not declared a gender is not shown to a rider who asked. The choice
//  stays on this device (it is never published). "No preference" shows everyone.
// ════════════════════════════════════════════════════════════

import { useRider } from "../state/RiderContext.jsx";

const CHOICES = [["", "No preference"], ["female", "Female only"], ["male", "Male only"]];

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
    </div>
  );
}
