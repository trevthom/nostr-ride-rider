// ════════════════════════════════════════════════════════════
//  VEHICLE SECTION — Vehicle photo, plate state/number, and
//  year/make/model. All are required to drive (with a face photo, a
//  license photo and a Lightning address). Saving keeps what was entered
//  and, if anything is still missing, names each missing section.
//  The form follows the SAVED vehicle until the user edits it, so a
//  profile that loads after the screen opens can't be overwritten by an
//  empty form.
//    gapsFor(vehicle)  what the driver still lacks if this vehicle is saved
//                      (lib/profile.js driveGaps, for the whole profile)
// ════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { resizeImage } from "../../lib/image.js";
import { gapsText } from "../../lib/profile.js";

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR + 1 - 1900 + 1 }, (_, i) => CURRENT_YEAR + 1 - i); // newest first
const FIELDS = ["picture", "plateState", "plateNumber", "year", "make", "model"];
const inputCls = "min-w-0 bg-white border border-neutral-300 rounded-lg py-2 text-black text-sm placeholder-neutral-500 focus:outline-none focus:border-black";

const formOf = (v) => Object.fromEntries(FIELDS.map((k) => [k, String(v?.[k] ?? "")]));

export default function VehicleSection({ vehicle, ready, onSave, gapsFor }) {
  const [veh, setVeh] = useState(() => formOf(vehicle));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imgErr, setImgErr] = useState("");
  const [stillNeeded, setStillNeeded] = useState(""); // names what is missing after a save

  // Follow the saved vehicle (e.g. restored after login) until edited.
  const savedKey = JSON.stringify(formOf(vehicle));
  useEffect(() => { if (!dirty) setVeh(formOf(vehicle)); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (patch) => { setVeh((s) => ({ ...s, ...patch })); setDirty(true); setStillNeeded(""); };

  const onPhotoPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgErr("");
    try {
      edit({ picture: await resizeImage(file, 300, 0.55) });
    } catch {
      setImgErr("Couldn't process that image.");
    }
  };

  const save = () => {
    const gaps = gapsFor ? gapsFor({ ...veh }) : [];
    setStillNeeded(gaps.length ? gapsText(gaps) : "");
    onSave({ ...veh });
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  // The badge shows the SAVED state; unsaved edits don't count yet.
  const badge = dirty
    ? { cls: "bg-neutral-200 text-neutral-700", text: "Unsaved changes" }
    : ready
    ? { cls: "bg-green-50 text-green-700", text: "Ready to drive" }
    : { cls: "bg-amber-50 text-amber-700", text: "Required to drive" };

  return (
    <div className="bg-neutral-100 rounded-xl border border-neutral-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-neutral-500 text-xs uppercase tracking-wider font-semibold">Vehicle &amp; plate</p>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>
      </div>

      <label className="cursor-pointer block">
        <input type="file" accept="image/*" onChange={onPhotoPick} className="sr-only" aria-label="Vehicle photo" />
        {veh.picture ? (
          <img src={veh.picture} alt="Vehicle" className="w-full h-32 object-cover rounded-lg border border-neutral-200" />
        ) : (
          <div className="w-full h-20 rounded-lg border border-dashed border-neutral-200 flex items-center justify-center text-neutral-500 text-sm">
            + Add vehicle photo (required)
          </div>
        )}
      </label>
      {veh.picture && (
        <button onClick={() => edit({ picture: "" })} className="text-red-600 text-[11px] -mt-1">Remove vehicle photo</button>
      )}
      {imgErr && <p className="text-red-600 text-xs">{imgErr}</p>}

      {/* Line 1: State · Plate number · Year */}
      <div className="flex gap-2">
        <select
          value={veh.plateState}
          onChange={(e) => edit({ plateState: e.target.value })}
          aria-label="Plate state"
          className={`w-20 px-2 ${inputCls}`}
        >
          <option value="">State</option>
          {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={veh.plateNumber}
          onChange={(e) => edit({ plateNumber: e.target.value.toUpperCase() })}
          placeholder="Plate #"
          aria-label="Plate number"
          className={`flex-1 px-3 ${inputCls}`}
        />
        <select
          value={veh.year}
          onChange={(e) => edit({ year: e.target.value })}
          aria-label="Vehicle year"
          className={`w-24 px-2 ${inputCls}`}
        >
          <option value="">Year</option>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Line 2: Make · Model (roomier) */}
      <div className="flex gap-2">
        <input value={veh.make} onChange={(e) => edit({ make: e.target.value })} placeholder="Make" aria-label="Vehicle make" className={`flex-1 px-3 ${inputCls}`} />
        <input value={veh.model} onChange={(e) => edit({ model: e.target.value })} placeholder="Model" aria-label="Vehicle model" className={`flex-1 px-3 ${inputCls}`} />
      </div>
      <button
        onClick={save}
        disabled={!dirty && !saved}
        className="w-full py-2.5 rounded-lg text-sm font-medium bg-black text-white disabled:bg-neutral-200 disabled:text-neutral-400"
      >
        {saved ? "Saved" : "Save vehicle info"}
      </button>
      {stillNeeded && !dirty && (
        <p className="text-amber-800 bg-amber-50 rounded-lg px-3 py-2 text-xs" role="alert">
          Saved. You can't go online yet. Still needed: {stillNeeded}.
        </p>
      )}
      <p className="text-neutral-500 text-[11px]">
        Your face photo and vehicle are public so riders know who's picking them up. Your plate stays private: only
        riders you make an offer to can see it. Removing any required item turns off driving until it's added back.
      </p>
    </div>
  );
}
