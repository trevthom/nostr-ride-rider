// ════════════════════════════════════════════════════════════
//  RIDER STATE — Everything only the rider app needs, on top of the
//  shared useApp() state:
//    • the rider's GPS position and a name for it ("here")
//    • online drivers nearby (public presence from the relays)
//    • the trip being planned (pickup, dropoff, when, notes)
//    • the CURRENT ride, derived from signed events (so a reload or
//      another device shows the same screen) and the receipt to show
//      after a trip
//    • actions: requestRide, confirmDriver, cancelRide, rateDriver
//  Banners: offers arriving, driver arrived, trip done, driver cancelled.
// ════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { subscribePresence } from "../../nostr/live.js";
import { useGeolocation } from "../../lib/useGeolocation.js";
import { reverseGeocode } from "../../lib/geocode.js";
import { haversineDistance } from "../../lib/geo.js";
import { pickupEta } from "../../lib/fare.js";
import { publicPlace, seal, exactTrip } from "../../lib/privacy.js";
import { activeRideFor, isOpenRide, upcomingRidesFor } from "../../lib/trips.js";
import { rideDriver, rideEnding, rideKey, rideStatus, rideVersions } from "../../lib/rides.js";
import { getSetting, setSetting } from "../../config/relays.js";
import { newShareToken, publishShare, shareLink } from "../../nostr/share.js";

const RiderContext = createContext(null);
export const useRider = () => useContext(RiderContext);

const HOUR = 3600000;
const EMPTY_PLAN = { step: "idle", pickup: null, dropoff: null, when: "ASAP", notes: "" };
const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

