# CLAUDE.md

Guidance for AI coding agents working in this repo. Read this first; it
should let you make correct edits without reading every file.

## What this is
NostrRide **Rider app** — one half of a decentralized ridesharing system. The rider and driver
apps are **separate repositories** that talk to each other only over **Nostr** (no server, no DB).
This repo is the **rider** app: Uber/Lyft-style: "Where to?", fare quote, find a driver, watch the car arrive, start with a 2-digit code, pay the driver in ecash as the ride runs, finish the ride, rate.
The sibling repo is **nostr-ride-driver**. Both speak the same events (table below).

> **Generated repository.** This is a copy of the rider app made from **trevthom/nostr-ride** by `scripts/export-apps.mjs`. Make changes in nostr-ride and export again: a hand edit here is overwritten by the next export.

Stack: **React 18 + Vite**. **Tailwind CSS v3 is built into the app's own CSS** (`src/tailwind.css` + `tailwind.config.js`,
through PostCSS in `vite.config.js`): no script from another site runs in the page (the app holds keys and money). Use **v3 only**:
Tailwind v4 and `@tailwindcss/vite` have a native binary that breaks on some machines. The built pages carry a Content-Security-Policy (`csp.mjs`).
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
`rideRequests`, `publish`, `pullRecent`, notices, `currency`/`prices`/`btcPrice`/`usdPrice`/`priceFor`, `ecash` (the Cashu wallet; loaded on demand), `wallet` (NWC), `liveTick`.
Role state: `src/rider/state/RiderContext.jsx` (`useRider()`) and
`src/driver/state/DriverContext.jsx` (`useDriver()`) — mounted only after login, keyed by pubkey.
No router: each `App.jsx` maps `view` → screen; the tab bar hides during a trip.
Each screen is wrapped in an `ErrorBoundary`.

