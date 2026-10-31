// ════════════════════════════════════════════════════════════
//  APP STATE — The state BOTH apps share: the logged-in user, which
//  tab is showing, the ride requests from the relays, transient
//  banners, the local currency and the BTC prices, and the ecash wallet.
//
//  Role-specific state lives next to each app:
//    src/rider/state/RiderContext.jsx    (requesting + riding)
//    src/driver/state/DriverContext.jsx  (online, presence, offers)
//
//  Any screen can read this with the useApp() hook, e.g.:
//      const { user, setView, publish } = useApp();
// ════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback, useRef, Fragment } from "react";
import { relay } from "../nostr/relay.js";
import { EVENT_KINDS, APP_TAG } from "../nostr/eventKinds.js";
import { buildSignedEvent } from "../nostr/events.js";
import { latestVersions } from "../nostr/replaceable.js";
import { syncVouches } from "../nostr/vouchSync.js";
import MilesSync from "../features/profile/MilesSync.jsx";
import AudienceSync from "./AudienceSync.jsx";
import { audienceFor } from "../lib/audience.js";
import { onlyPreferred } from "../lib/gender.js";
import { trustFor } from "../lib/vouches.js";
import { getPeople, getAudience, addAudience, answerersOf } from "../lib/audienceStore.js";
import { useBackup } from "./useBackup.js";
import { applyAppearance } from "../lib/appearance.js";
import { setUnits, getUnits } from "../lib/units.js";
import { getProfile } from "../nostr/profiles.js";
import { myVehicle } from "../lib/privacy.js";
import { forgetKey } from "../nostr/keystore.js";
import { loadSession, saveSession, clearSession, saveView, loadView } from "../lib/session.js";
import { APP_NAME } from "../config/app.js";
import { getSetting, setSetting, reconnectAll } from "../config/relays.js";
import { addBlock, removeBlock, isBlocked, setBlockNote as saveBlockNote } from "../lib/blocks.js";
import { showSystemNotification } from "../lib/notify.js";
import { PRICE_CODES, PRICE_MAX_AGE_MS, acceptPrices, getCurrency, setCurrency as saveCurrency, onCurrencyChange } from "../lib/currency.js";
import { FALLBACK_BTC_USD } from "../config/settings.js";
import { link } from "../nostr/link.js";
import { holdWalletLock } from "../nostr/walletlock.js";

const AppContext = createContext(null);

// Kinds whose arrival should refresh on-screen data. METADATA is here so
// names/photos appear as soon as relay.fetchProfile() pulls them in.
const APP_EVENT_KINDS = new Set([
  EVENT_KINDS.METADATA,
  EVENT_KINDS.RIDE_REQUEST,
  EVENT_KINDS.RIDE_OFFER,
  EVENT_KINDS.RIDE_ACCEPT,
  EVENT_KINDS.RIDE_FINISH,
  EVENT_KINDS.RIDE_COMPLETE,
  EVENT_KINDS.RIDE_STAGE,
  EVENT_KINDS.RIDE_PAYMENT,
  EVENT_KINDS.RIDE_CONFIRM,
  EVENT_KINDS.RIDE_PICKUP_CHANGE,
  EVENT_KINDS.RIDE_PICKUP_REPLY,
  EVENT_KINDS.RIDE_TICK,
  EVENT_KINDS.RIDE_TICK_REPLY,
  EVENT_KINDS.RIDE_WAIVER,
  EVENT_KINDS.RIDE_ALIVE,
  EVENT_KINDS.RIDE_STOP_CHANGE,
  EVENT_KINDS.RIDE_STOP_REPLY,
  EVENT_KINDS.VOUCH_LIST,
]);

// The hook every screen uses to reach shared state.
export function useApp() {
  return useContext(AppContext);
}

