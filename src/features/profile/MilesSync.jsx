// ════════════════════════════════════════════════════════════
//  MILES SYNC — Draws nothing. Counts the miles this person has driven (lib/mileage.js,
//  from their own finished rides) and keeps the total in their profile (kind 0
//  `stats`), so others can read it without reading any job event. Checked 5 s after the data
//  changes; saved only when the total moved by 0.1 or more.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useSaveProfile } from "./ProfileParts.jsx";
import { milesDriven } from "../../lib/mileage.js";

export default function MilesSync() {
  const { user, rideRequests, liveTick } = useApp();
  if (!user) return null;
  return <Inner user={user} rides={rideRequests} tick={liveTick} />;
}

function Inner({ user, rides, tick }) {
  const save = useSaveProfile();
  const saved = useRef(user.stats?.miles || 0);
  useEffect(() => { saved.current = user.stats?.miles || 0; }, [user.stats]);
  useEffect(() => {
    const t = setTimeout(() => {
      const total = milesDriven(rides || [], user.publicKey);
      if (total > 0 && Math.abs(total - saved.current) >= 0.1) {
        saved.current = total;
        save({ stats: { miles: total } });
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [rides, tick, user.publicKey, save]);
  return null;
}