## Ride lifecycle (how the two apps connect)
| Step | Rider app | Event (kind) | Driver app |
|---|---|---|---|
| 0 | sees cars nearby | PRESENCE 30090 (public, coarse) | **GO** online (needs GPS + `isDriveReady`) |
| 1 | picks route, chooses **Standard fare** (each driver's rates) or a **Flat price** (own offer), taps **Request** | RIDE_REQUEST 30078 `status:requested`, `fareMode`, `fareSats` (the flat price, or the estimate), `suggestedSats` | incoming card (45 s countdown) + price tags on map |
| 2 | "Finding your driver…" (can change a flat price after 30 s) | RIDE_REQUEST again, same d-tag, new `fareSats` | **Accept**; for a flat price also **counter** (higher price); or Decline |
| 3 | list of replies with each driver's rates + mint (preferred gender first if asked, then fastest) | RIDE_OFFER 30079 (`mode` metered/flat, `priceSats`, frozen `rates`, `mint`, trip miles/minutes, ETA, `gender`, sealed plate; good 5 min) | "Waiting for rider…" |
| 4 | **Choose** → confirm (needs ecash at the driver's mint for the start; NO deposit) | RIDE_ACCEPT 30080 (names the offer; exact trip sealed to driver) + RIDE_REQUEST `in_progress`+`driverPubkey` | drive starts: route to pickup. Nothing is charged yet |
| 5 | car moves live, "arriving in N min" | RIDE_LOCATION 21100 every 6 s (NIP-44 to rider) | **I've arrived** works only within 50 m (good fix) → RIDE_STAGE 30085 `arrived` (+`distM`) |
| 6 | "Your driver has arrived", checks the car (RIDE_CONFIRM `boarded`), types the driver's 2-digit code (RIDE_CONFIRM `code`) | | types the rider's code → **Start trip** → RIDE_STAGE `riding` (+`codes`) |
| 7 | "On the way to …"; the rider's app pays ticks: base, each mile, each minute | RIDE_TICK 30095 (token sealed to driver) | redeems each tick at the mint, answers RIDE_TICK_REPLY 30096; sees fare so far, missed payments |
| 8 | **Finish ride** (confirm) → pays the final tick; receipt | RIDE_FINISH 30081 (either person; time + meter) | **Finish ride** (confirm) or after 2 missed payments; summary; may waive (RIDE_WAIVER 30097) |
**There are no cancellations and no cancel fees.** Either person finishes the ride (RIDE_FINISH 30081). Before the ride
starts nothing is owed (status `closed`); after it started the rider owes what it earned (status `completed`). A driver with no
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
    app.js                        # APP_ROLE / IS_DRIVER_APP / APP_NAME / BUILD_ID (build time + commit, shown in Account)
    settings.js                   # tunables: FARE_RATES (USD, no minimum), FALLBACK_BTC_USD, MIN_OFFER_USD/MAX_OFFER_FACTOR (flat price),
                                  #   RATE_LIMITS, REQUEST_CARD_SECONDS, OFFER_TTL_SECONDS, DEFAULT_REQUEST_RADIUS_MILES,
                                  #   USE_DEMO_DATA (dev only), CONTACT_PLATFORMS
    services.js                   # tile / Photon / OSRM URLs + DEFAULT_MINT, overridable by VITE_* env (see env.example)
    relays.js                     # DEFAULT_RELAYS, getRelays/setRelays/useRelays, getSetting/setSetting (localStorage)
  nostr/
    eventKinds.js                 # EVENT_KINDS + APP_TAG
    keys.js  keystore.js          # real keys; optional NIP-49 "remember me" (key name differs per app)
    events.js                     # createNostrEvent (unsigned, demo) + buildSignedEvent (signed; replaceable kinds get strictly increasing created_at)
    relay.js                      # SimplePool + local cache: publish, publishLocal, query, onEvent, startSync, fetchRecent, fetchProfile, fetchHistory
    replaceable.js  profiles.js   # latestVersions(); getProfile/getMetadata
    live.js                       # presence (public, coarse) + ride location (NIP-44, ephemeral)
    seedbox.js                    # where the ecash recovery phrase is kept on the device: encrypted under its own key (lib/recovery.js boxKey); loadOrCreate
    ecashRecovery.js              # makeRecovery({box,newAdapter}): the phrase for this device, the mint adapters made with its seed, confirmBackup, restore(text, urls), rotateAll; no Cashu import
    vouchSync.js                  # syncVouches(me): my vouch list, my vouches' lists, their names (3 small relay queries; login + every 5 min + after a change)
    share.js                      # "Share my trip": throwaway-key link, encrypted trip updates (kind 30091)
    wallet.js                     # NIP-47 (NWC) client
    ecash.js                      # EcashWallet: Cashu bookkeeping over a "mint adapter" (fund, pay, redeem, cash out, pending/recovery, encrypted save) — no network code, no Cashu import
    cashuMint.js                  # the REAL mint adapter on @cashu/cashu-ts (+ restore(), seed/counters) + userWallet(user) — the ONLY file that imports the Cashu library; loaded on demand (own chunk)
    reachable.js                  # probeRelay(url): a throwaway WebSocket test; never touches the pool's own connections
    link.js                       # remembers when OUR relays were unreachable (never counted as the other person's silence)
    demoData.js                   # dev-only fake riders/requests (driver app only)
  lib/
    rides.js      # trust rules: rideVersions/rideStatus (requested→in_progress→completed|closed)/rideEnding (earliest finish; silence cut-off clamped)/rideStage/rideTimes/rideConfirm/rideDriver/rideKey/tripCounts (plain counts, no stars)
    ticks.js      # PURE tick maths: unitSats, newLedger/advanceLedger (base, mile, minute), missedTicks, settle (final tick), convertToMetered (flat→normal fare), milesAt
    ridemoney.js  # currentLedger(request,…): the saved ledger of a ride, advanced or settled; ledgerSummary; milesAtTime
    payments.js   # tick/reply/waiver/alive event builders and readers (ticksOf, tickReplies, paidSats, sentSats, waiversOf, signalTimes, outstandingSats)
    terms.js      # rideTerms(request): the CHOSEN offer's frozen rates/mode/price → ticks; rideMint; agreedOffer
    finish.js     # finish reasons, SILENCE_FINISH_MS, bothQuiet/quietMs/finishCutoff, waiverSplit, readFinish
    startcode.js  # the 2-digit start codes (HMAC of the NIP-44 conversation key), wrong-try lock
    arrival.js    # canMarkArrived (≤ 50 m, good fix), arrivalMismatch (rider's check)
    stops.js      # extra stop / new destination: stopChanges, stopTrip/fullTrip, hasAcceptedStop, nextStop; STOP_NOTE_*
    currency.js   # CURRENCIES, get/setCurrency, formatFiat, toMinor, satsFromFiat/fiatFromSats (pure maths)
    mints.js      # cleanMintUrl/isMintUrl/mintLabel
    trips.js      # derive current state: activeRideFor, activeDriveFor, offersForRide, rankOffers/offerGender, offerFrom, pendingOfferFor, acceptFor, upcomingRidesFor, isScheduledLater
    odometer.js   # stepOdo/newOdo: miles of a GPS track (skips wobble, bad fixes, glitches) (pure)
    meter.js      # referenceMiles (driver's distance unless the rider's differs >5%), meterView, fmt* (pure)
    pickup.js     # pickupChange(request): pending|accepted|declined; PICKUP_CHANGE_NOTE (the exact place logic is in privacy.js)
    fare.js       # quoteFare/fareAmount/usdToSats/pickupEta + normalizeRates (incl. currency)/typicalFare/typicalSats/median/satsFromUsd/usdFromSats/offerLimitsSats/offerLevel/replyKind (pure)
    earnings.js   # completedDrives (paid ticks + tips), summarizeEarnings
    privacy.js    # publicPlace, seal/unseal, exactTrip, sealVehicle/myVehicle/offerPlate
    contact.js    # contactHref (safe links from untrusted handles)
    evidence.js   # tip records (30086) + proofLevel + driver-side verifyPayment + disputeRecord (ticks, replies, waivers, finishes); rideConfirm is in rides.js
    bolt11.js     # paymentHash / preimageMatches
    blocks.js     # local block list helpers
    recovery.js   # the 12-word recovery phrase (pure): newPhrase/cleanPhrase/checkPhrase/seedOf/pickCheckPositions/checkAnswers/boxKey (@scure/bip39; HKDF)
    vouches.js    # "I know and trust this person": parsePubkey (npub; an nsec is refused), vouchEvent/vouchList (kind 30102), trustFor(target, me) = {direct, via} (ONE hop, only through people I vouch for), trustHeadline/trustDetail (the badge words)
    safety.js     # trusted contacts, sms link, trip message
    nativeGeo.js  # background location via Capacitor (run-time lookup; web build has no dependency)
    notify.js     # service worker registration + system notifications
    gps.js (gpsStatus/gpsMessage: good|weak|stale; canBeOnline/approxNote) useGeolocation.js (pos, error, status) useWakeLock.js
    geo.js geocode.js (search + reverseGeocode) routing.js (OSRM, cached) image.js lnurl.js locations.js profile.js (driveGaps/gapsText/isDriveReady)
  state/AppContext.jsx            # shared state (above)
  ui/                             # shared UI kit
    Layout.jsx    # AppFrame, MapPage (+ measures the Sheet so the map pads for it), Sheet (collapsible with `peek`/openKey/closeKey), FloatButton, Screen, TabBar
    MapView.jsx   # Leaflet + OpenStreetMap tiles; pins, OSRM route, cars, "me" dot, price pills, ref.fit(); trip mode (`navigation` + `follow`)
    Button.jsx Icon.jsx Avatar.jsx Money.jsx Parts.jsx (Row, Toggle, Field, ConfirmDialog, Modal, Spinner)
    Fold.jsx      # a section that opens and closes (Account); openFold(id); FoldTitle/SectionLabel draw nothing inside a Fold (the header has the title)
    AmountInput.jsx (local currency or sats, unit swap; flat prices, counters, tips, funds)  TripMeter.jsx (time + distance card, peekMeter)  VouchBadge.jsx ContactSheet.jsx UserModal.jsx NoticeBanner.jsx ErrorBoundary.jsx RelayEditor.jsx QRCode.jsx SatsAmount.jsx
  features/
    auth/        AuthScreen (role-aware copy) + AuthSteps (unlock, key backup)
    profile/     ProfileParts (useSaveProfile, AccountHeader, ContactMethods, RelaysSection, LogoutButton),
                 VehicleSection, VouchesSection ("Your vouches": npub in, list out), TypicalFareSection ("Your rates", locked during a ride), CurrencySection, LightningAddressSection, WalletSection, KeysSection
    ecash/       EcashSection (balance, mint, paste a token, back up, driver cash out), RecoverySection (RecoveryFold + RecoveryNotice: write down 12 words, show again, I-lost-a-phone) + RestorePanel, myMint.js
    payments/    PayDriver (a Lightning address: tips), AddFunds (mint invoice → ecash, NWC or any wallet), rideTicks.js (rider: payDue), redeemTicks.js (driver: redeem + reply),
                 redeemWaivers.js (rider: collect refunds), useRideLink.js (quiet phone, sign of life, 10-minute silence)
  rider/
    App.jsx  state/RiderContext.jsx
    screens/ HomeScreen (dispatch) PlanTrip (idle/search/pin/quote: standard fare | flat price) ActiveTrip (searching/choose/confirm driver)
             OnTrip (enroute/arrived/riding) Receipt  ActivityScreen  AccountScreen
    state/ useRiderMeter (rider's own odometers + the 5% rule)
    components/ PlaceSearch, PinPicker (drag the map under a pin → the pickup OR the drop-off: `field`), GenderPref, ChangePickup, AddStop, FareTerms, TipSheet, DriverInfo (+ Plate, useDriverInfo)
  driver/
    App.jsx  state/DriverContext.jsx  state/useDriveOdometer.js
    screens/ HomeScreen (dispatch) Onboarding OnlineHome (offline GO / online / incoming card / waiting) NearbyRequests (the list)
             DriveTrip  DriveSummary  EarningsScreen  AccountScreen
    components/ RiderInfo, Checklist
test/*.test.mjs
```

## Nostr event kinds (`src/nostr/eventKinds.js`)
| Kind | Name | Key tags | Content (JSON) |
|---|---|---|---|
| 0 | METADATA | — | `{name, about, communication[], picture, lud16, gender?, rates?, vehicle}` (+ fields from other apps, kept on merge) |
| 30078 | RIDE_REQUEST | `d`(id), `t`, `p`(driver, once confirmed) | `{pickup, dropoff, time, notes, status, hide?, fareMode, fareSats, suggestedSats, distanceMiles, durationMin, sealed}` — `hide` = hide tokens of the drivers the rider blocked (lib/blocks.js); pickup/dropoff are COARSE; `sealed` = exact trip, NIP-44 to the rider. `fareMode` = `"standard"` (each driver's rates; `fareSats` is only an estimate) or `"flat"` (`fareSats` is the RIDER'S FLAT PRICE); older requests lack both (the driver app estimates); `suggestedSats` is what the app suggested. `status` ∈ `requested \| in_progress \| closed` (old: `cancelled`) |
| 30079 | RIDE_OFFER | `e`(request), `p`(rider), `d`, `t` | `{priceSats, mode, rates, mint, tripMiles, tripMinutes, etaMinutes, message, typicalSats, gender, plate}` — the driver's reply. `mode:"flat"`: the rider's flat price (accept) or a higher price (counter); `mode:"metered"`: the driver's standard fare (`priceSats` = their estimate). `rates` = `{base, perMile, perMinute, currency}` (a frozen copy) and `mint` = where the driver is paid; `gender` optional, self-declared; `plate` NIP-44 to the rider. No deposit |
| 30080 | RIDE_ACCEPT | `e`(offer), `e`(request), `p`(driver), `d`, `t` | `{offerId, requestId, sealed}` — `offerId` names the offer whose rates and mint are FROZEN for the ride; `sealed` = exact trip, NIP-44 to the driver |
| 30081 | RIDE_FINISH | `e`(request), `p`, `d`="finish-<id>", `t` | `{requestId, reason: rider\|driver\|destination\|unpaid\|silence, role, at, miles?, minutes?, atDestination?}` — by the rider or the assigned driver; ends the ride (NO cancellations, NO fees). `at`/`miles` = the moment and meter the charge runs to |
| 30082 | RATING | | UNUSED: star ratings and reviews were removed (too easy to fake). Old events are ignored. See 30102 |
| 30083 | DRIVER_ROUTE | | unused (feature removed) |
| 30084 | RIDE_COMPLETE | `e`(request), `p`(rider), `d`, `t` | `{requestId}` — by the assigned driver. Older apps only; read as "finished at the destination" |
| 30085 | RIDE_STAGE | `e`(request), `p`(rider), `d`="stage-<rideKey>", `t` | `{stage: "arrived" \| "riding", at, arrivedAt?, distM?, codes?}` — by the assigned driver; `at` = ms now, the "riding" marker recalls `arrivedAt` (a relay keeps only the newest marker); `distM` = the driver's measured metres from the pickup (≤ 50); `codes` = both start codes were checked |
| 30086 | RIDE_PAYMENT | `e`(request), `p`(driver), `d`="pay-<rideKey>-<phase>" (`-tip-<ms>` for a tip), `t` | `{phase:"tip" (old rides: "deposit"\|"rest"), amountSats, level, sealed}` — by the rider; `sealed` = `{pr, preimage, verify}` NIP-44 to the driver. Tips only |
| 30087 | RIDE_CONFIRM | `e`(request), `p`(driver), `d`="confirm-<rideKey>-<phase>", `t` | `{phase:"boarded"\|"code"\|"ended"\|"problem", ok, note}` — by the rider (`code` = typed the driver's start code) |
| 30093 | RIDE_PICKUP_CHANGE (addressable) | `e`(request), `p`(driver), `d`="pickup-<rideKey>-<changeId>", `t` | `{changeId, sealedDriver, sealedSelf}` — the new pickup `{pickup:{name,lat,lng}}` NIP-44 to the driver and to the rider; only the ride's rider |
| 30094 | RIDE_PICKUP_REPLY (addressable) | `e`(request), `p`(rider), `d`="pickup-reply-<changeId>", `t` | `{changeId, accepted}` — only the assigned driver |
| 30095 | RIDE_TICK (addressable) | `e`(request), `p`(driver), `d`="tick-<rideKey>-<seq>-<nonce>", `t` | `{seq, trigger, amountSats, mint, at, sealed}` — one ecash payment by the ride's rider; `sealed` = `{token}` (a cashuB token) NIP-44 to the driver; the amount is public |
| 30096 | RIDE_TICK_REPLY (addressable) | `e`(request), `e`(tick), `p`(rider), `d`="tick-reply-<tickId>", `t` | `{tickId, ok, receivedSats, reason}` — only the assigned driver; `ok:false` only for a FINAL refusal (never for an unreachable mint) |
| 30097 | RIDE_WAIVER (addressable) | `e`(request), `p`(rider), `d`="waive-<rideKey>-<ms>", `t` | `{forgivenSats, refundSats, reason, sealed?}` — only the assigned driver; `sealed` = `{token}` NIP-44 to the rider (the refund) |
| 30098 | RIDE_ALIVE (addressable) | `e`(request), `p`(other), `d`="alive-<rideKey>-<role>", `t` | `{role, forRole, at}` — "still riding / still driving": a signed sign of life by the rider or the assigned driver, vouching for `forRole` |
| 30099 | RIDE_STOP_CHANGE (addressable) | `e`(request), `p`(driver), `d`="stop-<rideKey>-<changeId>", `t` | `{changeId, mode: stop\|destination, sealedDriver, sealedSelf}` — the new place NIP-44 to the driver and the rider; only the ride's rider |
| 30100 | RIDE_STOP_REPLY (addressable) | `e`(request), `p`(rider), `d`="stop-reply-<changeId>", `t` | `{changeId, accepted}` — only the assigned driver |
| 30101 | RIDE_OFFER_DECLINE (addressable) | `e`(request), `e`(offer), `p`(driver), `d`="decline-<requestId>-<driver>", `t` | `{requestId, offerId}` — only the ride's rider; turns ONE driver's offer down, the request stays open |
| 30102 | VOUCH_LIST (addressable) | `d`="vouches", `p`(each person), `t` | `{v:1, count}` — the people the author knows and trusts ("Your vouches"), at most 100, PUBLIC. A vouch is for the person (no role). The newest list replaces the old one |
| 30091 | TRIP_SHARE (addressable) | `d`="share", `t`, `expiration` | `{sealed}` — signed by a throwaway key; payload encrypted with that key (in the link #fragment) |
| 30090 | PRESENCE (addressable) | `d`="presence", `t`, `expiration` | `{name, npub, vehicle, rates?, hide?, lat, lng, ts}` — public, coarsened location; `hide` = hide tokens of the riders the driver blocked |
| 21100 | RIDE_LOCATION (ephemeral) | `p`(rider), `expiration` | NIP-44 encrypted `{lat, lng, ts, pm?, tm?}` — exact, to rider only; `pm`/`tm` = the driver's odometer (miles to the pickup / on the trip) |
| 21101 | RIDE_METER (ephemeral) | `p`(driver), `expiration` | NIP-44 encrypted `{ts, pm?, tm?}` — rider → driver: the distances both screens show (`referenceMiles`); also the driver's live sign that the rider's app is there |

`rideStatus` ∈ `requested | in_progress | completed | closed` (an old request marked `cancelled` reads as `closed`). A ride that ends
after the `riding` marker is `completed`; one that ends before it is `closed` (nothing owed). The rider's `in_progress` version also
carries `driverPubkey`. Stage is `enroute` (default) → `arrived` → `riding`.

## Invariants & gotchas (read before editing)
- **Trust rules (lib/rides.js)**: relay events are signed, but anyone can sign
  one. A ride's versions are requests with the same **author + d-tag** (never
  d-tag alone). A RIDE_FINISH counts only from the rider or the assigned driver (the EARLIEST valid one ends the ride; within 10 s the one that costs
  the rider less; a claimed finish time must be close to the event's own time — except `silence`, which may run back to the last signed signal but never
  before a signed event that proves someone was there); a RIDE_COMPLETE (old) and a RIDE_STAGE only from the assigned driver; a RIDE_CONFIRM, a RIDE_PAYMENT, a RIDE_TICK and a
  RIDE_STOP_CHANGE only from the ride's rider; a RIDE_TICK_REPLY, a RIDE_WAIVER and a RIDE_STOP_REPLY only from the assigned driver; a RIDE_ALIVE from either. Stages only move forward (the
  furthest valid marker wins). Always go through `rideVersions`/`rideStatus`/`rideEnding`/
  `rideStage`/`tripCounts` and `lib/payments.js` — don't re-derive.
- **Offers expire**: for a ride needed now an offer is good for `OFFER_TTL_SECONDS`
  (`offersForRide`, `pendingOfferFor`). After a driver is chosen, read their offer with
  `offerFrom` (no time limit) — it carries the fare and sealed plate. For MONEY use `agreedOffer`/`rideTerms` (lib/terms.js): they read the offer the rider's RIDE_ACCEPT
  names, so a driver's later offer can never change the rates or the mint of a running ride.
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
- **Addressable kinds need unique `d` tags** (offer-<reqId>, accept-<reqId>, vouches,
  stage-<rideKey>, finish-/complete-<id>, tick-<rideKey>-<seq>-<nonce>, tick-reply-<tickId>, …). Read replaceable lists through `latestVersions()`.
- **Payment is pay-as-you-ride in ecash (no escrow, no deposit, NO cancellations or cancel fees)** — see docs/index.md "Pay as you ride". The rider pays the driver in TICKS
  (lib/ticks.js): the base when the ride starts, each full mile, each full minute, and a final part at the finish. Money is in SATS; each tick's sats are fixed when it falls due
  (the driver's rate, in the rate's currency, at that moment's BTC price). Both apps keep the same saved LEDGER (`lib/ridemoney.js currentLedger`) from the signed start time and
  the agreed meter. The rider's app (`features/payments/rideTicks.js payDue`, run every 3 s by `RiderContext`) pays everything due as ONE token event (30095); a short wallet pays what
  it can and the rest stays due (never lost, never paid twice: `sentSats` counts every non-refused tick). The driver's app (`redeemTicks.js`, run by `DriverContext`, for ALL its rides) redeems
  each token and answers (30096): `ok:false` ONLY on a final refusal, never when the mint is unreachable. "Paid" = what the driver confirmed (`paidSats`). `missedTicks` (due > 30 s
  and uncovered) ≥ 2 lets the driver finish. The rider may refill and pay what is missed, also after the ride. Flat price: same ticks, scaled to add up to the price and capped at it; finished AT
  THE DESTINATION the rest is owed; an accepted extra stop converts it to the normal fare from the start (`convertToMetered`). The driver may waive (30097): unpaid forgiven first, the rest
  sent back as an ecash token sealed to the rider (`redeemWaivers.js`; `ecash.payUpTo` sends the most the balance allows, because spending proofs costs the mint's input fee, and the waiver records the sats really sent; the modal caps the amount at what the driver still holds at the ride's mint). Never invoice the rider's own wallet. Only `confirmDriver` publishes RIDE_ACCEPT + `in_progress`.
- **Ecash wallet** (`nostr/ecash.js`): bookkeeping only, over a mint adapter; `nostr/cashuMint.js` is the ONLY file that imports `@cashu/cashu-ts` (loaded on demand by `AppContext`).
  Proofs are saved encrypted (NIP-44 to the user's own key, in pieces). Rules: one money move at a time (`_exclusive`); a token being sent sits in `pending` until its event is
  published/queued (`settle`) or is returned (`unreserve`/`recoverPending`); a token is redeemed once (fingerprint); the sender adds the mint's input fee (`includeFees`) so the receiver
  gets the full tick; `EcashError.definitive` separates a mint's "no" from an unreachable mint. Never log proofs or tokens. Test against `test/helpers/localmint.mjs` (real maths).
- **Tips** still go over Lightning: the rider's `lud16` payment via `PayDriver` and a RIDE_PAYMENT `tip` record. **Evidence**: tips are re-checked by the driver app
  (`verifyPayment`: only a `verify` URL on the host of the driver's own lud16 is fetched); the tick trail (30095/30096/30097/30098) is the evidence for the ride's money.
- **Finish ride (lib/finish.js)**: one `finishRide` action per app (rider: RiderContext, driver: DriverContext), always behind a `ConfirmDialog`. Before the `riding` marker nothing is
  owed (`closed`). A quiet phone is never a finish; `useRideLink` asks "still with you?" after 2 min (RIDE_ALIVE), and finishes with reason `silence` only when BOTH were silent for 10 min,
  checked once when an app starts for the ride; time our own relays were down (`nostr/link.js`) is never counted. "I've arrived" needs `canMarkArrived` (≤ 50 m, good fix). The ride starts
  with both 2-digit codes (`lib/startcode.js`): rider confirm `code` + the driver's typed check. A GPS gap ≤ 10 min is filled with a straight line (`odometer.js maxGapMs`).
- **Local currency** (`lib/currency.js`): each person picks one in Account; `AppContext` exposes `currency`, `prices` (code → BTC price, last good ones kept 24 h), `btcPrice` (the chosen
  currency's), `usdPrice`, `priceFor(code)`. A driver's rates carry their currency (`normalizeRates` adds `currency`, default USD; limits scale with the currency). Never guess a missing price:
  show sats / wait. Use `formatFiat(x)` (never a literal "$"). The app's own rates and `MIN_OFFER_USD` are dollars (use `usdPrice`).
- **Ecash recovery phrase (lib/recovery.js, nostr/seedbox.js, nostr/ecashRecovery.js, features/ecash/RecoverySection.jsx)**: every coin the wallet MAKES for itself has a deterministic secret (Cashu NUT-13: seed of a 12-word BIP39 phrase + keyset + counter), so the phrase
  restores the ecash on a new device (NUT-09 `restore`). Rules: (1) the phrase is its OWN secret, never derived from the nsec (a leaked nsec must not drain the wallet); (2) it is made on first open of the wallet, before any coin, and kept ONLY encrypted under `boxKey(sk)` (its own HKDF label);
  it never goes into an event, to a relay, to a mint, into a log, an error message or a URL; (3) counters live in `wallet.state.counters` and are saved BEFORE the mint is asked (`counterSource()`); (4) coins SENT to someone else use random secrets (`send: {type:"random"}` in `cashuMint.js split`),
  so a restore never resurrects a token already handed to a driver; a restore skips proofs that are in `pending`; (5) after a restore every coin is swapped for a fresh one (`rotate`), so a copy on a lost phone is spent; (6) a restore ALWAYS sweeps the typed phrase's coins into THIS wallet's own phrase (`recovery.restore` → `wallet.restore(urls, { source })`); the typed phrase is never adopted, so it is left empty
  (a leaked phrase / a compromised lost phone cannot take the money again) and the UI asks for this wallet's new words at once (`onRestored` → write-down modal);
  (6b) `wallet.syncSpent()` (at load and every 5 min, in AppContext) drops coins the mint calls SPENT, asking the mint WITHOUT holding the money lock; (6c) `recovery.disconnect({force})` = syncSpent → recoverPending → refuse if a token is still pending or if money
  exists and the words are not written down → `rotateAll` (refuse on a failed swap unless `force`) → `wallet.wipe()` + `box.erase()`; `AppContext` keeps `ecashOff` (`nostrride_ecashOff_<pk16>`), `disconnectEcash`, `connectEcash`; while off the wallet is not loaded (no new phrase is made), a driver cannot GO and a rider
  cannot confirm a driver, and it is locked while a ride is running; (7) on "Blinded message is already signed" (10002) the adapter skips its counters ahead and retries once (another device used the numbers) and takes no coins; (8) `@cashu/cashu-ts` is pinned EXACTLY (no `^`) and
  `test/recovery.test.mjs` holds the NUT-13 specification vector: a library change must not alter a derived secret. The phrase counts as safe (`backedUp`) only after the person types three words back. Old random coins (`state.legacy`) are swapped under the phrase when it is confirmed.
- **Account folds (ui/Fold.jsx)**: every setting on both Account screens is a `<Fold id title>`: closed at first (a driver's vehicle / Lightning address start open while still needed), open state remembered per device (`nostrride_fold_<id>`), content stays mounted while closed (typed text is kept).
  A section's own `SectionLabel`/`FoldTitle` draws nothing inside a Fold. E2E scripts open a section with `openFold(page, title)` (scripts/e2e/flow.mjs). New settings go in a Fold.
- **Vouches (lib/vouches.js, nostr/vouchSync.js, ui/VouchBadge.jsx, features/profile/VouchesSection.jsx)**: the ONLY reputation. No stars, no reviews (they are easy to fake): do not add them back. Each person publishes one public list (kind 30102,
  `d`="vouches", a `p` tag per npub, max 100) from Account → Your vouches. A vouch is for the PERSON, in either role. The badge is read for the VIEWER and is ONE hop: `trustFor(target, me)` = the people in MY list who have the target in THEIR list
  ("N of your vouches know and trust this person"; "You know and trust this person" when the target is in my own list). Never count a vouch from a person I did not choose, never go a second hop, and show NOTHING (no "0") when there is none. `syncVouches` asks
  relays only for my list, my vouches' lists and their kind-0 names. `parsePubkey` refuses an nsec. Trip counts (`tripCounts`) are plain facts and stay.
- **Blocking** is local (`getSetting("blocked")`, `useApp().blockUser/isBlockedPk`): filter at the data
  boundary (driver `open` list, rider presence and `offersForRide` in ActiveTrip). Don't re-add blocked people anywhere else.
  It also works the OTHER way (`lib/blocks.js`): requests carry `hide` tokens of blocked drivers (`hideList(me, blocked)`), driver presence carries `hide` tokens of blocked riders;
  the driver's `open` filter uses `hidesMe(c.hide, r.pubkey, me)` and `subscribePresence(..., { viewerPubkey })` skips a driver who hid from me. `hidesMe` treats anything but an array as "hides nobody".
- **Unmatched requests**: `rideExpiryMs` (lib/rides.js) = ASAP created+1 h, a reservation pick-up time + `RESERVATION_TTL_MS` (2 h); everyone derives it from the signed request. `RiderContext` closes waiting
  requests on logout (`onLogout` hook in AppContext, 3 s at most) and says once when one expired. **Declined offers**: kind 30101 (`declineEvent`, `declinedDrivers` in lib/trips.js): only the ride's rider counts;
  `validOffers`, `pendingOfferFor` and the driver's `open` list skip a declined driver, and the decline holds for later versions of the request.
- **Driver alerts**: `alerts` (Account) only controls the pop-up card (`OnlineHome` `auto`), the notice and the system notification. The Drive tab badge and the `NearbyRequests` list (`See nearby requests`) work with alerts on or off.
- **Navigation (rider)**: the bottom `TabBar` is ALWAYS visible in both apps. `RiderContext.plan` has `step` (idle|search|pin|quote) and `from` (where the search page was opened: idle|quote).
  The search page's back arrow goes to `from` (never loop quote ⇄ search); "Cancel" (search), the X (quote, pin), "Cancel and go home" (quote) and a tap on the Ride tab call `resetPlan()` (cancel, home). `PinPicker` returns a place shaped like a search result.
- **Connection health** (`nostr/relay.js`, `nostr/reachable.js`, `ui/ConnectionBanner.jsx`): the pool is built with `maxWaitForConnection: 15000` (the 3 s default DROPS a slow relay for good). `relayState` tests a relay with a SEPARATE
  socket (`probeRelay`), never `pool.ensureRelay` with a short timeout (that kills the real connection); only a failed test younger than 15 s counts as "failed". A reachable relay with no live connection is healed (`_heal`, once per 10 s).
  On `online` or a sleep over 30 s `refreshConnections()` closes and reopens all sockets. The banner's "can't reach any relay" needs 20 s of nothing connected AND every test failed; its "N updates are waiting" needs the oldest to have waited 20 s (`relay.oldestOutboxAge`). A relay has 15 s to answer a publish (`PUBLISH_WAIT_MS`, set on the pool's relay objects in `_send`). A screen warns about ONE event only while it is STILL in the outbox (`useOutboxAge(id)`), never from a remembered one-time failure (the old sticky `sendFailed` did that).
- **Outbox**: `relay.publish` queues an event no relay accepted (`nostrride_outbox` in localStorage) and
  re-sends it with backoff, on `online`/tab wake (`AppContext` → `relay.flushOutbox()` + `reconnectAll()`),
  and after reload. Ephemeral kinds are never queued. Pools use `enableReconnect`.
- **Safety / share**: `RiderContext` holds the share state (`share`, `startShare`, `stopShare`, `shareUpdate`);
  `OnTrip` pushes updates every `LOCATION_PING_MS` (6 s, config/settings.js: the SAME constant as the driver's location pings) with `sharePayload` (lib/safety.js): the RIDER's own phone position (`who:"rider"`,
  left out when the fix is stale) and the car (`carPos`) only until the ride starts; `sharedPositions` is what `src/rider/Track.jsx` (apps/rider/track.html, built with the rider app, the viewer) draws (an older app's
  lat/lng is the car). The share key is only ever in the URL fragment.
- **Service worker** (`public/sw.js`, production only): caches the shell and hashed assets; never touches
  relays, tiles or APIs. It cannot receive push while the app is closed. Native shell (`native/`) skips it.
- **Fares** (`lib/fare.js`): the rider chooses `fareMode` `"standard"` (each driver's own rates; the request's `fareSats` is only an estimate; the driver cannot counter) or `"flat"` (the RIDER
  names ANY amount, in the local currency or sats: `ui/AmountInput`, limits from `offerLimitsSats`: `MIN_OFFER_USD` .. `MAX_OFFER_FACTOR` × suggestion; published as `fareSats`; a driver accepts or
  counters higher with `acceptRequest(request, priceSats)`; `replyKind(price, offer)` names the reply). The rider can republish a flat request with a new `fareSats` (`raiseOffer`) while no driver is chosen.
- **Driver rates**: each driver may set `rates` {base, perMile, perMinute, currency} (kind 0 and public presence; `normalizeRates` rejects junk; limits `RATE_LIMITS`, scaled per currency). The fare is
  base + per mile × miles + per minute × minutes (`fareAmount`), **no minimum fare**; no rates → `APP_RATES`. The rider's quote suggests the MEDIAN of nearby drivers' fares IN SATS (`typicalSats`)
  (the app's formula if no driver is near); each offer carries `typicalSats`. The rates in an offer are FROZEN once the rider chooses it, and the Account screen locks the rates during a ride.
  Use the trip as the request publishes it (miles to a tenth) on both sides or the cents differ. Round money to whole cents before showing it.
- **Gender preference**: drivers MAY set `gender` ("male" | "female") in kind 0 (copied into offers); anything else is ignored.
  A rider's preference (`getSetting("genderPref")`, local only) only reorders the offers via `rankOffers`; never filter or hide a driver by it.
- **Drive gating**: `isDriveReady(user)` = `driveGaps(user)` is empty (lib/profile.js): face photo + vehicle year/make/model +
  vehicle photo + plate state/number + Lightning address (no driver's license photo). Gender is optional. Until then the
  Drive tab shows Onboarding and GO is unavailable. Every message about what is missing comes from `driveGaps`/`gapsText`
  so it names the exact items; keep it that way when adding a requirement.
- **Tips**: optional and never required. `TipSheet` (opened from the Receipt's quiet link and from Activity → past trip, any time after the ride)
  pays the driver's `lud16` via `PayDriver` and records `recordPayment(..., "tip", ...)` (a new d-tag each time, so there can be several). `tipsOf(request)`
  (lib/evidence.js) reads them without keys (amount is public, only the rider can author, completed rides only); earnings count a tip on the day it was sent.
- **Changing the pickup** (lib/privacy.js `pickupProposals/pickupReplies/acceptedPickup`, lib/pickup.js): the rider proposes (30093, new place sealed to the
  driver AND to the rider), the assigned driver accepts/declines (30094). `exactTrip(request, user)` swaps in the newest ACCEPTED pickup, so every screen
  follows. Pending/declined changes change nothing. It must NEVER reset or change the odometers and clocks (the ride's miles/minutes), and both people are told
  (`PICKUP_CHANGE_NOTE`).
- **Trip meter** (lib/odometer.js, lib/meter.js): the driver's odometer rides in each location update (`pm`,`tm`); the rider's app (`useRiderMeter`) keeps its OWN figure
  inside the code (own phone GPS during the trip, the car's position updates on the way to the pickup), applies `referenceMiles` (driver's distance unless the rider's
  differs by more than 5%; 0.05 mi floor near zero), and sends the result to the driver (21101) so both screens agree. The rider's own figure is never displayed. Times come
  from `rideTimes(request)` (signed stage markers; they carry earlier times because relays keep only the newest marker). The meter now FEEDS THE TICKS (miles → mile ticks and the final tick).
- **nostr-tools filters**: `pool.subscribeMany(relays, filter, params)` and `querySync` take ONE filter OBJECT in the installed 2.25 (an array reaches the relay as an
  invalid filter and live subscriptions silently die). `test/pool-api.test.mjs` guards it. Test relays must be strict about this too.
- **Pickup is never automatic**: `PlaceSearch` does NOT fill the pickup from GPS; the rider types an address or a business name, pins the spot (`PinPicker`, the "Set pickup on the map" button is always visible), or taps "Your location" (a deliberate tap). `PlanTrip` never passes `here` as a pickup. It shows a *Done* button when both places are set.
  The DROP-OFF can be pinned too ("Set drop-off on the map", also always visible): `PlaceSearch onPin(field)` → `plan.pinField` ("pickup" | "dropoff") → `PinPicker field`; confirming sets that place and opens the quote when the other one is set.
- **Either person finishes the ride** (no cancellations). There are NO star ratings and NO reviews (too easy to fake; see Vouches). Ended rides come back as the
  receipt/summary screen for up to 6 h until dismissed (`riderDone` / `driverDone` in localStorage).
- **Live location**: the driver app broadcasts exact position to the rider (NIP-44, ephemeral) for the
  whole drive and public coarse presence while online and free. Geolocation needs https:// or
  localhost. **GPS quality** (`lib/gps.js`): a fix is `good` (≤ 200 m), `weak` (Wi-Fi/IP/indoors) or
  `stale` (> 60 s old). A driver can go online, and is advertised, on a `good` fix OR an APPROXIMATE one (`canBeOnline`: a fresh `weak` fix accurate to 25 km; presence is rounded to ~100 m anyway) — not on a stale, missing or vaguer one; `I've arrived` still needs `good`. Ride location
  is sent unless `stale`; the rider app warns when a pickup came from a weak fix. Browsers pause GPS when
  the tab is hidden, so the driver app holds a screen wake lock while online or driving (`useWakeLock`).
  ETAs use the OSRM road time from the map route (`onRoute`), with a straight-line guess as fallback.
- **Profiles carry photo + vehicle**: kind-0 has `picture` (small resized JPEG, ~20 KB budget in
  lib/image.js) and `vehicle:{picture,plateState,plateNumber,year,make,model}` (plate sealed).
  `relay.fetchProfile(pubkey)` pulls one user's kind-0 on demand (rider: DriverInfo; driver: RiderInfo).
- **History = fetchHistory(pubkey)**: live sync and `fetchRecent` cover only 24 h. Trip counts and past
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
- **Trip screens** (rider `OnTrip`, driver `DriveTrip`): the `Sheet` is given a `peek` line, so it starts nearly collapsed and is dragged/tapped
  open (`openKey` pops it open when the user has a step; `closeKey` = the stage tucks it away). Anything a test or a user must click
  inside it (I've arrived, Start trip, Finish ride, Safety, It matches, the code fields) is hidden (`visibility`) while collapsed. The trip headline is also
  in the peek line. `MapView navigation follow={{lat,lng,id}}` is trip mode: street-zoom camera on the vehicle, north-up by default,
  compass button = heading-up, user drag/zoom stops following and shows **Re-center**. In trip mode the Leaflet map sits in an
  oversized box turned with CSS; Leaflet's own drag is off and panning is done in MapView (its mouse maths ignores the turn); icons that
  must stay upright carry the `nr-up` class. Never animate a zoom the app starts itself: Leaflet reports an animated zoom's start
  later, so it would look like the user zoomed. Do not add `leaflet-rotate` (GPL-3 licence; it also patches Leaflet core).
- **No StrictMode** (see main.jsx): it double-mounts the map in dev and caused crashes.
  Keep every hook above a screen's early `return null`.
- **Login persistence**: with "Remember me" the key is saved encrypted with the user's password
  (NIP-49) under a per-app key (`nostrride_key` rider, `nostrride_driver_key` driver); a reload shows
  Unlock. Never store the key in clear. Logout removes it. The event cache and the NWC wallet
  connection are in memory only (cleared on reload).
- **Wallet is live, not faked**: balance/transactions come from the user's real wallet over NIP-47.
  A working NWC string is required; otherwise the UI shows an error, never fake data.
- **Tailwind (built, v3) and no third-party script**: the build scans `tailwind.config.js` `content` (apps/**/*.{html,jsx}, src/**/*.{js,jsx}) for class names, so write every class out in full: a class made from pieces (`"bg-" + color`) gets NO css
  (the old CDN hid this by watching the page). Arbitrary values (`bg-[#e6f4ec]`) work. `scripts/e2e` prints the class names on screen that the built CSS has no rule for (`h.missingStyles`; Leaflet's own markers are expected).
  The built html carries a CSP `<meta>` (`csp.mjs`, build only): scripts from the app's own files only, no inline script. Do not add a `<script src=…>` from another site, an inline script, or an `eval`. Colors: black = primary, green
  (`#05944f`) = driver "go"/confirm, amber = warnings, `#f7931a` = Lightning bolt, blue = "you".
- **Public visibility**: requests/offers are public on the relays (anyone on those relays can read
  them). That is why exact points and plates are sealed; notes, fares and approximate areas are public.

## "Going live" swap points
- Relays: already real (`nostr/relay.js`, `nostr/live.js`). To harden: scope relays/geography,
  add reconnection, fetch remote kind-0 for display names beyond the ones we pull on demand.
- Signing, maps/geocoding/routing, Lightning (NIP-47 + lud16): already real (see above). Ecash: the Cashu client is real and tested against a local mint with real maths, but NOT yet run against a public mint or on a phone; pick the production mint with `VITE_DEFAULT_MINT`.
- Native background GPS: `native/` (Capacitor) + `lib/nativeGeo.js`, written but NOT run on a device.
- Not built yet: swaps between mints, automatic cash out, push while the app is closed (needs a push server), arbiter/ruling flow, synced block list (NIP-51), in-app chat/call (Contact sheet shows the other person's Signal/Telegram/phone),
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