export function AppProvider({ initialView, children }) {
  const [user, setUser] = useState(() => loadSession()); // logged-in keypair + profile (this tab's session survives a reload)
  const [view, setView] = useState(() => loadView(initialView)); // which tab is visible
  const [rideRequests, setRideRequests] = useState([]); // latest version of each
  const [profileModalPubkey, setProfileModalPubkey] = useState(null); // user-info modal
  const [notices, setNotices] = useState([]); // transient swipe-away banners
  const [liveTick, setLiveTick] = useState(0); // bumped on incoming relay events to re-render
  const [settingsEpoch, setSettingsEpoch] = useState(0); // bumped when a backup is put back: the screens are drawn again with the restored settings

  // This tab's session survives a reload (lib/session.js), so refreshing does not log the person out: they stay on the
  // same tab (and Account screen). It is gone when the tab closes; logging out clears it.
  useEffect(() => { if (user) saveSession(user); }, [user]);
  useEffect(() => { saveView(view); }, [view]);

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
  const setBlockNote = useCallback((pubkey, note) => setBlocked((l) => { const n = saveBlockNote(l, pubkey, note); setSetting("blocked", n); return n; }), []);
  const isBlockedPk = useCallback((pubkey) => isBlocked(blocked, pubkey), [blocked]);

  // The encrypted backup of vouches, blocks and settings (lib/backup.js): checked at login, kept up to date, restored on a new phone.
  useBackup({
    user,
    publish: (...a) => publishRef.current(...a),
    onRestored: () => {
      setBlocked(getSetting("blocked", []));
      saveCurrency(getSetting("currency", getCurrency()));
      setUnits(getUnits());
      applyAppearance();
      setSettingsEpoch((n) => n + 1);
    },
  });

  // The local currency (chosen in Account) and the BTC price in every supported currency (code → price).
  // Charges are stated in the local currency and turned into sats at the price of the moment. The last good
  // prices are kept on this device, so a price feed outage does not stop a ride.
  const [currency, setCurrencyState] = useState(getCurrency());
  useEffect(() => onCurrencyChange(setCurrencyState), []);
  const setCurrency = useCallback((code) => saveCurrency(code), []);
  const [priceInfo, setPriceInfo] = useState(() => {
    const saved = getSetting("prices", null);
    return saved && saved.prices && Date.now() - saved.at < PRICE_MAX_AGE_MS ? { prices: saved.prices, at: saved.at, live: false } : { prices: {}, at: 0, live: false };
  });
  const lastPrices = useRef(priceInfo.prices);
  const suspectPrices = useRef({});
  useEffect(() => {
    let alive = true;
    const fetchPrice = async () => {
      try {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${PRICE_CODES.map((c) => c.toLowerCase()).join(",")}`);
        const data = await res.json();
        const row = data?.bitcoin || {};
        const fetched = {};
        PRICE_CODES.forEach((c) => { const v = row[c.toLowerCase()]; if (typeof v === "number" && v > 0) fetched[c] = v; });
        if (alive && Object.keys(fetched).length) {
          // A price far from the last good one waits for confirmation (lib/currency.js acceptPrices): the apps pay by themselves.
          const r = acceptPrices(lastPrices.current, fetched, suspectPrices.current);
          suspectPrices.current = r.suspects;
          lastPrices.current = r.prices;
          const next = { prices: r.prices, at: Date.now(), live: true };
          setPriceInfo(next);
          setSetting("prices", { prices: r.prices, at: next.at });
        }
      } catch {
        /* keep the last prices; a fiat amount just may not show */
      }
    };
    fetchPrice();
    const id = setInterval(fetchPrice, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const prices = priceInfo.prices;
  // The BTC price in the chosen currency (null until known). Dollars fall back to a fixed price so fares can still be quoted.
  const btcPrice = prices[currency] ?? null;
  const usdPrice = prices.USD ?? null;
  const priceFor = useCallback((code) => prices[code] ?? (code === "USD" ? FALLBACK_BTC_USD : null), [prices]);

  // Connect to the real relays once when the app starts.
  useEffect(() => {
    relay.startSync();
    link.start();
  }, []);

  // Who may open the gift wraps addressed to this device (nostr/sealing.js): the logged-in user.
  useEffect(() => {
    relay.setIdentity(user?.sk || null, user?.publicKey || null);
    return () => relay.setIdentity(null, null);
  }, [user?.sk, user?.publicKey]);

  // The ecash wallet of the logged-in user. Its code is loaded on demand (a separate chunk), proofs are
  // opened with the user's key, and anything paid but not yet claimed is claimed. `ecashTick` re-renders screens.
  const [ecash, setEcash] = useState(null);
  const [, setEcashTick] = useState(0);
  // "No wallet on this device" (`ecashOff`): nothing makes a wallet by itself. The person chooses Create New Wallet (new 12 words) or
  // Restore (their own 12 words) in Account → Wallets, and until then no wallet is loaded. A device that already holds a wallet (its saved
  // words or coins) is "on" without a choice. The flag `ecashOff_<pk16>` is true after Disconnect and false after Create / Restore.
  const [offTick, setOffTick] = useState(0);
  const offKey = user?.publicKey ? "ecashOff_" + user.publicKey.slice(0, 16) : null;
  const pk16 = user?.publicKey ? user.publicKey.slice(0, 16) : "";
  const flag = offKey ? getSetting(offKey, undefined) : undefined;
  const hasWalletData = !!pk16 && (typeof getSetting("ecashphrase_" + pk16, null) === "string" || Array.isArray(getSetting("ecash_" + pk16, null)));
  const ecashOff = offKey ? flag === true || (flag !== false && !hasWalletData) : false;
  void offTick;
  const [ecashWaiting, setEcashWaiting] = useState(false); // the wallet is open in another window of this browser
  useEffect(() => {
    if (!user?.sk || ecashOff) { setEcash(null); setEcashWaiting(false); return undefined; }
    let alive = true, off = null, timer = null, saveTimer = null, warned = false;
    // One window at a time holds the wallet (nostr/walletlock.js): two windows would overwrite each other's coins.
    const hold = holdWalletLock("nostrride-wallet-" + user.publicKey.slice(0, 16), { onWait: () => { if (alive) setEcashWaiting(true); } });
    hold.ready.then(() => import("../nostr/cashuMint.js")).then((m) => {
      if (!alive) return;
      setEcashWaiting(false);
      const w = m.userWallet(user);
      off = w.onChange(() => {
        setEcashTick((t) => t + 1);
        // The browser would not keep the wallet (a full or blocked storage): say so, once, while it lasts.
        if (!w.saveOk && !warned) {
          warned = true;
          pushNotice(w.saveCritical
            ? "Money moved at the mint but this browser will not save your wallet. Keep this page open: saving is tried again every couple of seconds."
            : "This browser will not save your wallet right now (the storage is full or blocked). Free some space. Until then no money moves.");
        }
        if (w.saveOk) warned = false;
      });
      setEcash(w);
      w.claimAll().catch(() => {});
      w.recoverPending().catch(() => {});
      // Coins the mint calls spent (moved elsewhere by a restore on another device) are set aside, then checked again before they are
      // forgotten: the person is told what happened, never silently short of money (EcashWallet.syncSpent).
      const saySpent = (r) => {
        if (!r) return;
        if (r.quarantined) pushNotice(`${r.quarantined} sats were reported spent by the mint. They are set aside while this device checks again.`);
        if (r.dropped) pushNotice(`${r.dropped} sats were spent on another device and were removed from this wallet.`);
        if (r.restored) pushNotice(`${r.restored} sats the mint had reported spent are back in your wallet.`);
      };
      w.syncSpent().then(saySpent).catch(() => {});
      timer = setInterval(() => w.syncSpent().then(saySpent).catch(() => {}), 5 * 60000);
      // A Lightning payment the mint was still working on is settled when the mint is done; a wallet the browser would not save is
      // saved again soon (a mint answer that is only in memory would be lost on a reload).
      saveTimer = setInterval(() => { w.retrySave(); w.recoverPending().catch(() => {}); }, 5000);
    }).catch(() => {});
    return () => { alive = false; hold.release(); if (off) off(); if (timer) clearInterval(timer); if (saveTimer) clearInterval(saveTimer); };
  }, [user?.publicKey, ecashOff]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remove the ecash wallet from this device (erase the coins and the phrase here; nothing is swapped).
  const disconnectEcash = useCallback(async () => {
    if (!ecash || !offKey) return;
    await ecash.recovery.disconnect();
    const m = await import("../nostr/cashuMint.js");
    m.forgetWallet(user);
    setSetting(offKey, true);
    setEcash(null);
    setOffTick((t) => t + 1);
  }, [ecash, user, offKey]);
  // Create New Wallet: the wallet loads and makes its own 12 words (the screen shows them at once).
  const createEcash = useCallback(() => {
    if (!offKey) return;
    setSetting(offKey, false);
    setOffTick((t) => t + 1);
  }, [offKey]);
  // Restore: the 12 words the person typed BECOME this wallet's words (nothing is swept into another phrase). Kept only if the mints
  // had ecash for them; otherwise nothing is left on the device. Returns { rows, kept }.
  const restoreEcash = useCallback(async (text, urls) => {
    if (!offKey) return { rows: [], kept: false };
    setSetting(offKey, true); // while the words are being tried, the wallet stays "not on this device" (a saved phrase alone must not switch it on)
    const m = await import("../nostr/cashuMint.js");
    const out = await m.restoreWallet(user, text, urls);
    if (out.kept) { setSetting(offKey, false); setOffTick((t) => t + 1); }
    return out;
  }, [user, offKey]);

  // Vouches (lib/vouches.js): bring in my list and the lists of the people I vouch for, so the badge on a card can say
  // "N of your vouches know and trust this person". At login, every 5 minutes, and after I change my own list.
  const refreshVouches = useCallback(async () => {
    if (!user?.publicKey) return;
    try { await syncVouches(user.publicKey); } catch { /* the relays are down: try again later */ }
    setLiveTick((t) => t + 1);
  }, [user?.publicKey]);
  useEffect(() => {
    if (!user?.publicKey) return undefined;
    refreshVouches();
    const id = setInterval(refreshVouches, 5 * 60000);
    return () => clearInterval(id);
  }, [refreshVouches, user?.publicKey]);

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
    (kind, content, tags, { localOnly = false, durable = false, audience = null } = {}) => {
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
      // Job events go out sealed (nostr/sealing.js). A request is also sent to the drivers who may take it,
      // and later versions of it (accepted, closed) go to everyone who already holds it or answered it.
      const to = [];
      if (kind === EVENT_KINDS.RIDE_REQUEST) {
        const d = (tagged.find((t) => t[0] === "d") || [])[1];
        let c = null;
        try { c = typeof content === "string" ? JSON.parse(content) : content; } catch { /* no audience */ }
        // `audience` (a list of drivers) = the rider chose these drivers: the request goes to them and nobody else (lib/trips.js isDirected).
        // Otherwise it goes to the online drivers near the pickup; a rider who asked for "Female only" / "Male only" sends it only to those.
        const asked = Array.isArray(audience)
          ? audience.filter((pk) => /^[0-9a-f]{64}$/.test(pk) && pk !== user.publicKey)
          : c && c.status === "requested" && !c.directed
            ? audienceFor(c, onlyPreferred(getPeople(), getSetting("genderPref", "")), { me: user.publicKey, blocked, trusted: (pk) => !!trustFor(pk, user.publicKey) })
            : [];
        to.push(...asked, ...getAudience(d), ...answerersOf(d, user.publicKey));
        addAudience(d, asked);
      }
      return relay.publish(event, { to, durable }); // durable: a job event that carries money (the promise has .stored, see relay.publish)
    },
    [user, blocked]
  );

  const publishRef = useRef(null);
  publishRef.current = publish;

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

  // The network came back, or the tab woke up: reconnect, send what is waiting in the
  // outbox, and catch up on what we missed. After the network changed or a long sleep the old
  // sockets may be dead without saying so, so they are closed and opened fresh (not just re-used).
  useEffect(() => {
    let hiddenAt = 0;
    const wake = (force) => {
      if (document.visibilityState === "hidden") { hiddenAt = hiddenAt || Date.now(); return; }
      const slept = hiddenAt && Date.now() - hiddenAt > 30000;
      hiddenAt = 0;
      if (force === true || slept) relay.refreshConnections();
      else reconnectAll();
      relay.flushOutbox();
      pullRecent();
    };
    const onOnline = () => wake(true);
    const onVisible = () => wake(false);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("online", onOnline); document.removeEventListener("visibilitychange", onVisible); };
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
  // A role can ask for a moment before the session ends (the rider app closes the requests still waiting for a
  // driver). Each hook may return a promise; logging out never waits longer than 3 seconds for them.
  const logoutHooks = useRef(new Set());
  const onLogout = useCallback((fn) => { logoutHooks.current.add(fn); return () => logoutHooks.current.delete(fn); }, []);
  const logout = useCallback(async () => {
    try {
      await Promise.race([
        Promise.allSettled([...logoutHooks.current].map((fn) => Promise.resolve().then(fn))),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch { /* log out anyway */ }
    clearSession();
    forgetKey();
    setUser(null);
    setProfileModalPubkey(null);
    setEcash(null);
    setNotices([]);
    setView(initialView);
  }, [initialView]);

  // On login, pull our full ride history (the live sync covers only 24 h)
  // so Past Rides and our trip counts are complete.
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
      if (alive && p && (p.picture || p.vehicle || p.lud16 || p.gender || p.rates || p.stats)) {
        setUser((u) => u && ({
          ...u,
          picture: u.picture || p.picture || "",
          lud16: u.lud16 || p.lud16 || "",
          vehicle: u.vehicle || myVehicle(u.publicKey, u.sk),
          gender: u.gender ?? p.gender ?? "",
          rates: u.rates ?? p.rates ?? null,
          stats: u.stats ?? p.stats ?? null,
        }));
      }
    })();
    return () => { alive = false; };
  }, [user?.publicKey]);

  // The profile (kind 0) is shared by the Rider and Driver apps. A cash out location saved in the other app arrives with the next look at
  // our own profile: every 5 minutes and when this app comes back to the front.
  useEffect(() => {
    if (!user?.publicKey) return undefined;
    const me = user.publicKey;
    const look = async () => {
      await relay.fetchProfile(me);
      const lud16 = getProfile(me)?.lud16 || "";
      setUser((u) => (u && u.publicKey === me && (u.lud16 || "") !== lud16 ? { ...u, lud16 } : u));
    };
    const onVisible = () => { if (!document.hidden) look(); };
    const id = setInterval(look, 5 * 60000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [user?.publicKey]);

  // User-info modal (opened by tapping any username).
  const openProfile = useCallback((pubkey) => setProfileModalPubkey(pubkey), []);
  const closeProfile = useCallback(() => setProfileModalPubkey(null), []);

  const value = {
    user,
    setUser,
    logout,
    onLogout,
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
    refreshVouches,
    ecash,
    ecashOff,
    ecashWaiting,
    disconnectEcash,
    createEcash,
    restoreEcash,
    currency,
    setCurrency,
    prices,
    priceFor,
    btcPrice,
    usdPrice,
    blocked,
    blockUser,
    unblockUser,
    setBlockNote,
    isBlockedPk,
    liveTick,
  };

  return <AppContext.Provider value={value}><Fragment key={settingsEpoch}><MilesSync /><AudienceSync />{children}</Fragment></AppContext.Provider>;
}
