// ════════════════════════════════════════════════════════════
//  RIDER STATE — Everything only the rider app needs, on top of the
//  shared useApp() state:
//    • the rider's GPS position and a name for it ("here")
//    • online drivers nearby (public presence from the relays)
//    • the trip being planned (pickup, dropoff, when, notes, the rider's price offer)
//    • the optional driver-gender preference (sorting only, kept on this device)
//    • the CURRENT ride, derived from signed events (so a reload or
//      another device shows the same screen) and the receipt to show
//      after a trip
//    • actions: requestRide, proposePickup, confirmDriver, declineOffer, finishRide
//    • the ride's MONEY: while a ride runs (and after it ended, until it is paid) the rider's app pays
//      the driver in ecash ticks (features/payments/rideTicks.js) and reports `money` to the screens
//  Banners: offers arriving, driver arrived, trip done, driver finished the ride, waived fares.
// ════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { subscribePresence } from "../../nostr/live.js";
import { useGeolocation } from "../../lib/useGeolocation.js";
import { useWakeLock } from "../../lib/useWakeLock.js";
import { reverseGeocode } from "../../lib/geocode.js";
import { haversineDistance } from "../../lib/geo.js";
import { pickupEta } from "../../lib/fare.js";
import { publicPlace, seal, exactTrip } from "../../lib/privacy.js";
import { PICKUP_CHANGE_NOTE } from "../../lib/pickup.js";
import { stopRequestEvent } from "../../lib/stops.js";
import { activeRideFor, isOpenRide, upcomingRidesFor } from "../../lib/trips.js";
import { rideDriver, rideEnding, rideKey, rideStatus, rideVersions, rideTimes, rideExpiryMs, isRideExpired } from "../../lib/rides.js";
import { hideList } from "../../lib/blocks.js";
import { onlyPreferred } from "../../lib/gender.js";
import { nearestDriver } from "../../lib/audience.js";
import { addAudience } from "../../lib/audienceStore.js";
import { getProfile } from "../../nostr/profiles.js";
import { rememberRates } from "../../lib/ratechange.js";
import { declineEvent } from "../../lib/trips.js";
import { rideTerms, rideMint } from "../../lib/terms.js";
import { ledgerSummary } from "../../lib/ridemoney.js";
import { rideSpendCap, allowMoreSpend } from "../../lib/spendcap.js";
import { payDue } from "../../features/payments/rideTicks.js";
import { useAutoCashOut } from "../../features/ecash/useAutoCashOut.js";
import { redeemWaiversFor } from "../../features/payments/redeemWaivers.js";
import { moneyText } from "../../ui/Money.jsx";
import { getSetting, setSetting } from "../../config/relays.js";
import { newShareToken, publishShare, shareLink } from "../../nostr/share.js";

const RiderContext = createContext(null);
export const useRider = () => useContext(RiderContext);

const HOUR = 3600000;
const EMPTY_PLAN = { step: "idle", from: "idle", pinField: "pickup", pickup: null, dropoff: null, when: "ASAP", notes: "" };
const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

