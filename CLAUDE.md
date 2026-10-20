# CLAUDE.md

Guidance for AI coding agents working in this repo. Read this first; it
should let you make correct edits without reading every file.

## What this is
NostrRide **Rider app** — one half of a decentralized ridesharing system. The rider and driver
apps are **separate repositories** that talk to each other only over **Nostr** (no server, no DB).
This repo is the **rider** app: Uber/Lyft-style: "Where to?", fare quote, find a driver, watch the car arrive, start with a 4-digit code (the driver shows it, the rider types it), pay the driver in ecash as the ride runs, finish the ride, rate.
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
`rideRequests`, `publish`, `pullRecent`, notices, `currency`/`prices`/`btcPrice`/`usdPrice`/`priceFor`, `ecash` (the Cashu wallet; loaded on demand, `null` while the device has none), `ecashOff` (this device has no wallet), `createEcash`, `restoreEcash`, `disconnectEcash`, `liveTick`.
Role state: `src/rider/state/RiderContext.jsx` (`useRider()`) and
`src/driver/state/DriverContext.jsx` (`useDriver()`) — mounted only after login, keyed by pubkey.
No router: each `App.jsx` maps `view` → screen; the tab bar hides during a trip.
Each screen is wrapped in an `ErrorBoundary`.

## Ride lifecycle (how the two apps connect)
| Step | Rider app | Event (kind) | Driver app |
|---|---|---|---|
| 0 | sees cars nearby | PRESENCE 30090 (public, coarse) | **GO** online (needs GPS + `isDriveReady`) |
| 1 | picks route, sees the suggested fare (each driver's own rates), taps **Request** | RIDE_REQUEST 30078 `status:requested`, `fareMode:"standard"`, `fareSats` (the estimate), `suggestedSats` | incoming card (45 s countdown) + price tags on map |
| 2 | "Finding your driver…" | — | **Accept** (sends the offer) or Decline. There is no flat price and no counter-offer |
| 3 | list of replies with each driver's rates + mint (preferred gender first if asked, then fastest) | RIDE_OFFER 30079 (`mode` metered, `priceSats` = the driver's estimate, frozen `rates`, `mint`, trip miles/minutes, ETA, `gender`, sealed plate; good 5 min) | "Waiting for rider…" |
| 4 | **Choose** → confirm (needs ecash at the driver's mint for the start; NO deposit) | RIDE_ACCEPT 30080 (names the offer; exact trip sealed to driver) + RIDE_REQUEST `in_progress`+`driverPubkey` | drive starts: route to pickup. Nothing is charged yet |
| 5 | car moves live, "arriving in N min" | RIDE_LOCATION 21100 every 6 s (NIP-44 to rider) | **I've arrived** works only within 150 m (good fix) → RIDE_STAGE 30085 `arrived` (+`distM`) |
| 6 | "Your driver has arrived", checks the car by eye (no button), types the 4-digit start code shown on the driver's phone (RIDE_CONFIRM `code`) | shows the start code; the driver types nothing | **Start trip** (after the rider's code) → RIDE_STAGE `riding` (+`codes`) |
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
    settings.js                   # tunables: FARE_RATES (USD, no minimum: base 1.50, 1.10/mi, 0.20/min), FALLBACK_BTC_USD, LOW_BALANCE_USD (5),
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
    ecashRecovery.js              # makeRecovery({box,newAdapter}): the phrase for this device, the mint adapters made with its seed, confirmBackup, rotateAll, disconnect; no Cashu import
    vouchSync.js                  # syncVouches(me): my vouch list, my vouches' lists, their names (3 small relay queries; login + every 5 min + after a change)
    share.js                      # "Share my trip": throwaway-key link, encrypted trip updates (kind 30091)
    ecash.js                      # EcashWallet: Cashu bookkeeping over a "mint adapter" (fund, pay, redeem, cash out, pending/recovery, encrypted save) — no network code, no Cashu import
    cashuMint.js                  # the REAL mint adapter on @cashu/cashu-ts (+ restore(), seed/counters) + userWallet(user) + restoreWallet(user, words, mints) (Restore my wallet) — the ONLY file that imports the Cashu library; loaded on demand (own chunk)
    reachable.js                  # probeRelay(url): a throwaway WebSocket test; never touches the pool's own connections
    link.js                       # remembers when OUR relays were unreachable (never counted as the other person's silence)
    demoData.js                   # dev-only fake riders/requests (driver app only)
  lib/
    rides.js      # trust rules: rideVersions/rideStatus (requested→in_progress→completed|closed)/rideEnding (earliest finish; silence cut-off clamped)/rideStage/rideTimes/rideConfirm/rideDriver/rideKey/tripCounts (plain counts, no stars)
    ticks.js      # PURE tick maths: unitSats, newLedger/advanceLedger (base, mile, minute), missedTicks, settle (final tick), milesAt
    ridemoney.js  # currentLedger(request,…): the saved ledger of a ride, advanced or settled; ledgerSummary; milesAtTime
    payments.js   # tick/reply/waiver/alive event builders and readers (ticksOf, tickReplies, paidSats, sentSats, waiversOf, signalTimes, outstandingSats)
    terms.js      # rideTerms(request): the CHOSEN offer's frozen rates/mode/price → ticks; rideMint; agreedOffer
    finish.js     # finish reasons, SILENCE_FINISH_MS, bothQuiet/quietMs/finishCutoff, waiverSplit, readFinish
    startcode.js  # the ONE 4-digit start code (HMAC of the NIP-44 conversation key; shown on the driver's phone, typed by the rider), wrong-try lock
    arrival.js    # canMarkArrived (≤ 150 m, good fix), arrivalMismatch (rider's check, 300 m)
    stops.js      # extra stop / new destination: stopChanges, stopTrip/fullTrip, hasAcceptedStop, nextStop; STOP_NOTE_*
    currency.js   # CURRENCIES, get/setCurrency, formatFiat, toMinor, satsFromFiat/fiatFromSats (pure maths)
    mints.js      # cleanMintUrl/isMintUrl/mintLabel
    trips.js      # derive current state: activeRideFor, activeDriveFor, offersForRide, rankOffers/offerGender, offerFrom, pendingOfferFor, acceptFor, upcomingRidesFor, isScheduledLater
    odometer.js   # stepOdo/newOdo: miles of a GPS track (skips wobble, bad fixes, glitches) (pure)
    meter.js      # referenceMiles (driver's distance unless the rider's differs >5%), meterView, fmt* incl. fmtDurationSec (pure)
    pickup.js     # pickupChange(request): pending|accepted|declined; PICKUP_CHANGE_NOTE (the exact place logic is in privacy.js)
    fare.js       # quoteFare/fareAmount/usdToSats/pickupEta + normalizeRates (incl. currency)/typicalFare/typicalSats/median/satsFromUsd/usdFromSats/lowBalanceSats/isLowBalance/fareChangeSats (pure)
    autocashout.js # "Automatically cash out at": the saved choice ({amount, code} per account), autoThresholdSats, autoCashOutDue (pure rules)
    earnings.js   # completedDrives (paid ticks + tips), summarizeEarnings
    privacy.js    # publicPlace, seal/unseal, exactTrip, sealVehicle/myVehicle/offerPlate
    contact.js    # contactHref (safe links from untrusted handles)
    evidence.js   # tip records (30086) + proofLevel + driver-side verifyPayment + disputeRecord (ticks, replies, waivers, finishes); rideConfirm is in rides.js
    bolt11.js     # paymentHash / preimageMatches
    blocks.js     # local block list helpers
    useFareEstimate.js # estimates during a ride: changeRoutes (pure), useChangeEstimate (a new stop / destination: the fare change), useTotalEstimate (the whole ride, re-priced after an accepted change); routes via OSRM (routing.js)
    appearance.js # light/dark look, TWO switches: isDark/setDark (the application, `nostrride_dark`) and isDarkMap/setDarkMap (the map only, `nostrride_darkMap`), saved AT ONCE; applyAppearance (the `dark` and `dark-map` classes on <html> + <meta theme-color>), useDark/useDarkMap
    profilecontent.js # profileContent(base, next, patch): what a kind-0 save writes: ONLY the fields the patch changes, the rest from the newest profile (shared with the other app)
    backup.js     # the encrypted settings note (kind 30111, always on; state/useBackup.js sends it)
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
    FareEstimate.jsx # the ESTIMATE look (dashed outline, ≈, muted italic): EstimatedTotal (fare card, both apps), ChangeEstimate (a proposed stop / destination)
    Button.jsx Icon.jsx Avatar.jsx Money.jsx Parts.jsx (Row, Toggle, Field, ConfirmDialog, Modal, Spinner)
    Fold.jsx      # a section that opens and closes (Account); openFold(id); FoldTitle/SectionLabel draw nothing inside a Fold (the header has the title)
    AmountInput.jsx (local currency or sats, unit swap; tips, funds, waivers)  PasswordField.jsx (password input with a show/hide eye)  TripMeter.jsx (time + distance card, peekMeter)  VouchBadge.jsx ContactSheet.jsx UserModal.jsx NoticeBanner.jsx ErrorBoundary.jsx RelayEditor.jsx QRCode.jsx SatsAmount.jsx
  features/
    auth/        AuthScreen (role-aware copy) + AuthSteps (unlock, key backup)
    profile/     ProfileParts (useSaveProfile, AccountHeader, ContactMethods, RelaysSection, LogoutButton),
                 WalletsSection (Account → Wallets: Currency, then the ecash wallet with the cash out location inside), AppearanceSection (Dark Mode (application) and Dark Mode (map)), VehicleSection (up to 3 photos), VouchesSection ("Your vouches": npub in, list out), TypicalFareSection ("Your rates", locked during a ride), CurrencySection, LightningAddressSection, WalletSection, KeysSection
    ecash/       EcashSection (balance, Send, mint, paste a token, back up, driver cash out + Automatically cash out), SendEcash (token or Lightning), AutoCashOutField, useAutoCashOut, WalletStart (no wallet yet: Create New Wallet / Restore my wallet, and the WalletPrompt notice), RestoreWallet (the 12 words in, the wallet back), RecoverySection (RecoveryFold + RecoveryNotice: write down 12 words, show again, I-lost-a-phone), myMint.js
    payments/    PayDriver (a Lightning address: tips), AddFunds (Lightning tab: a mint invoice → ecash, paid from any wallet; On-chain tab: OnchainFunds, a bitcoin address from the mint), rideTicks.js (rider: payDue), redeemTicks.js (driver: redeem + reply),
                 redeemWaivers.js (rider: collect refunds), useRideLink.js (quiet phone, sign of life, 10-minute silence)
  rider/
    App.jsx  state/RiderContext.jsx
    screens/ HomeScreen (dispatch) PlanTrip (idle/search/pin/quote) ActiveTrip (searching/choose/confirm driver)
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
| 30078 | RIDE_REQUEST | `d`(id), `t`, `p`(driver, once confirmed) | `{pickup, dropoff, time, notes, status, hide?, fareMode, fareSats, suggestedSats, distanceMiles, durationMin, sealed}` — `hide` = hide tokens of the drivers the rider blocked (lib/blocks.js); pickup/dropoff are COARSE; `sealed` = exact trip, NIP-44 to the rider. `fareMode` is always `"standard"` (each driver's rates; `fareSats` is only an estimate); an older app's `"flat"` (the rider's own price) and a missing value are both read as standard; `suggestedSats` is what the app suggested. `status` ∈ `requested \| in_progress \| closed` (old: `cancelled`) |
| 30079 | RIDE_OFFER | `e`(request), `p`(rider), `d`, `t` | `{priceSats, mode, rates, mint, tripMiles, tripMinutes, etaMinutes, message, typicalSats, gender, plate}` — the driver's reply. `mode:"metered"`: the driver's standard fare (`priceSats` = their estimate); an older app's `"flat"` is read as metered. `rates` = `{base, perMile, perMinute, currency}` (a frozen copy) and `mint` = where the driver is paid; `gender` optional, self-declared; `plate` NIP-44 to the rider. No deposit |
| 30080 | RIDE_ACCEPT | `e`(offer), `e`(request), `p`(driver), `d`, `t` | `{offerId, requestId, sealed}` — `offerId` names the offer whose rates and mint are FROZEN for the ride; `sealed` = exact trip, NIP-44 to the driver |
| 30081 | RIDE_FINISH | `e`(request), `p`, `d`="finish-<id>", `t` | `{requestId, reason: rider\|driver\|destination\|unpaid\|silence, role, at, miles?, minutes?, atDestination?}` — by the rider or the assigned driver; ends the ride (NO cancellations, NO fees). `at`/`miles` = the moment and meter the charge runs to |
| 30082 | RATING | | UNUSED: star ratings and reviews were removed (too easy to fake). Old events are ignored. See 30102 |
| 30083 | DRIVER_ROUTE | | unused (feature removed) |
| 30084 | RIDE_COMPLETE | `e`(request), `p`(rider), `d`, `t` | `{requestId}` — by the assigned driver. Older apps only; read as "finished at the destination" |
| 30085 | RIDE_STAGE | `e`(request), `p`(rider), `d`="stage-<rideKey>", `t` | `{stage: "arrived" \| "riding", at, arrivedAt?, distM?, codes?}` — by the assigned driver; `at` = ms now, the "riding" marker recalls `arrivedAt` (a relay keeps only the newest marker); `distM` = the driver's measured metres from the pickup (≤ 150); `codes` = the start code was checked (the field keeps its old name) |
| 30086 | RIDE_PAYMENT | `e`(request), `p`(driver), `d`="pay-<rideKey>-<phase>" (`-tip-<ms>` for a tip), `t` | `{phase:"tip" (old rides: "deposit"\|"rest"), amountSats, level, sealed}` — by the rider; `sealed` = `{pr, preimage, verify}` NIP-44 to the driver. Tips only |
| 30087 | RIDE_CONFIRM | `e`(request), `p`(driver), `d`="confirm-<rideKey>-<phase>", `t` | `{phase:"boarded"\|"code"\|"ended"\|"problem", ok, note}` — by the rider (`code` = typed the 4-digit start code shown on the driver's phone; `boarded` = older rider apps only: the current rider app has no "It matches" button, the driver app still reads it) |
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
  furthest valid marker wins; `riding` also needs the rider's start-code confirmation, see Security rules). Always go through `rideVersions`/`rideStatus`/`rideEnding`/
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
  importing an nsec keeps the existing profile. The Rider and Driver apps share the same profile, and one of them may hold an OLD copy of it: `profileContent(base, next, patch)` writes only the fields of the patch
  (name, picture, comm, vehicle, lud16, gender, rates, stats) and takes every other field from the newest profile in hand, so a save never writes an old cash out location, vehicle, rate or gender over the other app's. The cash out location (`lud16`)
  is refreshed from the relays at login, every 5 minutes and when the app returns to the front (AppContext).
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
  and uncovered) ≥ 2 lets the driver finish. The rider may refill and pay what is missed, also after the ride. There is NO flat price and NO counter-offer (removed: `offerLimitsSats`, `replyKind`, `raiseOffer`, `convertToMetered`, `MIN_OFFER_USD`; do not add them back): an
  old offer that says `flat` is read as the standard fare, and an accepted extra stop just keeps the meter running. The driver may waive (30097): unpaid forgiven first, the rest
  sent back as an ecash token sealed to the rider (`redeemWaivers.js`; `ecash.payUpTo` sends the most the balance allows, because spending proofs costs the mint's input fee, and the waiver records the sats really sent; the modal caps the amount at what the driver still holds at the ride's mint). Never invoice the rider's own wallet. Only `confirmDriver` publishes RIDE_ACCEPT + `in_progress`.
- **Ecash wallet** (`nostr/ecash.js`): bookkeeping only, over a mint adapter; `nostr/cashuMint.js` is the ONLY file that imports `@cashu/cashu-ts` (loaded on demand by `AppContext`).
  Proofs are saved encrypted (NIP-44 to the user's own key, in pieces). Rules: one money move at a time (`_exclusive`); a token being sent sits in `pending` until its event is
  published/queued (`settle`) or is returned (`unreserve`/`recoverPending`); a token is redeemed once (fingerprint); the sender adds the mint's input fee (`includeFees`) so the receiver
  gets the full tick; `EcashError.definitive` separates a mint's "no" from an unreachable mint. Never log proofs or tokens. Test against `test/helpers/localmint.mjs` (real maths).
- **On-chain funding** (`EcashWallet.onchainStart/claimOnchain/onchainList`, adapter `onchainSupported/quoteOnchain/onchainState/mintOnchain/onchainPubkey`, `features/payments/OnchainFunds.jsx`): Cashu NUT-30 (experimental in cashu-ts 4.11.0). The mint gives a bitcoin address for a quote locked (NUT-20) to a key made from the recovery SEED and the quote's number (`onchainKey`, its own HKDF label), so the 12 words can always claim a deposit. `onchainStart` asks `onchainSupported` FIRST and throws `EcashError("onchain")` before any bitcoin can be sent to a mint without it; it reuses the newest unexpired address of this wallet and NEVER one whose `pubkey` this wallet's seed does not produce (`_ownsOnchain`).
  The deposit records (ids, numbers, addresses, public key: NO key, NO coin) live in `state.onchain` AND in a plain setting `onchain_<pk16>` that the encrypted backup carries (`makeStore.loadOnchain/saveOnchain`); after a restore the same phrase owns the addresses again and `claimAll` collects the deposits. `claimAll` also collects what was paid while the app was closed. Do not store a deposit key anywhere.
- **Sending ecash / auto cash out** (`features/ecash/SendEcash.jsx`, `AutoCashOutField.jsx`, `useAutoCashOut.js`, `lib/autocashout.js`): *Send* makes a token with `ecash.pay` (it waits in `pending` while the dialog is open; *Done* = `settle`, *Take it back* = `reclaim(id)`: the mint says unspent → back, spent → forgotten)
  or pays a Lightning invoice / address with `ecash.payInvoice(url, invoice)` (the shared `_meltWith` tail also serves `cashOut`). Both locked while a ride runs. "Automatically cash out at" (driver app, `useAutoCashOut` in `DriverContext`): `{amount, code}` saved per account (`autoCashOut_<pk16>`), saved on blur / Enter only (never per key),
  `autoCashOutDue` = needs `lud16`, no ride, a known price, balance at ONE mint ≥ the amount, 10 min after a failure (`AUTO_RETRY_MS`); one notice per failure streak. The cash out location is OPTIONAL (no gap in `driveGaps`).
- **Tips** still go over Lightning: the rider's `lud16` payment via `PayDriver` (from the rider's ecash with `ecash.payInvoice`, or the driver's invoice shown for any other wallet) and a RIDE_PAYMENT `tip` record. **Evidence**: tips are re-checked by the driver app
  (`verifyPayment`: only a `verify` URL on the host of the driver's own lud16 is fetched); the tick trail (30095/30096/30097/30098) is the evidence for the ride's money.
- **Finish ride (lib/finish.js)**: one `finishRide` action per app (rider: RiderContext, driver: DriverContext), always behind a `ConfirmDialog`. Before the `riding` marker nothing is
  owed (`closed`). A quiet phone is never a finish; `useRideLink` asks "still with you?" after 2 min (RIDE_ALIVE), and finishes with reason `silence` only when BOTH were silent for 10 min,
  checked once when an app starts for the ride; time our own relays were down (`nostr/link.js`) is never counted. "I've arrived" needs `canMarkArrived` (≤ 150 m, good fix). The ride starts
  with ONE 4-digit code (`lib/startcode.js`): the driver's phone shows it, the RIDER types it (rider confirm `code`), and "Start trip" unlocks on that confirmation; the driver types nothing. A GPS gap ≤ 10 min is filled with a straight line (`odometer.js maxGapMs`).
- **Local currency** (`lib/currency.js`): each person picks one in Account; `AppContext` exposes `currency`, `prices` (code → BTC price, last good ones kept 24 h), `btcPrice` (the chosen
  currency's), `usdPrice`, `priceFor(code)`. A driver's rates carry their currency (`normalizeRates` adds `currency`, default USD; limits scale with the currency). Never guess a missing price:
  show sats / wait. Use `formatFiat(x)` (never a literal "$"). The app's own rates are dollars (use `usdPrice`).
- **Ecash recovery phrase (lib/recovery.js, nostr/seedbox.js, nostr/ecashRecovery.js, features/ecash/RecoverySection.jsx)**: every coin the wallet MAKES for itself has a deterministic secret (Cashu NUT-13: seed of a 12-word BIP39 phrase + keyset + counter), so the phrase
  restores the ecash on a new device (NUT-09 `restore`). Rules: (0) a device with a wallet from before this rule is simply "on" (its saved words count as a wallet); (1) the phrase is its OWN secret, never derived from the nsec (a leaked nsec must not drain the wallet); (2) it is made when the person taps **Create New Wallet** (after a warning), before any coin, and kept ONLY encrypted under `boxKey(sk)` (its own HKDF label);
  it never goes into an event, to a relay, to a mint, into a log, an error message or a URL; (3) counters live in `wallet.state.counters` and are saved BEFORE the mint is asked (`counterSource()`); (4) coins SENT to someone else use random secrets (`send: {type:"random"}` in `cashuMint.js split`),
  so a restore never resurrects a token already handed to a driver; a restore skips proofs that are in `pending`; (5) after a restore every coin is swapped for a fresh one (`rotate`), so a copy on a lost phone is spent; (6) **Restore my wallet** (`cashuMint.restoreWallet`, `features/ecash/RestoreWallet.jsx`) is offered ONLY while the device has no wallet. The typed words BECOME the device's words (saved as already written down, `backedUp: true`: the person has them), nothing is swept into another phrase; `wallet.restore(urls)` finds the coins at each mint (NUT-09), keeps the unspent ones and swaps them for fresh coins under the SAME phrase (a copy on a lost phone is spent). If no mint knows a coin for the words (a typo that passes the check, the wrong mint, a mint that did not answer) EVERYTHING is undone (words, state, wallet): a wrong guess leaves no wallet behind. The last phone to restore holds the coins; another phone on the same words loses them (syncSpent drops them);
  (6b) `wallet.syncSpent()` (at load and every 5 min, in AppContext) drops coins the mint calls SPENT, asking the mint WITHOUT holding the money lock; (6c) `recovery.disconnect({force})` = syncSpent → recoverPending → refuse if a token is still pending or if money
  exists and the words are not written down → `rotateAll` (refuse on a failed swap unless `force`) → `wallet.wipe()` + `box.erase()`; `AppContext` keeps `ecashOff` (true while the setting `nostrride_ecashOff_<pk16>` is true, or while it is unset and the device holds no saved words and no saved coins: **nothing makes a wallet by itself**), `createEcash`, `restoreEcash`, `disconnectEcash`; while off the wallet is not loaded, a driver cannot GO and a rider
  cannot confirm a driver (`WalletPrompt` says so and opens Account → Wallets), and it is locked while a ride is running; (7) on "Blinded message is already signed" (10002) the adapter skips its counters ahead and retries once (another device used the numbers) and takes no coins; (8) `@cashu/cashu-ts` is pinned EXACTLY (no `^`) and
  `test/recovery.test.mjs` holds the NUT-13 specification vector: a library change must not alter a derived secret. The phrase counts as safe (`backedUp`) only after the person types three words back. Old random coins (`state.legacy`) are swapped under the phrase when it is confirmed.
- **Account folds (ui/Fold.jsx)**: every setting on both Account screens is a `<Fold id title>`: closed at first (a driver's vehicle starts open while still needed), open state remembered per device (`nostrride_fold_<id>`), content stays mounted while closed (typed text is kept).
  A section's own `SectionLabel`/`FoldTitle` draws nothing inside a Fold; a Fold with several parts names them with `SubTitle`. E2E scripts open a section with `openFold(page, title)` (scripts/e2e/flow.mjs). New settings go in a Fold.
  **Wallets** (`<Fold id="ecash" title="Wallets">`, `features/profile/WalletsSection.jsx`, both apps) holds, in this order: Currency, the ecash wallet (note "Add ecash here before you ride.", balance, **Add funds** and **Send** side by side, Automatically cash out (driver), then the **Cash out location**
  as an `EcashSection` child, then the mint, pasted tokens, disconnect; while the device has NO wallet the ecash part shows `WalletStart`: **Create New Wallet** (a warning dialog, then the 12 words at once) and **Restore my wallet**). There is NO Lightning wallet (NWC) any more (removed on purpose: do not add it back) and NO separate Currency, Cash out location or Backup section: do not add them back. Settings are saved to the relays by `state/useBackup.js` with no switch and no screen (`lib/backup.js` lists what goes in, `onchain_` addresses included, never a key or a coin).
- **Dark mode (lib/appearance.js, tailwind.config.js, src/index.css, public/theme-init.js, features/profile/AppearanceSection.jsx)**: Account → Appearance has TWO switches that save and apply AT ONCE (no Save button): **Dark Mode (application)** (`nostrride_dark`, the `dark` class on `<html>`, the phone's bar color) and **Dark Mode (map)** (`nostrride_darkMap`, the `dark-map` class). The application switch NEVER touches the map and the map switch never touches the screens; the Leaflet tile filter, the map's background and its credit line hang on `.dark-map`, not on `.dark`.
  The Tailwind colors `white`, `black`, `neutral-*` and the tints of
  red / amber / green / blue are CSS variables (`:root` = light, `.dark` = dark; channels as `r g b`, so `bg-black/50` still works), so ordinary classes follow the look with no `dark:` variant. In the dark look `white` and `black` TRADE PLACES (a `bg-black text-white` button becomes a light button with dark text; `bg-white` is the
  dark surface). A color that must NOT change is written FIXED: white text on a colored button `text-[#fff]`, a dialog or photo backdrop `bg-[#000]/50`, a red or green dot `bg-[#dc2626]`, the plate `bg-[#fff] text-[#000]`. Never write `text-white` on a green/red/amber background, and never `bg-black/NN` for a backdrop. The arbitrary greens
  (`text-[#05944f]`, `text-[#05683a]`, `bg-[#e6f4ec]`) are re-mapped in index.css. Pins, route and price tags keep their colors. Check a new screen in both looks (`DARK=1`-style script: set `localStorage.nostrride_dark="true"` before load). The switches have no description text.
- **Password fields**: use `ui/PasswordField.jsx` (an input with a show/hide eye, hidden at first), never a bare `type="password"` input (the Unlock page and the Remember-me password both use it).
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
- **Fares** (`lib/fare.js`): one fare, each driver's own rates (`fareMode:"standard"`; the request's `fareSats` is only an estimate). The rider names no price and a driver does not counter (the flat price was removed on purpose: do not add it back).
  `acceptRequest(request)` sends an offer with `mode:"metered"`. The confirm screen's "Needed to start" is `startParts` in `ActiveTrip.jsx`: base + 2 minutes + 1 mile (a cushion so the first payments are never late; it explains itself on screen).
- **Driver rates**: each driver may set `rates` {base, perMile, perMinute, currency} (kind 0 and public presence; `normalizeRates` rejects junk; limits `RATE_LIMITS`, scaled per currency). The fare is
  base + per mile × miles + per minute × minutes (`fareAmount`), **no minimum fare**; no rates → `APP_RATES`. The rider's quote suggests the MEDIAN of nearby drivers' fares IN SATS (`typicalSats`)
  (the app's formula if no driver is near); each offer carries `typicalSats`. The rates in an offer are FROZEN once the rider chooses it, and the Account screen locks the rates during a ride.
  Use the trip as the request publishes it (miles to a tenth) on both sides or the cents differ. Round money to whole cents before showing it.
- **Gender preference**: drivers MAY set `gender` ("male" | "female") in kind 0 (copied into offers); anything else is ignored.
  A rider's preference (`getSetting("genderPref")`, local only) only reorders the offers via `rankOffers`; never filter or hide a driver by it.
- **Drive gating**: `isDriveReady(user)` = `driveGaps(user)` is empty (lib/profile.js): face photo + vehicle year/make/model +
  at least one vehicle photo (up to 3 can be added) + plate state/number (no driver's license photo). The cash out location (a Lightning address) and gender are optional. Until then the
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
- **Pickup is never automatic**: `PlaceSearch` does NOT fill the pickup from GPS; the rider types an address or a business name, pins the spot (`PinPicker`), or taps "Your location" (a deliberate tap). `PlanTrip` never passes `here` as a pickup. It shows a *Done* button when both places are set.
  **The search page shows nothing but the two boxes (and Back / Cancel) until a box is ACTIVE** (has the cursor; `focus` state, cleared 150 ms after a blur; the panel and "Your location" swallow `mousedown` so a tap never takes the cursor away). For the active box only: first its map button ("Set pickup on the map" / "Set drop-off on the map"),
  then, below it, that box's 3 most recent places (`recents.pickup` / `recents.dropoff` = `recentPlaces(field, 3)` from the rider's own earlier requests) or, once the rider types 3+ characters, the search results; then the business-name hint (pickup) and *Done*. `PlaceSearch onPin(field)` → `plan.pinField` ("pickup" | "dropoff") → `PinPicker field`; confirming sets that place and opens the quote when the other one is set.
  E2E: click the box first (`pinPickup` does), then the button.
- **Either person finishes the ride** (no cancellations). There are NO star ratings and NO reviews (too easy to fake; see Vouches). Ended rides come back as the
  receipt/summary screen for up to 6 h until dismissed (`riderDone` / `driverDone` in localStorage).
- **Live location**: the driver app broadcasts exact position to the rider (NIP-44, ephemeral) for the
  whole drive and public coarse presence while online and free. Geolocation needs https:// or
  localhost. **GPS quality** (`lib/gps.js`): a fix is `good` (≤ 200 m), `weak` (Wi-Fi/IP/indoors) or
  `stale` (> 60 s old). A driver can go online, and is advertised, on a `good` fix OR an APPROXIMATE one (`canBeOnline`: a fresh `weak` fix accurate to 25 km; presence is rounded to ~100 m anyway) — not on a stale, missing or vaguer one; `I've arrived` still needs `good`. Ride location
  is sent unless `stale`; the rider app warns when a pickup came from a weak fix. Browsers pause GPS when
  the tab is hidden, so the driver app holds a screen wake lock while online or driving (`useWakeLock`). The RIDER app holds one too while a ride is `in_progress` (`RiderContext`): a sleeping page stops the 3 s
  payment loop, so no tick is paid and the driver sees "missed payments" with a full wallet. `useWakeLock` returns true when the lock is unavailable (no browser support, refused, released) and `OnTrip` then tells the rider to keep the app open; the loop also runs
  at once on `visibilitychange` and `online`. A page that is hidden (another app, a locked phone without the lock) still pays nothing until it wakes.
  ETAs use the OSRM road time from the map route (`onRoute`), with a straight-line guess as fallback.
- **Profiles carry photo + vehicle**: kind-0 has `picture` (small resized JPEG, ~20 KB budget in
  lib/image.js) and `vehicle:{picture,morePictures?,plateState,plateNumber,year,make,model}` (plate sealed). A vehicle has 1 to 3 photos: `picture` is the main one (older apps read only it; `driveGaps` needs it) and `morePictures` holds up to 2 more (`vehiclePhotos(v)` lists them).
  With more than one photo each is kept to ~12 KB (`PHOTO_BYTES` in VehicleSection) so the whole kind-0 stays under the 64 KB many relays allow; `getProfile` accepts only embedded `data:image/` extras.
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
  inside it (I've arrived, Start trip, Finish ride, Safety, the code fields) is hidden (`visibility`) while collapsed. The trip headline is also
  in the peek line. `MapView navigation follow={{lat,lng,id}}` is trip mode: street-zoom camera on the vehicle, north-up by default,
  compass button = heading-up, user drag/zoom stops following and shows **Re-center**. In trip mode the Leaflet map sits in an
  oversized box turned with CSS; Leaflet's own drag is off and panning is done in MapView (its mouse maths ignores the turn); icons that
  must stay upright carry the `nr-up` class. Never animate a zoom the app starts itself: Leaflet reports an animated zoom's start
  later, so it would look like the user zoomed. Do not add `leaflet-rotate` (GPL-3 licence; it also patches Leaflet core).
- **The trip card (fare card, both apps)**: top to bottom, rider: `Your ecash` (live wallet balance at the ride's mint, `ecash.balance(payMint)`; the wallet notifies `AppContext`, which re-renders; RED at `LOW_BALANCE_USD` (5 US dollars at `usdPrice`) or less, `isLowBalance`), `Fare so far`, `Paid`, the ESTIMATED total (`ui/FareEstimate.jsx`), then the `Paid so far` lines.
  Driver: `Fare so far`, `Paid by the rider`, the estimated total, the lines. **Estimates use one look: a dashed outline, "≈" in front, muted italic text; exact numbers never do.** The estimated total is the driver's offer estimate until a stop / new destination is accepted, then the whole route
  (pickup → stops → destination) priced at the driver's FROZEN rates (`useTotalEstimate`), with a muted "from the added stop ≈ +$…" line. Before the ride starts the estimate stays at the bottom of the sheet next to the route; while riding it is only in the card. The rider's link is **Add stop / update fare** (modal `AddStop`): after a place is picked, `ChangeEstimate` shows the
  estimated change in the fare (route from the car through the places ahead vs the same with the new place: `fareChangeSats` = per mile × Δmiles + per minute × Δminutes; negative for a shorter way; nothing at all when a route or a price is missing, never a made-up number). The driver's pending-stop card and the rider's pending note show it too.
  "Trip so far" counts seconds (`fmtDurationSec`); the rider's `OnTrip` re-renders every second for it.
- **Paid so far lines**: the fare cards show `Paid so far:` / `Base rate: $` / `Miles: # ($)` / `Minutes: # ($)` (`ui/FareBreakdown.jsx`, from `lib/ticks.js paidBreakdown(ledger, paidSats)`: what the driver confirmed covers the ticks in time order; a tick counts once covered, with missedTicks' slack). Rider `OnTrip` + `Receipt`, driver `DriveTrip` + `DriveSummary`.
- **Phone screens** (ui/Layout.jsx, index.css, `scripts/e2e` with `E2E_VIEWPORT=360x640`): the app frame is `.nr-frame` (`100dvh`, `100%` where dvh is unknown) with the side safe-area insets; the viewport meta has `interactive-widget=resizes-content` (the keyboard shrinks the page, so a field in a sheet stays visible);
  on touch screens (`pointer: coarse`) every field is at least 16px (iOS zooms the page on a smaller one); the desktop look is unchanged (`max-w-md` column). The main button(s) of a sheet go in `<StickyActions>` (Request ride, Accept, Confirm driver, I've arrived / Start trip / Finish ride): they stay at the bottom of the
  sheet's scroll area so a short phone never has them below the fold (they scroll normally on a phone held sideways, `max-height: 480px`). Put what a person needs FIRST (the driver's start code) above the sticky bar's reach, at the top of the sheet. `Button` is `w-full` by default: next to an input in one flex row it squeezes the input (the 4-digit start code once showed two digits), so stack them or pass `full={false}`. Flex rows that hold an input need `min-w-0` on the flex child (the search fields once ran off a 360 px screen);
  below 380 px wide use `max-[380px]:` to drop icons or labels (`sr-only`, so the accessible name stays). At most two notices show at once (`NoticeBanner`). The map's credit line sits just above the sheet (`--nr-sheet`, set by `MapPage`). Check a new screen at 320×568 and 360×640.
- **No StrictMode** (see main.jsx): it double-mounts the map in dev and caused crashes.
  Keep every hook above a screen's early `return null`.
- **Login persistence**: with "Remember me" the key is saved encrypted with the user's password
  (NIP-49) under a per-app key (`nostrride_key` rider, `nostrride_driver_key` driver); a reload shows
  Unlock. Never store the key in clear. Logout removes it. The event cache
  is in memory only (cleared on reload).
- **Wallet is live, not faked**: the balance is what the Cashu wallet on this device holds at the mints; nothing is shown that the mint did not confirm. With no wallet the UI says so (`WalletStart`), never fake data.
- **Tailwind (built, v3) and no third-party script**: the build scans `tailwind.config.js` `content` (apps/**/*.{html,jsx}, src/**/*.{js,jsx}) for class names, so write every class out in full: a class made from pieces (`"bg-" + color`) gets NO css
  (the old CDN hid this by watching the page). Arbitrary values (`bg-[#e6f4ec]`) work. `scripts/e2e` prints the class names on screen that the built CSS has no rule for (`h.missingStyles`; Leaflet's own markers are expected).
  The built html carries a CSP `<meta>` (`csp.mjs`, build only): scripts from the app's own files only, no inline script. Do not add a `<script src=…>` from another site, an inline script, or an `eval`. Colors: black = primary, green
  (`#05944f`) = driver "go"/confirm, amber = warnings, `#f7931a` = Lightning bolt, blue = "you".
- **Public visibility**: requests/offers are public on the relays (anyone on those relays can read
  them). That is why exact points and plates are sealed; notes, fares and approximate areas are public.

## Sealed jobs
- **Every job event is sent only inside a gift wrap** (`nostr/sealing.js`: kind 1059, throwaway signer, NIP-44 of the signed inner event to ONE recipient). `SEALED_KINDS` lists them (the ride kinds 30078–30101). Presence, kind 0, vouches, trip share, settings backup and the 21100/21101 pings keep their shape.
- `relay.publish(event, {to})` wraps for: the author, every `p` tag, and `to`. `relay._ingest` opens a wrap with `relay.setIdentity(sk, pk)` (AppContext, at login), checks the inner signature and kind, and stores the INNER event, so `lib/rides.js` is unchanged. Raw (old) job events are still read. The outbox stores wraps with their inner event; `outboxAge(id)` accepts an inner id.
- **Audience** (`lib/audience.js`, `lib/audienceStore.js`, `state/AudienceSync.jsx`): a new request goes to the online drivers near the pickup, nearest 60. `AudienceSync` subscribes to presence and sends waiting requests to people who appear later (`relay.sealTo`). Later versions of a request go to the audience + every driver who sent an offer.
- Other people's job history is not readable any more: the profile carries self-reported `stats.miles` (`lib/mileage.js`, `features/profile/MilesSync.jsx`).
- Test relays must keep kind 1059 and answer `#p` filters. Tests: `test/sealing.test.mjs`.

## Security rules (from an audit; do not weaken)
Everything the OTHER person's app sends is a claim. The apps pay by themselves, so a claim must never move money or start a ride on its own.
- **A drive needs consent** (`lib/trips.js consentedDrive`): `activeDriveFor` (and the driver's receipt list) count a request only if the driver sent an offer for it AND the rider's accept names them. A request that merely names a driver (anyone can sign one) must not put the driver on a ride: that made the driver's app send live GPS to a stranger.
- **Only the rider starts the ride** (`lib/rides.js riderStarted`): the driver's `riding` marker counts (`rideStage`, `rideTimes.startedAt`) only after the RIDER's own signed `code` confirmation. Before that nothing is billed and a finish is `closed`.
- **"Refused" is not trusted** (`features/payments/recoverRefused.js`, `lib/payments.js tickVerdict/sentSats`): a tick the driver answered `ok:false` still counts as sent until the rider's app took its own token back from the mint (`ecash.redeem` of the rider's own sealed token succeeds = unspent = unpaid; a definitive mint "no" = spent = paid, whatever the driver said; unreachable = undecided, still sent). The rider pays a tick once.
- **Distances from the other person are bounded** (`lib/meter.js boundedMiles`, `lib/ridemoney.js currentLedger`, `rider/state/useRiderMeter.js`): the miles in a finish event are held to this phone's own measure (live meter, else the saved ledger's last sample plus what a car could drive since); with no measure at all, to the clock (70 mph average) and twice the quoted route + 3 mi. Live miles are held to the clock too.
- **Spending cap per ride** (`lib/spendcap.js`, `payDue({capSats})`, status `capped`): 3 × the quoted fare, at least 10 USD of sats, fixed when first needed; at the cap the app stops and shows "Allow more" (OnTrip, Receipt).
- **Price feed** (`lib/currency.js acceptPrices`): a price more than 30% from the last good one is a suspect and is taken only on the 3rd fetch in a row.
- **Frozen terms** (`lib/terms.js agreedOffer`): the offer the rider's accept names, nothing else. If it is not in hand, nothing is agreed (no fallback to the driver's newest offer, which a driver can replace).
- **Prices shown come from the rates** (`lib/fare.js offerEstimate`): never the offer's own `priceSats` (a driver's claim).
- **Mints** (`features/ecash/myMint.js isKnownMint/trustMint`): a mint a driver names that the rider never used needs an explicit "I trust this mint" before Add funds. Waiver refunds are redeemed only at the ride's mint (`redeemWaivers.js`).
- **Audience** (`lib/audience.js`): vouched people first, then the nearest, then random draws; at most `AUDIENCE_LIMIT` per request in all (`AudienceSync` fills only the places left). Presence time is held to ±60 s of the event (`live.js presenceTs`).
- **Hide tokens** (`lib/blocks.js`): an HMAC with the NIP-44 conversation key the two people share, so a stranger cannot test who blocked whom. They take a SECRET KEY (`hideList(sk, …)`, `hidesMe(hide, ownerPubkey, mySk)`, `subscribePresence({viewerSk})`).
- **Gift-wrap flood** (`nostr/relay.js _ingestWrap`): wraps not addressed to us are ignored; at most `wrapLimits.budget` are opened per window, the rest wait in a bounded queue; the seen-set is bounded.

## "Going live" swap points
- Relays: already real (`nostr/relay.js`, `nostr/live.js`). To harden: scope relays/geography,
  add reconnection, fetch remote kind-0 for display names beyond the ones we pull on demand.
- Signing, maps/geocoding/routing, Lightning (lud16 invoices, paid from ecash or any wallet): already real (see above). Ecash: the Cashu client is real and tested against a local mint with real maths, but NOT yet run against a public mint or on a phone; pick the production mint with `VITE_DEFAULT_MINT`.
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
