# CLAUDE.md

Guidance for AI coding agents working in this repo. Read this first; it
should let you make correct edits without reading every file.

## What this is
NostrRide **Rider app** — one half of a decentralized ridesharing system. The rider and driver
apps are **separate repositories** that talk to each other only over **Nostr** (no server, no DB).
This repo is the **rider** app: Uber/Lyft-style: "Where to?", fare quote, find a driver, pay a deposit, watch the car arrive, ride, pay the rest, rate.
The sibling repo is **nostr-ride-driver**. Both speak the same events (table below).

> **Generated repository.** This is a copy of the rider app made from **trevthom/nostr-ride** by `scripts/export-apps.mjs`. Make changes in nostr-ride and export again: a hand edit here is overwritten by the next export.

Stack: **React 18 + Vite**. **Tailwind is loaded from a CDN** in `index.html`
(NOT a build dependency — do not add `@tailwindcss/vite` or `tailwindcss`
to package.json; its native binary breaks on some machines, which is why it was removed).
Full human-readable docs: `docs/index.md`.
Look: white UI, black buttons, bottom sheets over a full-screen map (Inter font).

## Commands
- `npm install` then `npm run dev` → http://localhost:5173. To play a whole ride, also run the sibling app
  (nostr-ride-driver, port 5174) and sign in with a different account in each.
- `npm run build` → `dist/` (static files; works from any folder: `base: "./"`). `npm run preview` serves it.
- `npm test` → Node's built-in test runner over `test/*.test.mjs` (no extra deps). Run it after touching `lib/*`, `nostr/*`.
- No linter configured.
- `vite.config.js` defines `__APP_ROLE__` (`"rider"`), read through `src/config/app.js`.
  Node tests have no such constant and get `"rider"`.

## Architecture (data flow)
Every user action becomes a **signed Nostr event** → published via
`useApp().publish(kind, content, tags)` (signs with the logged-in user's secret
key) → sent to **real relays** (config/relays.js) AND kept in a local cache in
`src/nostr/relay.js`. The cache lets screens read events **synchronously** with
`relay.query()`. Incoming relay events flow into the same cache and bump `liveTick`
so screens re-render.

**What is on screen is DERIVED from events, not kept in app memory** (`lib/trips.js`):
the rider's current ride is `activeRideFor(requests, me)`, the driver's is
`activeDriveFor`, their stage is `rideStage`. So a reload (or a second device) shows the
same screen. Only UI-only things (plan form, which card is open) live in React state.

Shared state: `src/state/AppContext.jsx` (`useApp()`): user, tab (`view`/`setView`),
`rideRequests`, `publish`, `pullRecent`, notices, `btcUsd`, wallet, `liveTick`.
Role state: `src/rider/state/RiderContext.jsx` (`useRider()`) and
`src/driver/state/DriverContext.jsx` (`useDriver()`) — mounted only after login, keyed by pubkey.
No router: each `App.jsx` maps `view` → screen; the tab bar hides during a trip.
Each screen is wrapped in an `ErrorBoundary`.

## Ride lifecycle (how the two apps connect)
| Step | Rider app | Event (kind) | Driver app |
|---|---|---|---|
| 0 | sees cars nearby | PRESENCE 30090 (public, coarse) | **GO** online (needs GPS + `isDriveReady`) |
| 1 | picks route, sees fare, taps **Request** | RIDE_REQUEST 30078 `status:requested`, `fareSats` | incoming card (45 s countdown) + price tags on map |
| 2 | "Finding your driver…" | | **Accept** (or Decline) |
| 3 | list of drivers (fastest first) | RIDE_OFFER 30079 (price = fare, deposit %, ETA, sealed plate; good 5 min) | "Waiting for rider…" |
| 4 | **Choose** → pays the deposit (Lightning) | RIDE_ACCEPT 30080 (exact trip sealed to driver) + RIDE_REQUEST `in_progress`+`driverPubkey` | drive starts: route to pickup |
| 5 | car moves live, "arriving in N min" | RIDE_LOCATION 21100 every 6 s (NIP-44 to rider) | **I've arrived** → RIDE_STAGE 30085 `arrived` |
| 6 | "Your driver has arrived" | | **Start trip** → RIDE_STAGE `riding` |
| 7 | "On the way to …" | | **Complete trip** → RIDE_COMPLETE 30084 |
| 8 | receipt, pays the rest, rates | RATING 30082 (either way) | summary, rates the rider |
Cancels: RIDE_CANCEL 30081 by the rider (any time) or the assigned driver. A driver with no
offer taken just sees the ride leave `requested` ("That ride is no longer available").
Reservations (`time` > 30 min away) wait under Activity → Upcoming (`isScheduledLater`).

