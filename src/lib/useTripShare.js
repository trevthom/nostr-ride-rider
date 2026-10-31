// ════════════════════════════════════════════════════════════
//  USE TRIP SHARE — The "Share my trip" state for the ride on screen, for
//  either face (the rider's phone or the driver's). The link is made by
//  nostr/share.js: a throwaway key for the ride, the key only in the
//  link's #fragment, updates encrypted to it.
//    share        { key, token, sos } while this ride is being shared, else null
//    startShare   makes a key (or keeps the ride's) and turns sharing on
//    stopShare    tells viewers the trip ended and forgets the key
//    shareUpdate  publishes the trip's state (at most one per 4 s unless forced)
//    shareUrl     the link to send
// ════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { getSetting, setSetting } from "../config/relays.js";
import { newShareToken, publishShare, shareLink } from "../nostr/share.js";
import { rideKey } from "./rides.js";

export function useTripShare(activeRide) {
  const [shareState, setShareState] = useState(() => getSetting("tripShare", null)); // { key, token, sos }
  const lastShareAt = useRef(0);
  const share = shareState && activeRide && shareState.key === rideKey(activeRide) ? shareState : null;
  const startShare = useCallback((request, { sos = false } = {}) => {
    const key = rideKey(request);
    const next = { key, token: shareState?.key === key ? shareState.token : newShareToken(), sos: sos || (shareState?.key === key && !!shareState.sos) };
    setShareState(next);
    setSetting("tripShare", next);
    return next;
  }, [shareState]);
  const stopShare = useCallback(() => {
    if (shareState) publishShare(shareState.token, { ended: true, ts: Date.now() });
    setShareState(null);
    setSetting("tripShare", null);
  }, [shareState]);
  // Send the trip's state to viewers (at most one update per 4 s unless forced).
  const shareUpdate = useCallback((payload, { force = false } = {}) => {
    if (!share) return;
    const now = Date.now();
    if (!force && now - lastShareAt.current < 4000) return;
    lastShareAt.current = now;
    publishShare(share.token, { ...payload, sos: share.sos, ts: now });
  }, [share]);
  const shareUrl = useCallback((s) => shareLink(new URL("track.html", window.location.href).href, s.token), []);
  // The ride is over: tell viewers, and forget the key.
  useEffect(() => { if (shareState && !activeRide) stopShare(); }, [!!activeRide]); // eslint-disable-line react-hooks/exhaustive-deps
  return { share, startShare, stopShare, shareUpdate, shareUrl };
}