export function RiderProvider({ children }) {
  const { user, rideRequests, publish, refreshData, pullRecent, pushNotice, liveTick, setView, isBlockedPk, blocked, onLogout, ecash, priceFor, btcPrice, usdPrice } = useApp();
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
  const allDriversRef = useRef([]);
  allDriversRef.current = allDrivers; // the banners below read the names from here
  useEffect(() => subscribePresence(setAllDrivers, { excludePubkey: me, viewerSk: user.sk }), [me]);
  // The optional driver preference: "Female only" / "Male only" shows only the drivers who declared that gender (lib/gender.js).
  // It stays on this device and is never published.
  const [genderPref, setGenderPrefState] = useState(() => getSetting("genderPref", ""));
  const setGenderPref = useCallback((v) => { setGenderPrefState(v); setSetting("genderPref", v); }, []);
  const [notifyNearest, setNotifyNearestState] = useState(() => getSetting("notifyNearest", false) === true);
  const setNotifyNearest = useCallback((v) => { setNotifyNearestState(!!v); setSetting("notifyNearest", !!v); }, []);
  const drivers = onlyPreferred(
    (myPosition
      ? allDrivers.filter((d) => haversineDistance(myPosition.lat, myPosition.lng, d.lat, d.lng) <= 25)
      : allDrivers).filter((d) => !isBlockedPk(d.pubkey)),
    genderPref
  );
  // A driver whose presence does not say the gender (an older app) may have it in their profile: fetch the profiles of the nearby ones.
  const askedProfiles = useRef(new Set());
  useEffect(() => {
    if (genderPref !== "male" && genderPref !== "female") return;
    allDrivers.filter((d) => !d.gender && !getProfile(d.pubkey)?.gender && !askedProfiles.current.has(d.pubkey)).slice(0, 20).forEach((d) => {
      askedProfiles.current.add(d.pubkey);
      relay.fetchProfile(d.pubkey);
    });
  }, [genderPref, allDrivers]);

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
        // The driver finishing before the ride started is news; my own finish is not.
        return status === "closed" && end.by !== me && !!rideDriver(r);
      })
      .sort((a, b) => b.end.at - a.end.at)[0]?.r || null;
  const dismissReceipt = useCallback((request) => {
    setDoneKeys((keys) => {
      const next = [...keys, rideKey(request)].slice(-100);
      setSetting("riderDone", next);
      return next;
    });
  }, []);

  // Cashes out by itself at the amount set in Account → Wallets, but never while a ride runs or its last payments may still be due.
  useAutoCashOut({ locked: !!activeRide || !!receipt });

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
      else if (ev.kind === EVENT_KINDS.RIDE_DRIVER_DECLINE) pushNotice(`${allDriversRef.current.find((x) => x.pubkey === ev.pubkey)?.name || getProfile(ev.pubkey)?.name || "The driver"} declined your ride request. Choose another driver.`);
      else if (ev.kind === EVENT_KINDS.RIDE_STAGE && c?.stage === "arrived") pushNotice("Your driver has arrived.");
      else if (ev.kind === EVENT_KINDS.RIDE_COMPLETE) pushNotice("Your driver finished the ride.");
      else if (ev.kind === EVENT_KINDS.RIDE_FINISH) pushNotice("Your driver finished the ride.");
      else if (ev.kind === EVENT_KINDS.RIDE_WAIVER && (c?.forgivenSats > 0 || c?.refundSats > 0)) pushNotice(`Your driver waived part of the fare${c.refundSats > 0 ? " and sent money back" : ""}.`);
      else if (ev.kind === EVENT_KINDS.RIDE_STOP_REPLY) pushNotice(c?.accepted ? "Your driver accepted the extra stop." : "Your driver did not accept the extra stop.");
      else if (ev.kind === EVENT_KINDS.RIDE_PICKUP_REPLY) {
        pushNotice(c?.accepted ? `Your driver accepted the new pickup. ${PICKUP_CHANGE_NOTE}` : `Your driver declined the new pickup, so you still meet at the first place. ${PICKUP_CHANGE_NOTE}`);
      }
    });
  }, [me, pushNotice, isBlockedPk]);

  // ── The ride's money: pay the driver tick by tick, and collect refunds ──
  const payRide = activeRide && rideStatus(activeRide) === "in_progress" ? activeRide : receipt;
  // A sleeping phone stops the timer below, so no tick is paid and the driver sees "missed payments" with a full wallet.
  // Keep the screen on for as long as the ride runs; `screenMayDim` is true when the browser would not give us the lock.
  const screenMayDim = useWakeLock(!!activeRide && rideStatus(activeRide) === "in_progress");
  const milesRef = useRef(null); // the trip distance both screens show, reported by the trip screen
  const reportMiles = useCallback((m) => { milesRef.current = m; }, []);
  const [money, setMoney] = useState(null);
  const payTerms = payRide ? rideTerms(payRide) : null;
  const payMint = payRide ? rideMint(payRide) : null;
  const payKey = payRide ? rideKey(payRide) : null;
  const run = useCallback(async (request) => {
    const terms = rideTerms(request);
    if (!terms || !rideTimes(request).startedAt) return null;
    const price = priceFor(terms.currency);
    // The app pays by itself, so each ride has a cap (lib/spendcap.js): at the cap it stops and asks the rider.
    const capSats = rideSpendCap(request, { terms, price, usdPrice });
    const res = await payDue({ request, user, ecash, publish, terms, mint: rideMint(request), price, nowMs: Date.now(), miles: milesRef.current, capSats });
    return res;
  }, [user, ecash, publish, priceFor, usdPrice]);
  useEffect(() => { setMoney(null); }, [payKey]);
  useEffect(() => {
    if (!payRide || !payTerms) return;
    let alive = true, running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const res = await run(payRide);
        if (alive && res) setMoney((m) => (m && m.status === res.status && m.owed === res.owed && m.paid === res.paid && m.due === res.due && m.sent === res.sent && m.outstanding === res.outstanding ? m : { ...res, at: Date.now() }));
      } finally { running = false; }
    };
    tick();
    const id = setInterval(tick, 3000);
    // The page just woke up (screen unlocked, app switched back, network back): pay what fell due at once, not at the next timer.
    const wake = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake); };
  }, [payKey, !!ecash, !!payTerms, run]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pay now, outside the timer (after adding funds): resolves to the result.
  const payNow = useCallback(async (request) => run(request || payRide), [run, payRide]);
  // The rider says: yes, pay more than the cap (one more cap's worth), then pay what was held back.
  const allowMore = useCallback(async (request) => { allowMoreSpend(request || payRide); return run(request || payRide); }, [run, payRide]);

  // Money the driver sent back (a waived fare) goes into the wallet by itself, for any ride.
  useEffect(() => {
    if (!ecash) return;
    redeemWaiversFor({ user, ecash, rideRequests }).then((list) => {
      list.forEach((r) => pushNotice(`${moneyText(r.sats, btcPrice)} came back to your wallet.`));
    }).catch(() => {});
  }, [ecash, rideRequests.length, liveTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──

  // Publish a ride request. Only an approximate area is public; the exact
  // trip is sealed to the rider (and to the driver after they are chosen).
  const requestRide = useCallback(
    ({ pickup, dropoff, when, notes, miles, minutes, fareSats, suggestedSats, to = null, ratesSeen = null }) => {
      // `to` (a list of drivers): the rider chose them (browse list, map, "Notify nearest driver immediately"). The request goes to them only.
      const directed = Array.isArray(to) && to.length > 0;
      const d = "ride-" + Date.now();
      // The rates the rider saw for each chosen driver: if the driver's offer carries other rates, the rider is told before accepting (lib/ratechange.js).
      if (ratesSeen) Object.entries(ratesSeen).forEach(([pk, rates]) => rememberRates(d, pk, rates));
      publish(
        EVENT_KINDS.RIDE_REQUEST,
        {
          ...(directed && { directed: true }),
          pickup: publicPlace(pickup),
          dropoff: publicPlace(dropoff),
          time: when,
          notes,
          status: "requested",
          hide: hideList(user.sk, blocked), // drivers I blocked never see this request (lib/blocks.js)
          fareMode: "standard", // every driver's own rates (older apps also knew a "flat" price; it is gone)
          fareSats, // only an estimate: the fare is each driver's rates, paid tick by tick
          suggestedSats, // what the app suggested
          distanceMiles: Math.round(miles * 10) / 10,
          durationMin: minutes,
          sealed: seal(user.sk, me, { pickup, dropoff }),
        },
        [["d", d], ["t", "ride-request"]],
        directed ? { audience: to } : undefined
      );
      refreshData();
      resetPlan();
      // A reservation doesn't take over the home screen, so say where it went.
      if (when !== "ASAP" && Date.parse(when) - Date.now() > 30 * 60000) {
        pushNotice(`Ride reserved for ${new Date(when).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}. Drivers can accept it from now on.`);
        setView("activity");
      }
      return d;
    },
    [publish, refreshData, resetPlan, user.sk, me, pushNotice, setView, blocked]
  );

  // Keep a signed record of a payment (the proof is sealed to the driver, so only
  // the two of them can read it). phase: "tip" (older rides also have "deposit" | "rest").
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
        // A tip can be sent more than once, so each gets its own d-tag.
        [["e", request.id], ["p", driverPubkey], ["d", `pay-${rideKey(request)}-${phase}${phase === "tip" ? "-" + Date.now() : ""}`], ["t", "ride-payment"]]
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

  // The rider picked a driver: accept the offer (its rates and mint are now frozen for the ride) and hand the
  // driver the exact trip. There is no deposit: the rider pays tick by tick once the ride starts.
  const confirmDriver = useCallback(
    (request, offerEvent) => {
      const driver = offerEvent.pubkey;
      const trip = exactTrip(request, user);
      publish(
        EVENT_KINDS.RIDE_ACCEPT,
        {
          offerId: offerEvent.id,
          requestId: request.id,
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
      refreshData();
    },
    [publish, refreshData, user]
  );

  // Ask the driver (on the way to the pickup) to go to a different place. The new place is sealed to
  // the driver and to the rider; it only takes effect when the driver accepts.
  const proposePickup = useCallback(
    (request, place) => {
      const latest = rideVersions(request)[0] || request;
      const driver = rideDriver(latest);
      if (!driver || !place) return false;
      const changeId = String(Date.now());
      const pickup = { name: place.name, lat: place.lat, lng: place.lng };
      publish(
        EVENT_KINDS.RIDE_PICKUP_CHANGE,
        { changeId, sealedDriver: seal(user.sk, driver, { pickup }), sealedSelf: seal(user.sk, me, { pickup }) },
        [["e", latest.id], ["p", driver], ["d", `pickup-${rideKey(latest)}-${changeId}`], ["t", "ride-pickup"]]
      );
      refreshData();
      pushNotice(`Sent to your driver, who can accept or decline. ${PICKUP_CHANGE_NOTE}`);
      return true;
    },
    [publish, refreshData, user.sk, me, pushNotice]
  );

  // Ask the driver to add a stop or change the destination during the ride. The place is sealed to the driver
  // and to the rider; it only counts when the driver accepts.
  const proposeStop = useCallback(
    (request, { mode, place }) => {
      const latest = rideVersions(request)[0] || request;
      const driver = rideDriver(latest);
      if (!driver || !place) return false;
      const ev = stopRequestEvent(latest, user, driver, { mode, place });
      publish(ev.kind, ev.content, ev.tags);
      refreshData();
      pushNotice("Sent to your driver, who can accept it or finish the ride.");
      return true;
    },
    [publish, refreshData, user, pushNotice]
  );

  // Finish the ride (there are no cancellations, and no fees for finishing). Before a driver is chosen the request
  // is simply closed. Once the ride has started the rider owes what it has earned so far (base, miles, minutes),
  // and the driver's copy of the meter and the clock are in the signed event. `miles` = the trip distance both screens show.
  const finishRide = useCallback(
    (request, { miles, reason = "rider", at } = {}) => {
      const latest = rideVersions(request)[0] || request;
      const driver = rideDriver(latest);
      const times = rideTimes(latest);
      const when = at ?? Date.now();
      const sent = [publish(
        EVENT_KINDS.RIDE_FINISH,
        {
          requestId: latest.id, reason, role: "rider", at: when,
          ...(times.startedAt ? { miles: Math.round((miles ?? 0) * 100) / 100, minutes: Math.round((Math.max(0, when - times.startedAt) / 60000) * 100) / 100 } : {}),
        },
        [["e", latest.id], ...(driver ? [["p", driver]] : []), ["d", "finish-" + latest.id], ["t", "ride-finish"]]
      )];
      // An open request is also re-published as closed so other clients drop it.
      if (!driver) sent.push(publish(EVENT_KINDS.RIDE_REQUEST, { ...parse(latest), status: "closed" }, latest.tags));
      refreshData();
      return Promise.all(sent);
    },
    [publish, refreshData]
  );

  // "Not this driver": turn down ONE driver's offer. The request stays open, so other drivers can still accept it,
  // and that driver's app is told (it stops waiting and does not show this request again).
  const declineOffer = useCallback(
    (request, offer) => {
      const ev = declineEvent(request, offer);
      publish(ev.kind, ev.content, ev.tags);
      refreshData();
    },
    [publish, refreshData]
  );

  // "Request this driver": send an open request to one more driver, chosen from the list or the map. The driver can accept or decline.
  const notifyDriver = useCallback((request, driverPubkey, rates = null) => {
    const d = (request.tags.find((t) => t[0] === "d") || [])[1];
    if (!d || !/^[0-9a-f]{64}$/.test(driverPubkey) || driverPubkey === me) return false;
    rememberRates(d, driverPubkey, rates); // what the rider saw next to this driver's name
    addAudience(d, [driverPubkey]);
    relay.sealTo(rideVersions(request)[0] || request, [driverPubkey]);
    return true;
  }, [me]);

  // Logging out closes the requests still waiting for a driver (reservations too): the app will not be here to
  // choose a driver or pay, so nobody should be left waiting for it. A ride that is already under way is not touched.
  const reqsRef = useRef(rideRequests);
  reqsRef.current = rideRequests;
  useEffect(
    () =>
      onLogout(() => {
        const seen = new Set();
        const waiting = reqsRef.current.filter((r) => r.pubkey === me && rideStatus(r) === "requested" && isOpenRide(r) && !seen.has(rideKey(r)) && seen.add(rideKey(r)));
        return Promise.all(waiting.map((r) => finishRide(r)));
      }),
    [onLogout, me, finishRide]
  );

  // Blocking a driver while a request is open: publish the request again with the new hide list, so that driver's app stops showing it.
  const hideNow = hideList(user.sk, blocked).join(",");
  useEffect(() => {
    const want = hideList(user.sk, blocked);
    const seen = new Set();
    reqsRef.current
      .filter((r) => r.pubkey === me && rideStatus(r) === "requested" && isOpenRide(r) && !seen.has(rideKey(r)) && seen.add(rideKey(r)))
      .forEach((r) => {
        const latest = rideVersions(r)[0] || r;
        const c = parse(latest);
        if (c && (c.hide || []).join(",") !== want.join(",")) publish(EVENT_KINDS.RIDE_REQUEST, { ...c, hide: want }, latest.tags);
      });
  }, [hideNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // A request nobody took before it expired is gone for everyone (rides.js rideExpiryMs). Say so once.
  useEffect(() => {
    const check = () => {
      const noted = getSetting("expiredNoted", []);
      const gone = reqsRef.current.filter((r) => {
        if (r.pubkey !== me || rideStatus(r) !== "requested" || noted.includes(rideKey(r))) return false;
        const c = parse(r);
        return c && isRideExpired(c, r.created_at) && Date.now() - rideExpiryMs(c, r.created_at) < 24 * HOUR;
      });
      if (!gone.length) return;
      setSetting("expiredNoted", [...noted, ...gone.map(rideKey)].slice(-100));
      gone.forEach((r) => {
        const c = parse(r);
        pushNotice(`Your ride request${c.time && c.time !== "ASAP" ? ` for ${new Date(c.time).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""} ran out of time: no driver was chosen. It is closed.`);
      });
    };
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [me, pushNotice, liveTick]);

  // Places the rider has been to, newest first, for quick picks. `field` is "dropoff" (default) or "pickup"; at most `limit` places.
  const recentPlaces = (field = "dropoff", limit = 4) => {
    const seen = new Set();
    const out = [];
    rideRequests
      .filter((r) => r.pubkey === me)
      .sort((a, b) => b.created_at - a.created_at)
      .forEach((r) => {
        const d = exactTrip(r, user)?.[field];
        // The public copy of the place names only the area; keep it so a
        // repeat trip publishes the same coarse label.
        if (d && !seen.has(d.name) && out.length < limit) { seen.add(d.name); out.push({ ...d, area: parse(r)?.[field]?.name || "" }); }
      });
    return out;
  };

  const value = {
    myPosition, geoError, gps, here, drivers,
    plan, setPlan, resetPlan,
    share, startShare, stopShare, shareUpdate, shareUrl,
    activeRide, focused: !!focused, focusRide: (r) => setFocusId(r ? r.id : null), upcoming, receipt, dismissReceipt,
    genderPref, setGenderPref, notifyNearest, setNotifyNearest,
    notifyDriver, nearestOf: (to) => nearestDriver(drivers, to)?.pubkey || null,
    requestRide, proposePickup, confirmDriver, recordPayment, confirmRide, proposeStop, finishRide, declineOffer, recentPlaces,
    money, payNow, allowMore, reportMiles, payTerms, payMint, screenMayDim,
    nearestDriverEta: (to) => {
      if (!to || !drivers.length) return null;
      const miles = Math.min(...drivers.map((d) => haversineDistance(to.lat, to.lng, d.lat, d.lng)));
      return pickupEta(miles);
    },
  };
  return <RiderContext.Provider value={value}>{children}</RiderContext.Provider>;
}