## Directory map
```
index.html  track.html  main.jsx  track.jsx   # entry pages (Vite root is the repo root)
public/                           # manifest, icons, service worker (sw.js)
vite.config.js                    # defines __APP_ROLE__, base "./"
src/
  index.css  theme.js             # font, animations; few colors (THEME)
  config/
    app.js                        # APP_ROLE / IS_DRIVER_APP / APP_NAME
    settings.js                   # tunables: FARE_RATES, FALLBACK_BTC_USD, DEFAULT_DEPOSIT_PERCENT,
                                  #   REQUEST_CARD_SECONDS, OFFER_TTL_SECONDS, DEFAULT_REQUEST_RADIUS_MILES,
                                  #   USE_DEMO_DATA (dev only), CONTACT_PLATFORMS
    services.js                   # tile / Photon / OSRM URLs, overridable by VITE_* env (see env.example)
    relays.js                     # DEFAULT_RELAYS, getRelays/setRelays/useRelays, getSetting/setSetting (localStorage)
  nostr/
    eventKinds.js                 # EVENT_KINDS + APP_TAG
    keys.js  keystore.js          # real keys; optional NIP-49 "remember me" (key name differs per app)
    events.js                     # createNostrEvent (unsigned, demo) + buildSignedEvent (signed; replaceable kinds get strictly increasing created_at)
    relay.js                      # SimplePool + local cache: publish, publishLocal, query, onEvent, startSync, fetchRecent, fetchProfile, fetchHistory
    replaceable.js  profiles.js   # latestVersions(); getProfile/getMetadata
    live.js                       # presence (public, coarse) + ride location (NIP-44, ephemeral)
    share.js                      # "Share my trip": throwaway-key link, encrypted trip updates (kind 30091)
    wallet.js                     # NIP-47 (NWC) client
    demoData.js                   # dev-only fake riders/requests (driver app only)
  lib/
    rides.js      # trust rules: rideVersions/rideStatus/rideEnding/rideStage/rideDriver/rideKey/reputation
    trips.js      # derive current state: activeRideFor, activeDriveFor, offersForRide, offerFrom, pendingOfferFor, acceptFor, upcomingRidesFor, isScheduledLater
    fare.js       # quoteFare/fareUsd/usdToSats/depositSats/pickupEta (pure)
    earnings.js   # completedDrives, summarizeEarnings
    privacy.js    # publicPlace, seal/unseal, exactTrip, sealVehicle/myVehicle/offerPlate
    contact.js    # contactHref (safe links from untrusted handles)
    evidence.js   # payment records (30086) + proofLevel + driver-side verifyPayment + disputeRecord; rideConfirm is in rides.js
    bolt11.js     # paymentHash / preimageMatches
    blocks.js     # local block list helpers
    safety.js     # trusted contacts, sms link, trip message
    nativeGeo.js  # background location via Capacitor (run-time lookup; web build has no dependency)
    notify.js     # service worker registration + system notifications
    gps.js (gpsStatus/gpsMessage: good|weak|stale) useGeolocation.js (pos, error, status) useWakeLock.js
    geo.js geocode.js (search + reverseGeocode) routing.js (OSRM, cached) image.js lnurl.js locations.js profile.js (isDriveReady)
  state/AppContext.jsx            # shared state (above)
  ui/                             # shared UI kit
    Layout.jsx    # AppFrame, MapPage (+ measures the Sheet so the map pads for it), Sheet, FloatButton, Screen, TabBar
    MapView.jsx   # Leaflet + OpenStreetMap tiles; pins, OSRM route, cars, "me" dot, price pills, ref.fit()
    Button.jsx Icon.jsx Avatar.jsx Rating.jsx Money.jsx Parts.jsx (Row, Toggle, Field, ConfirmDialog, Modal, Spinner)
    RatingForm.jsx ContactSheet.jsx UserModal.jsx NoticeBanner.jsx ErrorBoundary.jsx RelayEditor.jsx QRCode.jsx SatsAmount.jsx
  features/
    auth/        AuthScreen (role-aware copy) + AuthSteps (unlock, key backup)
    profile/     ProfileParts (useSaveProfile, AccountHeader, ContactMethods, RelaysSection, LogoutButton),
                 VehicleSection, LightningAddressSection, WalletSection, KeysSection
    payments/    PayDriver (pay N sats to a Lightning address: NWC wallet, or invoice QR + LUD-21 watch)
  rider/
    App.jsx  state/RiderContext.jsx
    screens/ HomeScreen (dispatch) PlanTrip (idle/search/quote) ActiveTrip (searching/choose/pay deposit)
             OnTrip (enroute/arrived/riding) Receipt  ActivityScreen  AccountScreen
    components/ PlaceSearch, DriverInfo (+ Plate, useDriverInfo)
  driver/
    App.jsx  state/DriverContext.jsx
    screens/ HomeScreen (dispatch) Onboarding OnlineHome (offline GO / online / incoming card / waiting)
             DriveTrip  DriveSummary  EarningsScreen  AccountScreen
    components/ RiderInfo, Checklist
test/*.test.mjs
```

