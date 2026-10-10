// ════════════════════════════════════════════════════════════
//  USER MODAL — Tapping a person's name or photo opens this. Shows the
//  photo (tap to expand), name, role-split reputation (always shown, even
//  at 0), the full npub, and the vehicle if they have one.
//  Rendered above everything; close with ✕, Escape, or a tap outside.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { relay } from "../nostr/relay.js";
import { getProfile } from "../nostr/profiles.js";
import { fullNpub } from "../nostr/keys.js";
import { reputation } from "../lib/rides.js";
import Avatar from "./Avatar.jsx";
import { Rating } from "./Rating.jsx";
import Icon from "./Icon.jsx";
import BlockButton from "./BlockButton.jsx";

export default function UserModal() {
  const { profileModalPubkey, closeProfile } = useApp();
  const [zoom, setZoom] = useState(false);

  // Escape closes the modal.
  useEffect(() => {
    if (!profileModalPubkey) return;
    const onKey = (e) => { if (e.key === "Escape") closeProfile(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [profileModalPubkey, closeProfile]);

  useEffect(() => {
    if (profileModalPubkey) {
      relay.fetchProfile(profileModalPubkey);
      relay.fetchHistory(profileModalPubkey); // reputation beyond the last 24 h
    }
    setZoom(false);
  }, [profileModalPubkey]);

  if (!profileModalPubkey) return null;

  const p = getProfile(profileModalPubkey);
  const rep = reputation(profileModalPubkey);
  const name = p?.name || "Anonymous";
  const veh = p?.vehicle || null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="User profile"
      className="fixed inset-0 flex items-end sm:items-center justify-center bg-black/50 nr-fade"
      style={{ zIndex: 10040 }}
      onClick={closeProfile}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 text-center relative nr-slide-up"
        style={{ maxHeight: "88vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={closeProfile} aria-label="Close" className="absolute top-3 right-3 p-2 rounded-full active:bg-neutral-100">
          <Icon name="x" size={20} />
        </button>

        <div className="flex justify-center mb-3">
          <Avatar src={p?.picture} name={name} size={104} onClick={p?.picture ? () => setZoom(true) : undefined} />
        </div>
        <h2 className="text-2xl font-bold">{name}</h2>

        {/* Always show both roles, even at zero. */}
        <div className="flex justify-center gap-8 mt-4 text-sm">
          <div>
            <p className="text-neutral-500 text-[11px] font-semibold uppercase tracking-wider">As rider</p>
            <p className="font-medium">{rep.rides} trip{rep.rides === 1 ? "" : "s"}</p>
            <Rating avg={rep.riderReviews.avg} count={rep.riderReviews.count} />
          </div>
          <div>
            <p className="text-neutral-500 text-[11px] font-semibold uppercase tracking-wider">As driver</p>
            <p className="font-medium">{rep.drives} trip{rep.drives === 1 ? "" : "s"}</p>
            <Rating avg={rep.driverReviews.avg} count={rep.driverReviews.count} />
          </div>
        </div>

        {veh && (veh.make || veh.model || veh.plateNumber || veh.picture) && (
          <div className="mt-5 border-t border-neutral-200 pt-4 text-left">
            <p className="text-neutral-500 text-[11px] font-semibold uppercase tracking-wider mb-2">Vehicle</p>
            {veh.picture && (
              <img src={veh.picture} alt="Vehicle" onClick={() => setZoom("veh")} className="w-full h-32 object-cover rounded-xl mb-2 cursor-zoom-in" />
            )}
            {(veh.year || veh.make || veh.model) && (
              <p className="font-medium">{[veh.year, veh.make, veh.model].filter(Boolean).join(" ")}</p>
            )}
            {veh.plateState && veh.plateNumber && (
              <p className="text-neutral-500 text-sm">Plate: {veh.plateState} · {veh.plateNumber}</p>
            )}
          </div>
        )}

        <p className="text-neutral-500 text-[11px] font-mono break-all mt-5">{fullNpub(profileModalPubkey)}</p>
        <div className="mt-3"><BlockButton pubkey={profileModalPubkey} /></div>
      </div>

      {/* Expanded photo view */}
      {zoom && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 bg-black/90"
          style={{ zIndex: 10060 }}
          onClick={(e) => { e.stopPropagation(); setZoom(false); }}
        >
          <img src={zoom === "veh" ? veh?.picture : p?.picture} alt={name} className="max-w-[92vw] max-h-[85vh] object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}
