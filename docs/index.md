# NostrRide Rider app documentation

> **Generated repository.** This is a copy of the rider app made from **trevthom/nostr-ride** by `scripts/export-apps.mjs`. Make changes in nostr-ride and export again: a hand edit here is overwritten by the next export.

> This repository is the **rider** app. The **driver** app is in its own repository, **nostr-ride-driver**. They share no server: they find each other through Nostr relays, so both use the same event formats (see [Nostr events](#nostr-events)).

Last updated with: **trip evidence, safety tools, blocking, reliability, native background GPS** (see the [changelog](#changelog)).

NostrRide is a decentralized ridesharing system. It is **two web apps** — a rider app and a driver
app — that find each other through **Nostr relays**. There is no company server and no database.
Payments go straight from rider to driver over **Lightning**.

> This page is kept up to date with every change. If you change behavior, update the matching
> section and add a line to the [changelog](#changelog) in the same commit.

## Contents
1. [Quick start](#quick-start)
2. [The two apps](#the-two-apps)
3. [How a ride works](#how-a-ride-works)
4. [During a trip (both apps)](#during-a-trip-both-apps)
5. [Typical fares (each driver sets their own)](#typical-fares-each-driver-sets-their-own)
6. [Price offers and counter-offers](#price-offers-and-counter-offers)
7. [Tips (optional, any time after the ride)](#tips-optional-any-time-after-the-ride)
8. [Changing the pickup while the driver is on the way](#changing-the-pickup-while-the-driver-is-on-the-way)
9. [Trip time and distance (the meter)](#trip-time-and-distance-the-meter)
10. [Driver gender preference (optional)](#driver-gender-preference-optional)
11. [Driver requirements](#driver-requirements)
12. [Architecture](#architecture)
13. [Nostr events](#nostr-events)
14. [Privacy](#privacy)
15. [Payments](#payments)
16. [Location and GPS](#location-and-gps)
17. [Safety](#safety)
18. [Blocking](#blocking)
19. [Disputes and evidence](#disputes-and-evidence)
20. [Reliability](#reliability)
21. [Native app and background GPS](#native-app-and-background-gps)
22. [Configuration](#configuration)
23. [Testing](#testing)
24. [Deploying](#deploying)
25. [Separate repositories (generated)](#separate-repositories-generated)
26. [Self-hosting map services](#self-hosting-map-services)
27. [Trying it on an iPhone](#trying-it-on-an-iphone-without-the-apple-developer-program)
28. [Known limits and roadmap](#known-limits-and-roadmap)
29. [Changelog](#changelog)

## Quick start
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # automated checks
npm run build      # dist/
```
To play a whole ride, also run the **driver** app from its repository (port 5174) and sign in with a different account in each.
Needs internet for Tailwind (CDN), fonts, the map, and the relays. Location needs `https://` or `localhost`.

## The two apps
| | Rider app (repo nostr-ride-rider) | Driver app (repo nostr-ride-driver) |
|---|---|---|
| Tabs | Ride · Activity · Account | Drive · Earnings · Account |
| Home | "Where to?" → your price offer → request | GO button → request cards (accept or counter) |
| During a trip | Live car, ETA, contact, cancel | Route, arrived / start / complete |
| After a trip | Receipt, pay the rest, rate | Summary, rate the rider |
| Needs | Nothing (a wallet is optional) | Face photo, vehicle and vehicle photo, plate, driver's license photo, Lightning address |

Both apps share one code base for Nostr, maps, payments, profiles and UI (`src/nostr`, `src/lib`,
`src/ui`, `src/features`, `src/state`). The rider app must never import from `src/driver`, and the
reverse. The Vite *mode* picks the app (`vite --mode rider|driver`).

## How a ride works
1. The driver taps **GO** (needs a good GPS fix). The app shares an approximate location.
2. The rider enters a destination. The pickup fills in from GPS. The app **suggests a price**; the rider sets an **offer** and taps **Request**.
3. Nearby drivers get a **request card** with a countdown. A driver **accepts the offer** or **counters** with a higher price.
4. The rider **chooses a driver** (any reply, at that driver's price) and pays the **deposit** (default 20% of that price). This starts the drive.
5. The driver drives to the pickup. The rider sees the car move live (end-to-end encrypted).
6. The driver taps **I've arrived**, **Start trip**, **Complete trip**.
7. The rider pays the **rest of the fare** and both sides rate each other.

Cancels: the rider can cancel any time; the driver can cancel an accepted ride. A reservation more
than 30 minutes ahead waits under *Activity → Upcoming*. Everything on screen is **derived from the
signed events**, so a reload or a second device shows the same screen.

## During a trip (both apps)
- **Nearly full-screen map.** Once a driver is confirmed, the trip card is tucked away: only a handle and one line
  (for example "Driver arriving in 5 min") show at the bottom. Drag the handle up, or tap it, to open the details; drag down or tap to close.
  The card opens by itself when the user has a step to take: the rider when the driver arrives (check the car), the driver at the arrival
  and when near the pickup or destination. It tucks away again when the trip stage changes.
- **The camera follows the vehicle.** The map zooms in to street level on the car and keeps north at the top. Both apps do this
  (the rider follows the driver's car; the driver follows their own).
- **Take control any time.** Dragging or zooming the map stops the following, and a **Re-center** button appears. One tap brings the
  car back to the middle at street zoom.
- **Compass button.** Tap it to switch between **north-up** and **heading-up** (the map turns so the car drives up the screen). The
  map turns only after the car moved about 12 m, so GPS noise does not spin it. Pins and price tags stay upright.

## Typical fares (each driver sets their own)
- In *Account → Your typical fare* a driver sets a **base fare**, a **price per mile** and a **price per minute**
  (limits in `RATE_LIMITS`, `src/config/settings.js`). The typical fare for a trip is `base + per mile × miles + per minute × minutes`,
  never below the app's minimum fare. A driver with no rates uses the app's rates (`FARE_RATES`).
- The rates travel in the driver's profile (kind 0, `rates`) and in public presence while online. Junk values are ignored.
- **The rider sees them.** On the quote screen, *Typical fares nearby* lists each nearby online driver with the fare for this trip
  (drivers who did not set rates show "app rates"). The **suggested price** is the middle (median) of those fares; with no driver
  nearby it comes from the app's own formula.
- Each driver's reply (offer) carries their typical fare for the trip (`typicalSats`), and the rider sees it next to the driver's price.
- The driver's request card shows *Your typical fare for this trip*, and warns when the rider's offer is below it.
- Both screens use the trip as the request publishes it (miles to a tenth), so the cents match.

## Price offers and counter-offers
- The rider **names the price**: any amount, in **dollars and cents or sats**. The arrows button switches the unit (it is remembered).
  Type dollars and the sats show below in smaller text; type sats and the dollars show below.
  The amount must be between `MIN_OFFER_USD` and `MAX_OFFER_FACTOR` times the suggestion, so a typo cannot cost real money; outside that range a
  message shows and **Request** is off. A note says if the offer is below, near or above the suggestion.
- Sats are the source of truth (`fareSats` in the request). Dollars come from the live BTC price (or the fallback price, with a warning).
- A driver sees **Rider's offer** and taps **Accept**, or **Ask for a different price** and counters with any higher amount (same input).
  The counter starts at the driver's own typical fare when that is above the offer. The reply is a normal offer (kind 30079); its `priceSats`
  is the driver's price, and the deposit is computed from it.
- The rider sees every reply: *Accepts your price* or *Counter-offer: $N more than your offer*, with **Fastest** and **Lowest price** tags.
- A rider with no replies can **change the offer** while waiting. The request is published again (same d-tag, new price); earlier replies stay valid.
- Reservations work the same way.

## Tips (optional, any time after the ride)
- A tip is **never asked for**. The receipt only has a quiet *Leave a tip (optional)* link. After the receipt is closed, the rider can still tip
  from **Activity → the past trip → Leave a tip**, at any time, and as often as they like.
- Quick amounts ($1, $2, $5, $10) or **Other** (any amount in dollars and cents or sats, like an offer). The tip is paid over Lightning straight to
  the driver's Lightning address (connected wallet, or any wallet by invoice).
- Each tip is a signed payment record (kind 30086) with phase `tip`, sealed proof for the driver. Only the ride's rider can author one, and only on a
  completed ride.
- The driver gets a notice ("A rider sent you a $X tip"). The trip summary shows it, the trip record lists it, and **Earnings** include it
  ("Includes $X in tips"). A tip counts on the day it was sent.

## Changing the pickup while the driver is on the way
- While the driver is on the way (before they arrive), the rider can tap **Change pickup**: search a place or use *Your location*, then
  *Ask my driver to go there*.
- The driver gets a notice and a card with the new place and how far it is from the first one. They **Accept new pickup** or **Keep first pickup**.
  Until they accept, the first pickup stays for both people. If they accept, the route, the map and the trip record all use the new place.
  If they decline, the rider is told and still meets at the first place (and may ask again).
- **Changing the pickup does not change the miles or minutes already counted for a cancellation.** Both people are told this in the change window, on
  the driver's card, and in the notices. (The odometers and clocks never reset when the pickup changes.)
- The new place is end-to-end encrypted to the driver and the rider (kind 30093); the driver's answer is kind 30094. Only the ride's rider can propose
  and only the assigned driver can answer; anyone else's event is ignored.

## Trip time and distance (the meter)
- During a trip both screens show **time and distance so far**: the drive to the pickup (from when the driver was confirmed until they arrive, with
  the wait at the pickup shown separately) and the trip itself (from *Start trip*). The collapsed trip card shows the current figures.
- **Which distance is shown.** The driver's app counts the miles of its own GPS. The rider's app counts its own figure and keeps it inside the code
  (no screen shows it). The rule: **use the driver's distance as long as the rider's is within 5% of it; if they differ by more than 5%, use the
  rider's.** The same rule is used for the driver's drive to the pickup (the rider's figure there comes from the car's position updates the
  rider receives, since the rider is not in the car yet). During the trip the rider's figure is the rider's own phone GPS (or, if that is not
  available, the car's position updates).
  One addition: near zero a percentage means nothing, so a gap of 0.05 mile (about 80 m) or less always counts as "within".
- The rider's app works out the result and sends it to the driver's app (encrypted, kind 21101), so **both screens show the same numbers**. If that
  message is missing for 90 seconds, the driver's screen shows the driver's own figure.
- **Counting miles** (`lib/odometer.js`): a fix worse than 50 m is skipped; a move smaller than 6 m (or half the accuracy) is GPS wobble; a jump faster than
  120 mph is a glitch. Straight lines between fixes cut corners, so a track with few fixes reads a little low.
- **Time** comes from the signed stage markers. A marker is replaceable on a relay (only the newest stays), so each carries the earlier times
  (`at`, and `arrivedAt` on the "riding" marker). A time claimed in a marker is believed only if it is within 10 minutes of the event's timestamp.
- Both odometers are saved on the device, so a reload keeps the count.
- For now the meter is **for display only**. It will feed the proposed cancellation rules when those are built.

## Driver gender preference (optional)
- A driver can set **Female**, **Male** or **Not set** in *Account → Gender*. It is stored in the driver's kind-0 profile (`gender`)
  and copied into each offer. It is self-declared.
- A rider can choose **No preference**, **Female first** or **Male first** on the quote screen and on the driver list.
  Matching drivers move to the top; every other driver still appears below. The choice stays on the rider's device and is never published.

## Driver requirements
To go online a driver needs: face photo, vehicle year/make/model, **vehicle photo**, plate state and number,
**driver's license photo** and a Lightning address (`driveGaps` in `src/lib/profile.js`).
The Account page and the checklist name each missing item (for example *Vehicle (year, model)*, *Vehicle photo*). After
*Save vehicle info* the app lists everything that is still needed.
The license photo is encrypted to the driver's own key and stored as its own event (kind 30092). Relays hold only ciphertext, and riders never see it.

## Architecture
```
user action ─▶ signed Nostr event ─▶ relays (and a local cache)
                                       │
relays ─▶ local cache ─▶ screens read it with relay.query()
```
- `src/state/AppContext.jsx` — shared state (`useApp()`): user, tab, ride requests, `publish`, notices, BTC price, wallet.
- `src/rider/state/RiderContext.jsx`, `src/driver/state/DriverContext.jsx` — role state.
- `src/lib/trips.js` — works out the current ride from events (`activeRideFor`, `activeDriveFor`, offers).
- `src/lib/rides.js` — the **trust rules** (who may cancel, complete, mark a stage, or rate).
- `src/ui/Layout.jsx` — page structure: full-screen map with a bottom sheet, tab bar.

More detail for contributors is in `CLAUDE.md` (the file map and every invariant).

## Nostr events
| Kind | Name | Sent by | Purpose |
|---|---|---|---|
| 0 | Metadata | anyone | Name, photo, Lightning address, vehicle (plate sealed), driver gender, driver rates |
| 30078 | Ride request | rider | Coarse pickup/dropoff, the rider's offer (`fareSats`), the suggested price, sealed exact trip |
| 30079 | Ride offer | driver | Accept or counter: price, deposit, ETA, typical fare for the trip, optional gender, sealed plate |
| 30080 | Ride accept | rider | Confirms a driver; exact trip sealed to the driver |
| 30081 | Ride cancel | rider or assigned driver | Ends a ride |
| 30082 | Rating | either party | Stars and review |
| 30084 | Ride complete | assigned driver | Ends a ride as completed |
| 30085 | Ride stage | assigned driver | `arrived` / `riding` |
| 30086 | Payment record | rider | Payment proof (invoice, preimage, LUD-21 URL) sealed to the driver; phase `deposit`, `rest` or `tip` |
| 30087 | Rider confirmation | rider | `boarded`, `ended`, or `problem` (with a note) |
| 30093 | Pickup change | rider | A new pickup while the driver is on the way; the exact place sealed to the driver and the rider |
| 30094 | Pickup change answer | assigned driver | Accept or decline that change |
| 30092 | Driver license | driver | License photo, encrypted to the driver's own key; never shown to riders |
| 30091 | Trip share | throwaway key | Live trip state for a "Share my trip" link, encrypted with a key in the link |
| 30090 | Presence | driver | Online, coarse location, the driver's rates, short expiry |
| 21100 | Ride location | driver | Exact location and the driver's odometer, encrypted to the rider, ephemeral |
| 21101 | Trip meter | rider | The distances both screens show, encrypted to the driver, ephemeral |

Every event carries the app tag `["t","nostrride"]` because kind numbers like 30078 are shared with other apps.

## Privacy
- Public relays see only an **approximate area** (about 1 km) for pickup and dropoff. The exact trip is
  encrypted (NIP-44) first to the rider, then to the chosen driver.
- The **license plate** is sealed to the rider who receives the offer.
- The **driver's license photo** is encrypted to the driver's own key (kind 30092). Relays store ciphertext; no rider sees it.
- A rider's **gender preference** never leaves the device.
- A driver who is online shares a location rounded to about 100 m. The exact position goes only to the matched rider.
- Requests, fares, offers and notes are public on the relays you use.
- Looking up an address from GPS sends the position (rounded to about 10 m) to the Photon geocoder.

## Payments
Payments are **peer to peer over Lightning, with no escrow**. The rider pays the driver's Lightning
address: the **deposit** when choosing a driver, the **rest** after the trip. The deposit is not
refunded if the rider cancels after the driver is on the way. The app checks that an invoice is for
the exact amount before paying. Riders can pay with a connected NWC wallet or scan an invoice with any wallet.
Prices are set in dollars and converted to sats with the live BTC price (a fallback price is used,
with a warning, when the price feed is down).

## Location and GPS
- A fix is **good** (accurate to 200 m or better), **weak**, or **stale** (older than 60 seconds).
- A driver can go online, and is shown to riders, only with a good fix.
- During a drive the exact position is sent unless it is stale.
- The driver app keeps the screen awake while online or driving (browsers stop GPS when the screen sleeps).
- ETAs use the road time from the router, with a straight-line guess as a fallback.
- Browsers cannot track location in the background. The [native app](#native-app-and-background-gps) can.
- When the driver is within 150 m of the exact pickup (or destination) the app highlights **I've arrived** (or **Complete trip**) and shows a notice. It never acts for the driver.

## Safety
Rider app, on a trip, behind the **Safety** button:
- **Check before you get in.** When the driver arrives, the rider sees the plate, car and driver photo and taps *It matches* or *Doesn't match*. Either answer is a signed confirmation (kind 30087). The driver is told.
- **Call emergency services.** Dials `EMERGENCY_NUMBER` (default 911, in `src/config/settings.js`).
- **Share my trip.** Makes a link. A friend opens it in any browser (`track.html`, no account) and sees the car live, the driver, the car and plate, the destination, and the stage. How it works: the rider's app makes a throwaway key for the trip and publishes the state encrypted with that key; the key lives only in the link's `#fragment`, which browsers never send to a server. Updates expire after 2 hours. Sharing stops by itself when the trip ends, or when the rider taps Stop.
- **SOS.** Starts sharing and marks the trip red for anyone following. It does not call anyone, so the sheet says to also call emergency services.
- **Report a problem.** A signed note saved with the ride record.
- **Trusted contacts** (Account → Trusted contacts) are kept on the device only. The sheet offers a text message with the link for each one.

## Blocking
Either side can block. Blocking is **local to the app on this device**; the other person is not told.
- A blocked **rider's** requests never appear in the driver app.
- A blocked **driver's** offers and car never appear in the rider app.
- Block from a person's profile (tap their name or photo), or from the receipt or trip summary. Manage the list in Account → Blocked people.
- Not synced across devices or between the two apps yet.

## Disputes and evidence
There is no escrow, so the apps keep a signed trail:
- **Payment records** (kind 30086). After each payment the rider's app publishes a record: phase (`deposit`, `rest` or `tip`), amount, how strongly it was checked, and the proof, sealed so only the rider and the driver can read it. The proof is the invoice, the payment preimage, and the LUD-21 verify URL.
- **Proof level**: `preimage` (the preimage matches the invoice), `wallet` (the rider's wallet said it paid), `verify` (the Lightning server said settled), or `claimed` (the rider tapped "I've paid").
- **The driver re-checks.** The driver app never trusts the rider's level. It asks the driver's own Lightning server (same host as the driver's Lightning address) whether the invoice is settled, and shows *Confirmed by your Lightning server*, *Proof matches the invoice* or *Not verified*.
- **Rider confirmations** (kind 30087): `boarded`, `ended` (ok or a reported problem), and `problem` (mid-trip). Only the ride's rider can author them.
- The driver's own signed trail already exists: stage markers and the completion.
- **Copy trip record** (driver summary) copies all of this as one JSON bundle for whoever settles a dispute.
- Not built yet: the arbiter and the ruling flow. See the roadmap.

## Reliability
- **Outbox.** An event no relay accepts is kept (in the browser) and re-sent: after 3, 8, 20, 45, 90 and 180 seconds, when the network returns, and after a reload. Live-location events are never queued (they would be stale).
- **Reconnect.** Relay sockets reconnect by themselves. When the network returns, or the tab wakes up, all subscriptions are re-opened and recent events are fetched again.
- **Connection banner.** A strip at the top appears when the device is offline, when no relay can be reached, or when updates are waiting to send.
- **Installable app and offline start.** Each app has a manifest, icons and a service worker (production builds only). The app opens offline after one earlier visit. Maps, relays and payments still need the network.
- **Notifications.** While the app is open (even in a background tab) alerts also show as system notifications, through the service worker, which works on phones. **No push when the app is closed:** that needs a push server (self-hosted ntfy or UnifiedPush, or Firebase in the native app). Not built yet.

## Native app and background GPS
A web page cannot read the location with the screen off. `native/` wraps the **driver app** in a Capacitor shell that uses a background location plugin (Android foreground service, iOS background mode). Inside the shell the app sends a location on every fix, and skips the wake lock and service worker. In a browser nothing changes. See `native/README.md` for the steps and permissions. **This part is written and unit-tested with a fake plugin but has not been run on a real phone.**

## Configuration
| What | Where |
|---|---|
| App rates (the fallback), offer limits, driver-rate limits, deposit %, timers, demo data | `src/config/settings.js` |
| Relays | `src/config/relays.js` (also editable in the app) |
| Map tiles, address search, routing | `.env` (see `env.example`); defaults in `src/config/services.js` |
| Emergency number, arrival radius | `src/config/settings.js` |
| Colors | `src/theme.js`, Tailwind classes |

## Testing
`npm test` runs `test/*.test.mjs` with Node's built-in runner: trust rules, ride stages, fares, trips,
earnings, privacy, history, Lightning invoices, geocoding, publishing and the outbox, event ordering, contact links, GPS, payment evidence, blocking, trip sharing, native location, tips, pickup changes, the odometer and the 5% distance rule, stage times, relay subscription calls, price offers and counters, driver rates, exact offer amounts, gender ordering, driver requirements, license privacy.
The apps were also exercised end to end in a headless browser (a rider and a driver playing a full ride
through a local relay). That harness is not in the repo.

## Deploying
`npm run build` makes `dist/`. Put it on any static host (for example `ride.example.com`); it works from any sub-path. Use `https://` (location needs it). Each app keeps its own
saved key in the browser.

## Separate repositories (generated)
Two repositories hold one app each: `trevthom/nostr-ride-rider` and `trevthom/nostr-ride-driver`.
They are **generated copies**. This repository (`nostr-ride`) is the source of truth.
Do not edit code in the copies. Change it here, then run:

```
node scripts/export-apps.mjs --push            # both apps
node scripts/export-apps.mjs --push --only rider
node scripts/export-apps.mjs --out ../out      # write files only, no push
```

The script copies the shared code and one app, drops the other app, writes a `package.json`,
`vite.config.js` and docs for that app, then commits and pushes to `main` of the copy.
Each copy installs, tests and builds on its own.

## Self-hosting map services
The app uses three free public services. They are fine for development but not for real traffic.

| Need | Today | Self-hosted option |
|---|---|---|
| Map tiles | `tile.openstreetmap.org` | See below |
| Address search | Photon (`photon.komoot.io`) | Run your own [Photon](https://github.com/komoot/photon) (needs an OpenSearch index; a country extract is a few GB) |
| Driving routes | OSRM demo server | Run [OSRM](https://github.com/Project-OSRM/osrm-backend) in Docker on a regional `.osm.pbf` (RAM scales with the region) |

**Map tiles — three ways to host them**
1. **Raster tile server** (closest to what the app uses now). Run the Docker image
   `overv/openstreetmap-tile-server` on a VPS. It imports a regional extract from Geofabrik
   (`.osm.pbf`) into PostGIS and serves `https://your.host/tile/{z}/{x}/{y}.png`. A state or country
   extract imports in about an hour on a modest VPS and needs a few GB of disk. The whole planet needs
   1 TB or more, so use a region. The look is the standard OSM style.
2. **Protomaps / PMTiles** (best fit for a no-server project). One `.pmtiles` file holds a whole region
   as vector tiles. Cut an extract with the `pmtiles extract` command and put the file on any static
   host (S3, R2, a plain web server) that supports HTTP range requests. No server process. The app
   would draw it with `protomaps-leaflet` (canvas, no WebGL) in place of the raster layer.
3. **Paid or hosted provider** (MapTiler, Stadia, Mapbox). No servers to run; you pay by usage.

Whichever you choose, keep the "© OpenStreetMap contributors" credit (the data licence requires it).
To switch, copy `env.example` to `.env`, set `VITE_TILE_URL` (and `VITE_PHOTON_URL`, `VITE_OSRM_URL`), and run `npm run build` again. No code changes are needed for a raster server or a hosted provider; PMTiles needs a small code change in `MapView.jsx`.

## Trying it on an iPhone without the Apple Developer Program
- **Easiest: install it as a web app (PWA).** Put `dist/` on any free HTTPS host (Netlify Drop, Cloudflare Pages, Vercel, GitHub Pages) or run `npm run dev` and expose it with a tunnel (`cloudflared tunnel --url http://localhost:5173`, or ngrok). Open the https link in **Safari**, tap Share → **Add to Home Screen**. GPS, the map, maps, payments, the service worker, offline start and the screen wake lock (iOS 16.4+) all work. Plain `http://` LAN addresses do NOT work: Safari only allows location on https.
- **What the web app cannot do on iOS:** background GPS, and push when the app is closed.
- **Native build with a free Apple ID** (needed only for background GPS): needs a Mac with Xcode. Build the Capacitor project, run it on your own iPhone with a free "Personal Team"; the app expires after 7 days and you can have 3 at a time. Without a Mac, build an unsigned IPA on a macOS CI runner, then sign and install it with AltStore, SideStore or Sideloadly using your free Apple ID (same 7-day limit). TestFlight and the App Store need the paid program.
- No Mac and no device? Try the iOS Safari look in a hosted browser-testing service.

## Known limits and roadmap
- No escrow. Ideas, from lowest effort: reputation-scaled deposits, signed dispute evidence, Lightning
  hold invoices, then 2-of-3 escrow with an arbiter (and stablecoins later).
- No in-app chat; the Contact sheet shows the other person's Signal, Telegram or phone.
- No push notification when the app is closed (needs a push server).
- Blocks are not synced across devices or apps. A Nostr mute list (NIP-51) could do it.
- The native background-GPS shell is untested on a device.
- No arbiter or ruling flow yet; only the evidence trail.
- Free public map, geocoder and router services need replacing before launch.

## Changelog
- **Tips, pickup change, trip meter, subscription fix** — an optional tip any time after a completed ride (driver is told; Earnings include tips). The rider can change the pickup while the driver is on the way; the driver accepts or declines; both are told that cancellation miles and minutes do not change. Time and distance show on both apps; the driver's distance is used unless the rider's own GPS figure differs by more than 5%. **Fix:** live subscriptions passed an array of filters, which the installed nostr-tools sends to relays as an invalid filter; they now pass one filter object (a test guards it).
- **Typical fares and exact offers** — each driver sets their own base, per-mile and per-minute rates; riders see them (nearby list, the suggestion, each reply). Offers and counters are exact amounts in dollars and cents or sats, with a unit switch and the other unit shown below (no more $1 steps).
- **Trip screen** — the trip card is nearly collapsed and draggable; the map zooms in on the vehicle and follows it (north-up) with a compass toggle for heading-up and a Re-center button.
- **Small fixes** — a "Your location" button on the pickup field (fills the GPS address; still editable). A driver's profile photo, vehicle photo and license photo show *Change*, not *Remove*, because all three are required.
- **Offers, gender order, driver requirements** — the rider names the price (the app only suggests one) and drivers accept or counter; the rider can change the offer while waiting. Optional driver gender and a rider "show first" preference (order only). Pickup fills in from GPS; *Done* button after *Edit*. Driver setup names every missing item. Vehicle photo and driver's license photo are now required (license encrypted, kind 30092).
- **Split repositories** — `scripts/export-apps.mjs` generates the rider and driver repositories from this one.
- **Evidence, safety, blocking, reliability** — signed payment records and rider confirmations (kinds 30086, 30087); driver re-checks payments; copyable trip record. Safety sheet with car check, share-my-trip link and tracking page, SOS, report a problem, trusted contacts. Local blocking. Driver arrival suggestion. Outbox with retry, reconnect, connection banner, service worker and manifest. Native background-GPS shell (untested on device). Map services configurable through `.env`.
- **Two apps** — rider and driver apps with an Uber/Lyft-style UI; new ride-stage event (30085); state is derived from events.
- **Maps and GPS** — OpenStreetMap tiles; GPS quality checks (good / weak / stale); screen wake lock for drivers; road-time ETAs.