## Nostr event kinds (`src/nostr/eventKinds.js`)
| Kind | Name | Key tags | Content (JSON) |
|---|---|---|---|
| 0 | METADATA | — | `{name, about, communication[], picture, lud16, vehicle}` (+ fields from other apps, kept on merge) |
| 30078 | RIDE_REQUEST | `d`(id), `t`, `p`(driver, once confirmed) | `{pickup, dropoff, time, notes, status, fareSats, distanceMiles, durationMin, sealed}` — pickup/dropoff are COARSE; `sealed` = exact trip, NIP-44 to the rider. `fareSats` is the quoted fare (older requests lack it; the driver app estimates) |
| 30079 | RIDE_OFFER | `e`(request), `p`(rider), `d`, `t` | `{priceSats, upfrontSats, etaMinutes, message, plate}` — the driver's "I'll take it" at the rider's fare; `plate` NIP-44 to the rider |
| 30080 | RIDE_ACCEPT | `e`(offer), `e`(request), `p`(driver), `d`, `t` | `{offerId, requestId, paidSats, verified, sealed}` — `sealed` = exact trip, NIP-44 to the driver |
| 30081 | RIDE_CANCEL | `e`(request), `p`, `t` | `{requestId, reason}` |
| 30082 | RATING | `p`(ratee), `e`(ride), `d`, `t` | `{rating, review, rideId}` |
| 30083 | DRIVER_ROUTE | | unused (feature removed) |
| 30084 | RIDE_COMPLETE | `e`(request), `p`(rider), `d`, `t` | `{requestId}` — by the assigned driver |
| 30085 | RIDE_STAGE | `e`(request), `p`(rider), `d`="stage-<rideKey>", `t` | `{stage: "arrived" \| "riding"}` — by the assigned driver |
| 30086 | RIDE_PAYMENT | `e`(request), `p`(driver), `d`="pay-<rideKey>-<phase>", `t` | `{phase:"deposit"\|"rest", amountSats, level, sealed}` — by the rider; `sealed` = `{pr, preimage, verify}` NIP-44 to the driver |
| 30087 | RIDE_CONFIRM | `e`(request), `p`(driver), `d`="confirm-<rideKey>-<phase>", `t` | `{phase:"boarded"\|"ended"\|"problem", ok, note}` — by the rider |
| 30091 | TRIP_SHARE (addressable) | `d`="share", `t`, `expiration` | `{sealed}` — signed by a throwaway key; payload encrypted with that key (in the link #fragment) |
| 30090 | PRESENCE (addressable) | `d`="presence", `t`, `expiration` | `{name, npub, vehicle, lat, lng, ts}` — public, coarsened location |
| 21100 | RIDE_LOCATION (ephemeral) | `p`(rider), `expiration` | NIP-44 encrypted `{lat, lng, ts}` — exact, to rider only |

`status` ∈ `requested | accepted | in_progress | completed | cancelled`. The
rider's `in_progress` version also carries `driverPubkey`. Stage is `enroute`
(default) → `arrived` → `riding`.

## Invariants & gotchas (read before editing)
- **Trust rules (lib/rides.js)**: relay events are signed, but anyone can sign
  one. A ride's versions are requests with the same **author + d-tag** (never
  d-tag alone). A RIDE_CANCEL counts only from the rider or the assigned driver;
  a RIDE_COMPLETE and a RIDE_STAGE only from the assigned driver; a RIDE_CONFIRM and a RIDE_PAYMENT only from the ride's rider; a RATING only from the
  other party of that ride (one per rater per ride). Stages only move forward (the
  furthest valid marker wins). Always go through `rideVersions`/`rideStatus`/`rideEnding`/
  `rideStage`/`reputation` — don't re-derive.
