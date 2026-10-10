// ════════════════════════════════════════════════════════════
//  DRIVER INFO — How the rider sees a driver: photo, name, rating,
//  car and plate. The plate comes sealed in the driver's offer, so only
//  this rider can read it (lib/privacy.js offerPlate).
// ════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { getProfile } from "../../nostr/profiles.js";
import { shortNpub } from "../../nostr/keys.js";
import { reputation } from "../../lib/rides.js";
import { offerPlate } from "../../lib/privacy.js";
import Avatar from "../../ui/Avatar.jsx";
import { Rating } from "../../ui/Rating.jsx";

export const carText = (v) => (v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "");

// Profile + driver-role reputation for one pubkey (pulled from relays on mount).
export function useDriverInfo(pubkey) {
  const { liveTick } = useApp();
  void liveTick; // re-read when the profile arrives
  useEffect(() => {
    if (!pubkey) return;
    relay.fetchProfile(pubkey);
    relay.fetchHistory(pubkey);
  }, [pubkey]);
  return {
    profile: pubkey ? getProfile(pubkey) : null,
    rating: pubkey ? reputation(pubkey).driverReviews : { avg: null, count: 0 },
    trips: pubkey ? reputation(pubkey).drives : 0,
  };
}

export function Plate({ plate }) {
  if (!plate?.plateNumber) return null;
  return (
    <span className="inline-flex items-center gap-1.5 border-2 border-neutral-800 rounded-md px-2 py-0.5 bg-white font-mono text-sm font-bold tracking-wider">
      <span className="text-[10px] text-neutral-500">{plate.plateState}</span>
      {plate.plateNumber}
    </span>
  );
}

// offerEvent: the driver's offer (for the sealed plate). compact: one line.
export default function DriverInfo({ pubkey, offerEvent, compact = false }) {
  const { user, openProfile } = useApp();
  const { profile, rating } = useDriverInfo(pubkey);
  const plate = offerPlate(offerEvent, user);
  const name = profile?.name || shortNpub(pubkey);
  const car = carText(profile?.vehicle);
  return (
    <div className="flex items-center gap-3">
      <Avatar src={profile?.picture} name={name} size={compact ? 44 : 56} onClick={() => openProfile(pubkey)} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate">{name}</p>
        <Rating avg={rating.avg} count={rating.count} />
        {car && <p className="text-sm text-neutral-600 truncate">{car}</p>}
      </div>
      {plate && <Plate plate={plate} />}
    </div>
  );
}
