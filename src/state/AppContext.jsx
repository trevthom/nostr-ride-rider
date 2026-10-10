// ════════════════════════════════════════════════════════════
//  APP STATE — The state BOTH apps share: the logged-in user, which
//  tab is showing, the ride requests from the relays, transient
//  banners, the BTC price, and the connected Lightning wallet.
//
//  Role-specific state lives next to each app:
//    src/rider/state/RiderContext.jsx    (requesting + riding)
//    src/driver/state/DriverContext.jsx  (online, presence, offers)
//
//  Any screen can read this with the useApp() hook, e.g.:
//      const { user, setView, publish } = useApp();
// ════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { relay } from "../nostr/relay.js";
import { EVENT_KINDS, APP_TAG } from "../nostr/eventKinds.js";
import { buildSignedEvent } from "../nostr/events.js";
import { latestVersions } from "../nostr/replaceable.js";
import { emptyWalletState } from "../nostr/wallet.js";
import { getProfile } from "../nostr/profiles.js";
import { myVehicle } from "../lib/privacy.js";
import { forgetKey } from "../nostr/keystore.js";
import { APP_NAME } from "../config/app.js";
import { getSetting, setSetting, reconnectAll } from "../config/relays.js";
import { addBlock, removeBlock, isBlocked } from "../lib/blocks.js";
import { showSystemNotification } from "../lib/notify.js";

const AppContext = createContext(null);

// Kinds whose arrival should refresh on-screen data. METADATA is here so
// names/photos appear as soon as relay.fetchProfile() pulls them in.
const APP_EVENT_KINDS = new Set([
  EVENT_KINDS.METADATA,
  EVENT_KINDS.RIDE_REQUEST,
  EVENT_KINDS.RIDE_OFFER,
  EVENT_KINDS.RIDE_ACCEPT,
  EVENT_KINDS.RIDE_CANCEL,
  EVENT_KINDS.RIDE_COMPLETE,
  EVENT_KINDS.RIDE_STAGE,
  EVENT_KINDS.RIDE_PAYMENT,
  EVENT_KINDS.RIDE_CONFIRM,
  EVENT_KINDS.RATING,
]);

// The hook every screen uses to reach shared state.
export function useApp() {
  return useContext(AppContext);
}