- **Offers expire**: for a ride needed now an offer is good for `OFFER_TTL_SECONDS`
  (`offersForRide`, `pendingOfferFor`). After a driver is chosen, read their offer with
  `offerFrom` (no time limit) — it carries the fare, deposit and sealed plate for the rest of the ride.
- **Replaceable ordering**: `buildSignedEvent` gives every replaceable/addressable kind
  (0, 10000+, 30000+) a `created_at` strictly after the previous one for the same
  (kind, author, d). Relays keep the lowest id on a tie, so two saves within one second
  could otherwise leave the OLD version. Always sign through `buildSignedEvent`.
- **Kind 0 is shared with every Nostr app**: never publish a fresh kind-0 over
  an existing one. Writes start from `getMetadata(pubkey)` and merge (`useSaveProfile`);
  importing an nsec keeps the existing profile.
- **Privacy (lib/privacy.js)**: never publish an exact address or a license plate in
  clear. Requests carry `publicPlace()` points (area name + ~1 km grid) and the exact
  trip sealed to the rider; RIDE_ACCEPT seals it to the chosen driver. Read trips with
  `exactTrip(request, user) || content`. The plate lives sealed in kind-0
  `vehicle.sealedPlate` (open with `myVehicle`) and is sealed to the rider in each offer
  (`offerPlate`). Stage events carry no location. The public request does carry the trip's
  distance/duration (needed for the fare). Reverse-geocoding the rider's GPS sends it (~10 m)
  to Photon. Old events with clear values still display.
- **Untrusted text**: React escapes JSX. Never put relay text into HTML strings (Leaflet
  popups) — MapView uses only app-built labels (`esc` for price pills). Contact links come
  only from `contactHref` (fixed prefix + cleaned handle).
- **Events store `pubkey` as hex**, never npub. Convert for display only via
  `shortNpub(hex)` (keys.js). Public/secret bech32 = `user.npub` / `user.nsec`.
- **App tag (critical)**: our kinds (esp. 30078) are shared with other Nostr apps
  (NIP-78), whose events aren't our JSON. Every event we publish carries
  `["t", APP_TAG]`; relay reads filter by `"#t":[APP_TAG]`; `relay._ingest` rejects any
  relay event lacking the tag or with non-JSON content. Don't remove the tag from
  `publish()`/live.js.
- **Publishing**: user actions go through `useApp().publish(kind, content, tags)`,
  which signs with `user.sk` and sends to relays + cache. `publish` resolves to true once
  any relay accepts (false if none) — the rider app shows a warning when a request fails.
  Demo data uses `relay.publishLocal` (cache only); replies to a demo request use
  `publish(..., { localOnly: true })`. Don't use `relay.publish(createNostrEvent(...))`
  for user actions — real relays reject unsigned events.