export function RiderProvider({ children }) {
  const { user, rideRequests, publish, refreshData, pullRecent, pushNotice, liveTick, setView, isBlockedPk } = useApp();
  const me = user.publicKey;
  const { pos: myPosition, error: geoError, status: gps } = useGeolocation(true);

  // ── Where am I, by name? (one lookup per ~300 m of movement) ──
  const [here, setHere] = useState(null);
  const hereAt = useRef(null);
  useEffect(() => {
    if (!myPosition) return;
    const last = hereAt.current;
    if (last && haversineDistance(last.lat, last.lng, myPosition.lat, myPosition.lng) < 0.2) return;
    hereAt.current = { lat: myPosition.lat, lng: myPosition.lng };
    let alive = true;
    const fallback = { name: "Current location", fullName: "Current location", area: "Near you", lat: myPosition.lat, lng: myPosition.lng };
    const mark = (p) => ({ ...p, fromGps: true }); // so the quote can warn when the fix was weak
    reverseGeocode(myPosition.lat, myPosition.lng)
      .then((p) => alive && setHere(mark(p || fallback)))
      .catch(() => alive && setHere(mark(fallback)));
    return () => { alive = false; };
  }, [myPosition?.lat, myPosition?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Online drivers nearby (public, coarsened presence) ──
  const [allDrivers, setAllDrivers] = useState([]);
  useEffect(() => subscribePresence(setAllDrivers, { excludePubkey: me }), [me]);
  const drivers = (myPosition
    ? allDrivers.filter((d) => haversineDistance(myPosition.lat, myPosition.lng, d.lat, d.lng) <= 25)
    : allDrivers).filter((d) => !isBlockedPk(d.pubkey));

  // ── The trip being planned ──
  const [plan, setPlanState] = useState(EMPTY_PLAN);
  const setPlan = useCallback((patch) => setPlanState((p) => ({ ...p, ...patch })), []);
  const resetPlan = useCallback(() => setPlanState(EMPTY_PLAN), []);

  // ── The current ride, from events ──
  void liveTick; // re-derive when relay events arrive
  // A reservation the rider opened from Activity takes the home screen until
  // closed (or until a driver is confirmed, which makes it the active ride).
  const [focusId, setFocusId] = useState(null);
  const focused = focusId ? rideRequests.find((r) => r.id === focusId && isOpenRide(r)) : null;
  const activeRide = focused || activeRideFor(rideRequests, me);
  const upcoming = upcomingRidesFor(rideRequests, me);

  // ── The receipt to show after a trip ends ──
  const [doneKeys, setDoneKeys] = useState(() => getSetting("riderDone", []));
  const receipt =
    rideRequests
      .filter((r) => r.pubkey === me && !doneKeys.includes(rideKey(r)))
      .map((r) => ({ r, end: rideEnding(r) }))
      .filter(({ r, end }) => {
        if (!end || Date.now() - end.at * 1000 > 6 * HOUR) return false;
        const status = rideStatus(r);
        if (status === "completed") return true;
        // A cancel by the driver is news; one by me is not.
        return status === "cancelled" && end.by !== me && !!rideDriver(r);
      })
      .sort((a, b) => b.end.at - a.end.at)[0]?.r || null;
  const dismissReceipt = useCallback((request) => {
    setDoneKeys((keys) => {
      const next = [...keys, rideKey(request)].slice(-100);
      setSetting("riderDone", next);
      return next;
    });
  }, []);

  // ── "Share my trip": a friend follows a link (see nostr/share.js) ──
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

  // While a ride is open, poll so the driver's moves show up even if the
  // live subscription missed them.
  const rideOpen = !!activeRide;
  useEffect(() => {
    if (!rideOpen) return;
    const id = setInterval(() => pullRecent(), 6000);
    return () => clearInterval(id);
  }, [rideOpen, pullRecent]);

  // ── Banners for what the driver does ──
  useEffect(() => {
    const since = Math.floor(Date.now() / 1000) - 60;
    return relay.onEvent((_id, ev) => {
      if (ev.pubkey === me || ev.created_at < since) return;
      if (!(ev.tags || []).some((t) => t[0] === "p" && t[1] === me)) return;
      const c = parse(ev);
      if (ev.kind === EVENT_KINDS.RIDE_OFFER && !isBlockedPk(ev.pubkey)) pushNotice("A driver can pick you up. Check the offer.");
      else if (ev.kind === EVENT_KINDS.RIDE_STAGE && c?.stage === "arrived") pushNotice("Your driver has arrived.");
      else if (ev.kind === EVENT_KINDS.RIDE_COMPLETE) pushNotice("Your trip is complete.");
      else if (ev.kind === EVENT_KINDS.RIDE_CANCEL) pushNotice("Your driver cancelled the ride.");
    });
  }, [me, pushNotice, isBlockedPk]);

  // ── Actions ──
  const [sendFailed, setSendFailed] = useState(false);

  // Publish a ride request. Only an approximate area is public; the exact
  // trip is sealed to the rider (and to the driver after they are chosen).
  const requestRide = useCallback(
    ({ pickup, dropoff, when, notes, miles, minutes, fareSats }) => {
      setSendFailed(false);
      const sent = publish(
        EVENT_KINDS.RIDE_REQUEST,
        {
          pickup: publicPlace(pickup),
          dropoff: publicPlace(dropoff),
          time: when,
          notes,
          status: "requested",
          fareSats,
          distanceMiles: Math.round(miles * 10) / 10,
          durationMin: minutes,
          sealed: seal(user.sk, me, { pickup, dropoff }),
        },
        [["d", "ride-" + Date.now()], ["t", "ride-request"]]
      );
      refreshData();
      resetPlan();
      sent.then((ok) => setSendFailed(!ok));
      // A reservation doesn't take over the home screen, so say where it went.
      if (when !== "ASAP" && Date.parse(when) - Date.now() > 30 * 60000) {
        pushNotice(`Ride reserved for ${new Date(when).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}. Drivers can accept it from now on.`);
        setView("activity");
      }
    },
    [publish, refreshData, resetPlan, user.sk, me, pushNotice, setView]
  );

  // Keep a signed record of a payment (the proof is sealed to the driver, so only
  // the two of them can read it). phase: "deposit" | "rest".
  const recordPayment = useCallback(
    (request, driverPubkey, phase, amountSats, proof) => {
      publish(
        EVENT_KINDS.RIDE_PAYMENT,
        {
          phase,
          amountSats,
          level: proof.level || "claimed",
          sealed: seal(user.sk, driverPubkey, {
            requestId: request.id, phase, amountSats, pr: proof.pr || "", preimage: proof.preimage || "", verify: proof.verify || "", at: Date.now(),
          }),
        },
        [["e", request.id], ["p", driverPubkey], ["d", `pay-${rideKey(request)}-${phase}`], ["t", "ride-payment"]]
      );
    },
    [publish, user.sk]
  );

  // The rider's own signed word on the trip: phase "boarded" or "ended".
  // ok=false means "I want to report a problem" (note says what).
  const confirmRide = useCallback(
    (request, phase, ok = true, note = "") => {
      const driver = rideDriver(request);
      publish(
        EVENT_KINDS.RIDE_CONFIRM,
        { phase, ok, note: String(note).slice(0, 500) },
        [["e", request.id], ...(driver ? [["p", driver]] : []), ["d", `confirm-${rideKey(request)}-${phase}`], ["t", "ride-confirm"]]
      );
      refreshData();
    },
    [publish, refreshData]
  );

  // The rider picked a driver and paid the deposit: accept the offer and
  // hand the driver the exact trip.
  const confirmDriver = useCallback(
    (request, offerEvent, proof = {}) => {
      const { verified = false, level = "claimed" } = proof;
      const driver = offerEvent.pubkey;
      const offer = parse(offerEvent) || {};
      const trip = exactTrip(request, user);
      publish(
        EVENT_KINDS.RIDE_ACCEPT,
        {
          offerId: offerEvent.id,
          requestId: request.id,
          paidSats: offer.upfrontSats || 0,
          verified,
          level,
          ...(trip && { sealed: seal(user.sk, driver, trip) }),
        },
        [["e", offerEvent.id], ["e", request.id], ["p", driver], ["d", "accept-" + request.id], ["t", "ride-accept"]]
      );
      publish(
        EVENT_KINDS.RIDE_REQUEST,
        { ...parse(request), status: "in_progress", driverPubkey: driver },
        // p-tag the driver so their app can find this ride on the relays.
        [...request.tags.filter((t) => t[0] !== "p"), ["p", driver]]
      );
      if ((offer.upfrontSats || 0) > 0) recordPayment(request, driver, "deposit", offer.upfrontSats, proof);
      refreshData();
    },
    [publish, refreshData, user, recordPayment]
  );

  // Cancel the ride (open or running). A running ride tells the driver.
  const cancelRide = useCallback(
    (request) => {
      const latest = rideVersions(request)[0] || request;
      const driver = rideDriver(latest);
      publish(
        EVENT_KINDS.RIDE_CANCEL,
        { requestId: latest.id, reason: "Cancelled by rider" },
        [["e", latest.id], ...(driver ? [["p", driver]] : []), ["d", "cancel-" + latest.id], ["t", "ride-cancel"]]
      );
      // An open request is also re-published as cancelled so other clients drop it.
      if (!driver) publish(EVENT_KINDS.RIDE_REQUEST, { ...parse(latest), status: "cancelled" }, latest.tags);
      refreshData();
    },
    [publish, refreshData]
  );

  const rateDriver = useCallback(
    (request, driverPubkey, rating, review) => {
      publish(
        EVENT_KINDS.RATING,
        { rating, review, rideId: request.id },
        [["p", driverPubkey], ["e", request.id], ["d", "rating-" + request.id], ["t", "rating"]]
      );
    },
    [publish]
  );

  // Places the rider has been to, newest first (for quick "Where to?" picks).
  const recentPlaces = () => {
    const seen = new Set();
    const out = [];
    rideRequests
      .filter((r) => r.pubkey === me)
      .sort((a, b) => b.created_at - a.created_at)
      .forEach((r) => {
        const d = exactTrip(r, user)?.dropoff;
        // The public copy of the dropoff names only the area; keep it so a
        // repeat trip publishes the same coarse label.
        if (d && !seen.has(d.name) && out.length < 4) { seen.add(d.name); out.push({ ...d, area: parse(r)?.dropoff?.name || "" }); }
      });
    return out;
  };

  const value = {
    myPosition, geoError, gps, here, drivers,
    plan, setPlan, resetPlan,
    share, startShare, stopShare, shareUpdate, shareUrl,
    activeRide, focused: !!focused, focusRide: (r) => setFocusId(r ? r.id : null), upcoming, receipt, dismissReceipt,
    sendFailed, requestRide, confirmDriver, recordPayment, confirmRide, cancelRide, rateDriver, recentPlaces,
    nearestDriverEta: (to) => {
      if (!to || !drivers.length) return null;
      const miles = Math.min(...drivers.map((d) => haversineDistance(to.lat, to.lng, d.lat, d.lng)));
      return pickupEta(miles);
    },
  };
  return <RiderContext.Provider value={value}>{children}</RiderContext.Provider>;
}