export function AppProvider({ initialView, children }) {
  const [user, setUser] = useState(null); // logged-in keypair + profile
  const [view, setView] = useState(initialView); // which tab is visible
  const [rideRequests, setRideRequests] = useState([]); // latest version of each
  const [profileModalPubkey, setProfileModalPubkey] = useState(null); // user-info modal
  const [notices, setNotices] = useState([]); // transient swipe-away banners
  const [liveTick, setLiveTick] = useState(0); // bumped on incoming relay events to re-render
  const [wallet, setWallet] = useState(emptyWalletState()); // connected NWC wallet

  // Show a transient banner. Also fires a system notification when the app
  // isn't the focused tab, so users hear about it off-screen.
  const pushNotice = useCallback((message) => {
    const id = Math.random().toString(36).slice(2);
    // Two drivers answering at once should not stack two identical banners.
    setNotices((list) => (list.some((n) => n.message === message) ? list : [...list, { id, message }]));
    try {
      if (typeof document !== "undefined" && document.hidden &&
          typeof Notification !== "undefined" && Notification.permission === "granted") {
        showSystemNotification(APP_NAME, message);
      }
    } catch { /* ignore */ }
    return id;
  }, []);
  const dismissNotice = useCallback((id) => setNotices((list) => list.filter((n) => n.id !== id)), []);

  // People this user has blocked (kept on this device).
  const [blocked, setBlocked] = useState(() => getSetting("blocked", []));
  const blockUser = useCallback((pubkey, name) => setBlocked((l) => { const n = addBlock(l, pubkey, name); setSetting("blocked", n); return n; }), []);
  const unblockUser = useCallback((pubkey) => setBlocked((l) => { const n = removeBlock(l, pubkey); setSetting("blocked", n); return n; }), []);
  const isBlockedPk = useCallback((pubkey) => isBlocked(blocked, pubkey), [blocked]);

  // BTC price (USD) so sats amounts can show a fiat estimate. Refreshed
  // periodically; null until first fetch (then USD is just hidden).
  const [btcUsd, setBtcUsd] = useState(null);
  useEffect(() => {
    let alive = true;
    const fetchPrice = async () => {
      try {
        const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
        const data = await res.json();
        if (alive && data?.bitcoin?.usd) setBtcUsd(data.bitcoin.usd);
      } catch {
        /* leave null; USD just won't show */
      }
    };
    fetchPrice();
    const id = setInterval(fetchPrice, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Connect to the real relays once when the app starts.
  useEffect(() => {
    relay.startSync();
  }, []);

  // Re-read the latest ride requests from the cache (newest per request),
  // skipping anything malformed or not shaped like a ride.
  const refreshData = useCallback(() => {
    const reqs = latestVersions(relay.query({ kinds: [EVENT_KINDS.RIDE_REQUEST] })).filter((r) => {
      try {
        const c = JSON.parse(r.content);
        return c && c.pickup && c.dropoff;
      } catch {
        return false;
      }
    });
    setRideRequests(reqs);
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Pull recent events from the relays, then refresh the list. Screens call
  // this on open and on a poll, so it also catches what the live
  // subscription missed.
  const pullRecent = useCallback(async () => {
    await relay.fetchRecent();
    refreshData();
  }, [refreshData]);

  // On startup, also do a one-shot pull so existing requests appear.
  useEffect(() => {
    pullRecent();
  }, [pullRecent]);

  // Publish a REAL signed event authored by the logged-in user, to the
  // local cache + the real relays. This is how every user action is sent.
  // Resolves to true once any relay accepts it (false if none do).
  // `localOnly` keeps it in the cache (replies to demo data must not
  // reach public relays) and resolves to false.
  const publish = useCallback(
    (kind, content, tags, { localOnly = false } = {}) => {
      if (!user?.sk) return Promise.resolve(false);
      // Tag every event so other devices can tell our events apart from
      // unrelated apps that reuse the same kind numbers on public relays.
      // (Re-published requests copy their old tags, so drop the old one.)
      const tagged = [...tags.filter((t) => !(t[0] === "t" && t[1] === APP_TAG)), ["t", APP_TAG]];
      const event = buildSignedEvent(kind, content, tagged, user.sk);
      if (localOnly) {
        relay.publishLocal(event);
        return Promise.resolve(false);
      }
      return relay.publish(event);
    },
    [user]
  );

  // New relay events refresh the UI. A relay fetch can deliver hundreds of
  // events at once, so refreshes are coalesced: at most one refreshData +
  // one re-render per 100 ms.
  useEffect(() => {
    let timer = null;
    let requestsChanged = false;
    const unsub = relay.onEvent((_subId, event) => {
      if (!APP_EVENT_KINDS.has(event.kind)) return;
      requestsChanged = requestsChanged || event.kind === EVENT_KINDS.RIDE_REQUEST;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (requestsChanged) refreshData();
        requestsChanged = false;
        setLiveTick((t) => t + 1);
      }, 100);
    });
    return () => { unsub(); clearTimeout(timer); };
  }, [refreshData]);

  // The network came back, or the tab woke up: re-open every relay subscription,
  // send what is waiting in the outbox, and catch up on what we missed.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      reconnectAll();
      relay.flushOutbox();
      pullRecent();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => { window.removeEventListener("online", wake); document.removeEventListener("visibilitychange", wake); };
  }, [pullRecent]);

  // Best-effort: ask for system-notification permission once logged in.
  useEffect(() => {
    if (!user) return;
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch { /* ignore */ }
  }, [user?.publicKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Log out: clear the session and return to the login screen. The wallet
  // must go too, or the next person on this device could spend from it,
  // and so does the saved (encrypted) key.
  const logout = useCallback(() => {
    forgetKey();
    setUser(null);
    setProfileModalPubkey(null);
    setWallet(emptyWalletState());
    setNotices([]);
    setView(initialView);
  }, [initialView]);

  // On login, pull our full ride history (the live sync covers only 24 h)
  // so Past Rides and our reputation are complete.
  useEffect(() => {
    if (user?.publicKey) relay.fetchHistory(user.publicKey);
  }, [user?.publicKey]);

  // On login, pull our own profile from relays and restore the photo +
  // vehicle info (so a returning driver keeps their setup across sessions).
  useEffect(() => {
    if (!user?.publicKey) return;
    let alive = true;
    (async () => {
      await relay.fetchProfile(user.publicKey);
      const p = getProfile(user.publicKey);
      if (alive && p && (p.picture || p.vehicle || p.lud16)) {
        setUser((u) => u && ({
          ...u,
          picture: u.picture || p.picture || "",
          lud16: u.lud16 || p.lud16 || "",
          vehicle: u.vehicle || myVehicle(u.publicKey, u.sk),
        }));
      }
    })();
    return () => { alive = false; };
  }, [user?.publicKey]);

  // User-info modal (opened by tapping any username).
  const openProfile = useCallback((pubkey) => setProfileModalPubkey(pubkey), []);
  const closeProfile = useCallback(() => setProfileModalPubkey(null), []);

  const value = {
    user,
    setUser,
    logout,
    openProfile,
    closeProfile,
    profileModalPubkey,
    notices,
    pushNotice,
    dismissNotice,
    view,
    setView,
    rideRequests,
    refreshData,
    pullRecent,
    publish,
    wallet,
    setWallet,
    blocked,
    blockUser,
    unblockUser,
    isBlockedPk,
    liveTick,
    btcUsd,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