- **Addressable kinds need unique `d` tags** (offer-<reqId>, accept-<reqId>, rating-<rideId>,
  stage-<rideKey>, cancel-/complete-<id>). Read replaceable lists through `latestVersions()`.
- **Payment is peer to peer (no escrow)**: the rider pays the driver's `lud16` — the
  deposit (`upfrontSats`) when choosing a driver, the rest on the receipt after the driver
  completes. `PayDriver` gets an invoice via `lib/lnurl.js` (rejects a wrong-amount invoice)
  and pays it via NWC or shows a QR (LUD-21 `verify` watched). Never invoice the rider's own
  wallet. Only `confirmDriver` publishes RIDE_ACCEPT + `in_progress`. "Rest paid" is remembered
  in localStorage (`riderPaid`) so it is never paid twice. Deposit is non-refundable after cancel.
- **Evidence** (no escrow, so keep a trail): the rider app publishes a RIDE_PAYMENT after each payment
  (`recordPayment`; `PayDriver` returns `{verified, level, pr, preimage, verify}`) and a RIDE_CONFIRM for
  boarded / ended / problem (`confirmRide`). The rider's `level` is NOT trusted: the driver app re-checks
  (`verifyPayment`: only a `verify` URL on the host of the driver's own lud16 is fetched).
- **Blocking** is local (`getSetting("blocked")`, `useApp().blockUser/isBlockedPk`): filter at the data
  boundary (driver `open` list, rider presence and `offersForRide` in ActiveTrip). Don't re-add blocked people anywhere else.
- **Outbox**: `relay.publish` queues an event no relay accepted (`nostrride_outbox` in localStorage) and
  re-sends it with backoff, on `online`/tab wake (`AppContext` → `relay.flushOutbox()` + `reconnectAll()`),
  and after reload. Ephemeral kinds are never queued. Pools use `enableReconnect`.
- **Safety / share**: `RiderContext` holds the share state (`share`, `startShare`, `stopShare`, `shareUpdate`);
  `OnTrip` pushes updates; `src/rider/Track.jsx` (`track.html`, built with this app) is the
  viewer. The share key is only ever in the URL fragment.
- **Service worker** (`public/sw.js`, production only): caches the shell and hashed assets; never touches
  relays, tiles or APIs. It cannot receive push while the app is closed. Native shell (`native/`) skips it.
- **Fare** (`lib/fare.js`): `FARE_RATES` in USD; sats via `btcUsd` (CoinGecko, refreshed every
  5 min). If the price is unavailable `FALLBACK_BTC_USD` is used and the quote screen says so.
  The driver app accepts at the quoted fare (no haggling); the driver sets only the deposit %.
- **Drive gating**: `isDriveReady(user)` (lib/profile.js) = face photo + plate state/number +
  year/make/model + Lightning address. Until then the Drive tab shows Onboarding and GO is unavailable.
- **Completion is driver-driven**; the rider can cancel. Both sides get an optional rating
  (under 5 stars needs a reason — `ui/RatingForm.jsx`). Ended rides come back as the
  receipt/summary screen for up to 6 h until dismissed (`riderDone` / `driverDone` in localStorage).
- **Live location**: the driver app broadcasts exact position to the rider (NIP-44, ephemeral) for the
  whole drive and public coarse presence while online and free. Geolocation needs https:// or
  localhost. **GPS quality** (`lib/gps.js`): a fix is `good` (≤ 200 m), `weak` (Wi-Fi/IP/indoors) or
  `stale` (> 60 s old). A driver can go online, and is advertised, only on a `good` fix; ride location
  is sent unless `stale`; the rider app warns when a pickup came from a weak fix. Browsers pause GPS when
  the tab is hidden, so the driver app holds a screen wake lock while online or driving (`useWakeLock`).
  ETAs use the OSRM road time from the map route (`onRoute`), with a straight-line guess as fallback.
- **Profiles carry photo + vehicle**: kind-0 has `picture` (small resized JPEG, ~20 KB budget in
  lib/image.js) and `vehicle:{picture,plateState,plateNumber,year,make,model}` (plate sealed).
  `relay.fetchProfile(pubkey)` pulls one user's kind-0 on demand (rider: DriverInfo; driver: RiderInfo).
- **History = fetchHistory(pubkey)**: live sync and `fetchRecent` cover only 24 h. Reputation and past
  trips need `relay.fetchHistory(pubkey)` (throttled to once per 5 min per pubkey, queued 3 at a time).
- **Speed**: `relay.query()` uses indexes (by kind, and by `e`/`d`/`p` tag value) — put the most
  selective tag in the filter. lib/rides.js memoizes per `relay.version`. AppContext coalesces event
  bursts (one refresh per 100 ms). MapView redraws cars/pills only when their content changes and
  re-fits only on `fitKey` / sheet-size changes (so users can pan during a trip).
- **Maps**: one `<MapView>` per screen (it is the background of `MapPage`; the `Sheet` reports its
  height so the map pads for it). Tiles = OpenStreetMap (`tile.openstreetmap.org`; free, but its usage policy forbids heavy/commercial traffic — move to a self-hosted or paid tile server before launch), geocoding = Photon (do NOT switch
  type-ahead to Nominatim — its policy forbids it), routes = OSRM (cached in routing.js).
  All are free public dev endpoints: rate-limited, swap for paid/self-hosted before launch
  (keep the return shapes; URLs come from `config/services.js` / `.env`).
- **No StrictMode** (see main.jsx): it double-mounts the map in dev and caused crashes.
  Keep every hook above a screen's early `return null`.
- **Login persistence**: with "Remember me" the key is saved encrypted with the user's password
  (NIP-49) under a per-app key (`nostrride_key` rider, `nostrride_driver_key` driver); a reload shows
  Unlock. Never store the key in clear. Logout removes it. The event cache and the NWC wallet
  connection are in memory only (cleared on reload).
- **Wallet is live, not faked**: balance/transactions come from the user's real wallet over NIP-47.
  A working NWC string is required; otherwise the UI shows an error, never fake data.
- **Tailwind via CDN** → arbitrary classes work, no build-time purge. Colors: black = primary, green
  (`#05944f`) = driver "go"/confirm, amber = warnings, `#f7931a` = Lightning bolt, blue = "you".
- **Public visibility**: requests/offers are public on the relays (anyone on those relays can read
  them). That is why exact points and plates are sealed; notes, fares and approximate areas are public.

## "Going live" swap points
- Relays: already real (`nostr/relay.js`, `nostr/live.js`). To harden: scope relays/geography,
  add reconnection, fetch remote kind-0 for display names beyond the ones we pull on demand.
- Signing, maps/geocoding/routing, Lightning (NIP-47 + lud16): already real (see above).
- Native background GPS: `native/` (Capacitor) + `lib/nativeGeo.js`, written but NOT run on a device.
- Not built yet: push while the app is closed (needs a push server), arbiter/ruling flow, synced block list (NIP-51), in-app chat/call (Contact sheet shows the other person's Signal/Telegram/phone),
  ride types
  (Comfort/XL), surge pricing.

## Adding a screen
1. Create `src/<rider|driver>/screens/<Name>Screen.jsx` (a full page: `<Screen title=…>`; a map page:
   `<MapPage map={<MapView/>}><Sheet>…</Sheet></MapPage>`).
2. Add it to `SCREENS` in that app's `App.jsx`; navigate with `useApp().setView("<id>")`.
3. Top-level tab? add it to that app's tab list (it hides the tab bar by being "busy" in Shell).
4. Role logic goes in that app's context; anything both apps need goes in `src/state`, `src/ui`, `src/features`, `src/lib`.

## Conventions
- One feature per folder; files stay under ~300 lines (WalletSection and nostr/relay.js are slightly
  over — split before growing them); each starts with a comment block explaining its purpose.
- This repo is generated from trevthom/nostr-ride: do not develop here. Fix the problem there and export again.
- Don't introduce a state library, router, or CSS framework build step.
- Don't commit secrets. `user.nsec`/`user.sk` live in memory; on disk only as the password-encrypted
  ncryptsec (keystore.js).
