// ════════════════════════════════════════════════════════════
//  USE RIDE LINK — Keeps watch on the connection between the two phones
//  during a ride, for both apps (lib/finish.js has the rules):
//
//    • a phone that goes quiet is NOT a finish. After 2 minutes of quiet the
//      other person is asked: "Is your rider still with you?" / "Is your driver
//      still driving?" One tap sends a signed sign of life (kind 30098);
//    • when BOTH phones were silent for 10 minutes, the ride finishes and the charge
//      runs up to the last signal. This is checked once, when an app starts (or wakes up) —
//      a running app is never silent, because it sends a signal every few seconds;
//    • time when our own relays were unreachable is not counted against anyone.
//
//  The app saves "my last signal" for the ride on this device every few seconds, so
//  that after a reload it can tell how long it was gone.
//
//    useRideLink({ request, role, otherHeardAt, active, onSilence }) → { quiet, askVouch, vouch }
//      role          "rider" | "driver" (whose app this is)
//      otherHeardAt  ms of the last live signal heard from the other person (location / meter), or null
//      active        true while the ride is running (started, not ended)
//      onSilence({ cutoff })  called once if both were silent for 10 minutes
//      quiet         ms the OTHER person has been quiet (relay outages left out)
//      askVouch      true when the other person should be asked "still with you?"
//      vouch()       send the sign of life
// ════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { link } from "../../nostr/link.js";
import { rideDriver, rideKey } from "../../lib/rides.js";
import { aliveEvent, signalTimes } from "../../lib/payments.js";
import { quietMs } from "../../lib/finish.js";
import { getSetting, setSetting } from "../../config/relays.js";
import { SIGNAL_STORE as STORE, silenceCutoff } from "../../lib/ridemoney.js";

export const ASK_AFTER_MS = 120000;
const SAVE_EVERY_MS = 6000;

export function useRideLink({ request, role, otherHeardAt, active, onSilence }) {
  const { user, publish, liveTick } = useApp();
  const key = rideKey(request);
  const other = role === "rider" ? rideDriver(request) : request.pubkey;
  const [, setTick] = useState(0);
  const checked = useRef(null);
  const heard = useRef(otherHeardAt);
  heard.current = otherHeardAt;
  void liveTick;

  // The other person's last signal: the newest of the live one and the signed events in the cache.
  const lastOther = () => {
    const sig = signalTimes(request);
    const stored = role === "rider" ? sig.driverAt : sig.riderAt;
    return Math.max(stored ?? 0, heard.current ?? 0) || null;
  };

  // Once, when the app starts for this ride: were both of us silent for 10 minutes? (lib/ridemoney.js silenceCutoff)
  useEffect(() => {
    if (!active || !other || checked.current === key) return;
    checked.current = key;
    const cutoff = silenceCutoff(request, role, Date.now());
    if (cutoff != null) onSilence({ cutoff });
  }, [active, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // While we run: remember our own last signal, and re-render now and then so "quiet" stays current.
  useEffect(() => {
    if (!active) return;
    const save = () => {
      if (!link.up()) return; // a relay outage is nobody's silence: do not pretend we signalled
      const all = getSetting(STORE, {});
      setSetting(STORE, Object.fromEntries(Object.entries({ ...all, [key]: Date.now() }).slice(-8)));
    };
    save();
    const id1 = setInterval(save, SAVE_EVERY_MS);
    const id2 = setInterval(() => setTick((t) => t + 1), 5000);
    return () => { clearInterval(id1); clearInterval(id2); };
  }, [active, key]);

  const last = active ? lastOther() : null;
  const quiet = last == null ? 0 : quietMs(last, Date.now(), link.downMsSince(last));
  const askVouch = active && last != null && quiet >= ASK_AFTER_MS;

  const vouch = useCallback(() => {
    if (!other) return;
    const ev = aliveEvent(request, other, role, role === "rider" ? "driver" : "rider");
    publish(ev.kind, ev.content, ev.tags);
  }, [request, other, role, publish]);

  void user;
  return { quiet, askVouch, vouch };
}
