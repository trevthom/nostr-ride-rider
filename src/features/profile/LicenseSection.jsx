// ════════════════════════════════════════════════════════════
//  LICENSE SECTION — The driver's license photo. Required to drive.
//  The photo is encrypted to the driver's own key before it leaves the
//  device (lib/privacy.js sealLicense), so relays hold only ciphertext and
//  riders never see it. It is saved as its own event (kind 30092), not in
//  the public profile.
// ════════════════════════════════════════════════════════════

import { useRef, useState } from "react";
import { resizeImage } from "../../lib/image.js";

export default function LicenseSection({ picture, onSave }) {
  const fileRef = useRef(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    setBusy(true);
    try {
      // Larger than a face photo so the text stays readable, but small enough for one relay event.
      onSave(await resizeImage(file, 560, 0.6, 30000));
    } catch {
      setErr("Couldn't process that image. Try another photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-neutral-100 rounded-xl border border-neutral-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-neutral-500 text-xs uppercase tracking-wider font-semibold">Driver's license</p>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${picture ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
          {picture ? "On file" : "Required to drive"}
        </span>
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={pick} className="sr-only" aria-label="Driver's license photo" />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="block w-full text-left">
        {picture ? (
          <img src={picture} alt="Your driver's license" className="w-full h-40 object-cover rounded-lg border border-neutral-200" />
        ) : (
          <div className="w-full h-20 rounded-lg border border-dashed border-neutral-300 flex items-center justify-center text-neutral-500 text-sm">
            {busy ? "Saving…" : "+ Add a photo of your license (required)"}
          </div>
        )}
      </button>
      {picture && (
        <div className="flex gap-4 text-xs">
          <button type="button" onClick={() => fileRef.current?.click()} className="font-semibold underline">Replace photo</button>
          <button type="button" onClick={() => onSave("")} className="text-red-600">Remove photo</button>
        </div>
      )}
      {err && <p className="text-red-600 text-xs" role="alert">{err}</p>}
      <p className="text-neutral-500 text-[11px]">
        Encrypted on your device with your key. Only you can open it. Riders and other apps never see it.
        Removing it turns off driving until you add it back.
      </p>
    </div>
  );
}
