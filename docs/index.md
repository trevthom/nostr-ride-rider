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
4. [Price offers and counter-offers](#price-offers-and-counter-offers)
5. [Driver gender preference (optional)](#driver-gender-preference-optional)
6. [Driver requirements](#driver-requirements)
7. [Architecture](#architecture)
8. [Nostr events](#nostr-events)
9. [Privacy](#privacy)
10. [Payments](#payments)
11. [Location and GPS](#location-and-gps)
12. [Safety](#safety)
13. [Blocking](#blocking)
14. [Disputes and evidence](#disputes-and-evidence)
15. [Reliability](#reliability)
16. [Native app and background GPS](#native-app-and-background-gps)
17. [Configuration](#configuration)
18. [Testing](#testing)
19. [Deploying](#deploying)
20. [Separate repositories (generated)](#separate-repositories-generated)
21. [Self-hosting map services](#self-hosting-map-services)
22. [Trying it on an iPhone](#trying-it-on-an-iphone-without-the-apple-developer-program)
23. [Known limits and roadmap](#known-limits-and-roadmap)
24. [Changelog](#changelog)

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

## Price offers and counter-offers
- The app **suggests** a price from the trip: `base + per mile + per minute` (`FARE_RATES` in `src/config/settings.js`). The
  quote screen shows the numbers it used.
- The rider **names the price** in whole dollars with − / + (or by typing). The offer stays between `MIN_OFFER_USD` and
  `MAX_OFFER_FACTOR` times the suggestion, so a typo cannot cost real money. A note says if the offer is below, near or above the suggestion.
- The request carries the offer as `fareSats` and the suggestion as `suggestedSats`.
- A driver sees **Rider's offer** and taps **Accept**, or **Ask for a different price** and counters at least $1 higher. The reply
  is a normal offer (kind 30079); its `priceSats` is the driver's price. The deposit is computed from that price.
- The rider sees every reply: *Accepts your price* or *Counter-offer: $N more than your offer*, with **Fastest** and **Lowest price** tags.
- A rider with no replies can **change the offer** while waiting. The request is published again (same d-tag, new price); earlier replies stay valid.
- Reservations work the same way.

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
| 0 | Metadata | anyone | Name, photo, Lightning address, vehicle (plate sealed) |
| 30078 | Ride request | rider | Coarse pickup/dropoff, the rider's offer (`fareSats`), the suggested price, sealed exact trip |
| 30079 | Ride offer | driver | Accept or counter: price, deposit, ETA, optional gender, sealed plate |
| 30080 | Ride accept | rider | Confirms a driver; exact trip sealed to the driver |
| 30081 | Ride cancel | rider or assigned driver | Ends a ride |
| 30082 | Rating | either party | Stars and review |
| 30084 | Ride complete | assigned driver | Ends a ride as completed |
| 30085 | Ride stage | assigned driver | `arrived` / `riding` |
| 30086 | Payment record | rider | Payment proof (invoice, preimage, LUD-21 URL) sealed to the driver |
| 30087 | Rider confirmation | rider | `boarded`, `ended`, or `problem` (with a note) |
| 30092 | Driver license | driver | License photo, encrypted to the driver's own key; never shown to riders |
| 30091 | Trip share | throwaway key | Live trip state for a "Share my trip" link, encrypted with a key in the link |
| 30090 | Presence | driver | Online, coarse location, short expiry |
| 21100 | Ride location | driver | Exact location, encrypted to the rider, ephemeral |

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
- **Payment records** (kind 30086). After each payment the rider's app publishes a record: phase (`deposit` or `rest`), amount, how strongly it was checked, and the proof, sealed so only the rider and the driver can read it. The proof is the invoice, the payment preimage, and the LUD-21 verify URL.
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
| Suggested-price formula, offer limits, deposit %, timers, demo data | `src/config/settings.js` |
| Relays | `src/config/relays.js` (also editable in the app) |
| Map tiles, address search, routing | `.env` (see `env.example`); defaults in `src/config/services.js` |
| Emergency number, arrival radius | `src/config/settings.js` |
| Colors | `src/theme.js`, Tailwind classes |

## Testing
`npm test` runs `test/*.test.mjs` with Node's built-in runner: trust rules, ride stages, fares, trips,
earnings, privacy, history, Lightning invoices, geocoding, publishing and the outbox, event ordering, contact links, GPS, payment evidence, blocking, trip sharing, native location, price offers and counters, gender ordering, driver requirements, license privacy.
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
- **Offers, gender order, driver requirements** — the rider names the price (the app only suggests one) and drivers accept or counter; the rider can change the offer while waiting. Optional driver gender and a rider "show first" preference (order only). Pickup fills in from GPS; *Done* button after *Edit*. Driver setup names every missing item. Vehicle photo and driver's license photo are now required (license encrypted, kind 30092).
- **Split repositories** — `scripts/export-apps.mjs` generates the rider and driver repositories from this one.
- **Evidence, safety, blocking, reliability** — signed payment records and rider confirmations (kinds 30086, 30087); driver re-checks payments; copyable trip record. Safety sheet with car check, share-my-trip link and tracking page, SOS, report a problem, trusted contacts. Local blocking. Driver arrival suggestion. Outbox with retry, reconnect, connection banner, service worker and manifest. Native background-GPS shell (untested on device). Map services configurable through `.env`.
- **Two apps** — rider and driver apps with an Uber/Lyft-style UI; new ride-stage event (30085); state is derived from events.
- **Maps and GPS** — OpenStreetMap tiles; GPS quality checks (good / weak / stale); screen wake lock for drivers; road-time ETAs.
