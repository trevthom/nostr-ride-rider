// ════════════════════════════════════════════════════════════
//  VEHICLE SECTION — Vehicle photos (one is required, up to three can be added), plate state/number, and
//  year/make/model. All are required to drive (with a face photo). Saving keeps what was entered
//  and, if anything is still missing, names each missing section.
//  The photos are saved as `picture` (the main one, which older apps read) and `morePictures` (the others). Together they must fit
//  the profile event (kind 0), so several photos are kept small (PHOTO_BYTES each).
//  The form follows the SAVED vehicle until the user edits it, so a
//  profile that loads after the screen opens can't be overwritten by an
//  empty form.
//    gapsFor(vehicle)  what the driver still lacks if this vehicle is saved
//                      (lib/profile.js driveGaps, for the whole profile)
// ════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { resizeImage, shrinkDataUrl } from "../../lib/image.js";
import { gapsText, vehiclePhotos, MAX_VEHICLE_PHOTOS } from "../../lib/profile.js";
import { FoldTitle } from "../../ui/Fold.jsx";

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR + 1 - 1900 + 1 }, (_, i) => CURRENT_YEAR + 1 - i); // newest first
const FIELDS = ["plateState", "plateNumber", "year", "make", "model"];
const PHOTO_BYTES = 12000; // one photo's data URL; 3 of these + the face photo stay under the 64 KB many relays allow for one event
const inputCls = "min-w-0 bg-white border border-neutral-300 rounded-lg py-2 text-black text-sm placeholder-neutral-500 focus:outline-none focus:border-black";

const formOf = (v) => ({ ...Object.fromEntries(FIELDS.map((k) => [k, String(v?.[k] ?? "")])), photos: vehiclePhotos(v) });

export default function VehicleSection({ vehicle, ready, onSave, gapsFor }) {
  const [veh, setVeh] = useState(() => formOf(vehicle));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imgErr, setImgErr] = useState("");
  const [stillNeeded, setStillNeeded] = useState(""); // names what is missing after a save
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // Follow the saved vehicle (e.g. restored after login) until edited.
  const savedKey = JSON.stringify(formOf(vehicle));
  useEffect(() => { if (!dirty) setVeh(formOf(vehicle)); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (patch) => { setVeh((s) => ({ ...s, ...patch })); setDirty(true); setStillNeeded(""); };

  const onPhotoPick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = ""; // so the same file can be picked again
    if (!files.length) return;
    setImgErr("");
    try {
      const room = MAX_VEHICLE_PHOTOS - veh.photos.length;
      const added = [];
      for (const file of files.slice(0, Math.max(0, room))) added.push(await resizeImage(file, 300, 0.55, PHOTO_BYTES));
      if (added.length) edit({ photos: [...veh.photos, ...added] });
      if (files.length > room) setImgErr(`A vehicle can have up to ${MAX_VEHICLE_PHOTOS} photos.`);
    } catch {
      setImgErr("Couldn't process that image.");
    }
  };
  const removePhoto = (i) => edit({ photos: veh.photos.filter((_, j) => j !== i) });

  const save = async () => {
    setBusy(true);
    // With more than one photo, an older, bigger photo is made small too, so the profile event stays within a relay's size limit.
    let photos = veh.photos;
    if (photos.length > 1) {
      try { photos = await Promise.all(photos.map((p) => (p.length > PHOTO_BYTES ? shrinkDataUrl(p, 300, 0.55, PHOTO_BYTES) : p))); }
      catch { setImgErr("Couldn't process a photo. Try removing it and adding it again."); setBusy(false); return; }
    }
    const { photos: _all, ...rest } = veh;
    const vehicle = { ...rest, picture: photos[0] || "", ...(photos.length > 1 && { morePictures: photos.slice(1) }) };
    const gaps = gapsFor ? gapsFor(vehicle) : [];
    setStillNeeded(gaps.length ? gapsText(gaps) : "");
    onSave(vehicle);
    setBusy(false);
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
      <FoldTitle right={<span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>}>Vehicle &amp; plate</FoldTitle>

      <div>
        <p className="text-neutral-500 text-xs mb-1">Vehicle photos: one is required, up to {MAX_VEHICLE_PHOTOS}</p>
        <div className="grid grid-cols-3 gap-2">
          {veh.photos.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt={`Vehicle photo ${i + 1}`} className="w-full h-20 object-cover rounded-lg border border-neutral-200" />
              <button type="button" aria-label={`Remove vehicle photo ${i + 1}`} onClick={() => removePhoto(i)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-[#000]/60 text-[#fff] text-sm leading-none flex items-center justify-center">×</button>
            </div>
          ))}
          {veh.photos.length < MAX_VEHICLE_PHOTOS && (
            <button type="button" onClick={() => fileRef.current?.click()}
              className="h-20 rounded-lg border border-dashed border-neutral-300 flex items-center justify-center text-center text-neutral-500 text-xs px-1">
              + Add photo{veh.photos.length === 0 ? " (required)" : ""}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPhotoPick} className="sr-only" aria-label="Vehicle photo" />
      </div>
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
        disabled={(!dirty && !saved) || busy}
        className="w-full py-2.5 rounded-lg text-sm font-medium bg-black text-white disabled:bg-neutral-200 disabled:text-neutral-400"
      >
        {busy ? "Saving…" : saved ? "Saved" : "Save vehicle info"}
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
