# NostrRide Rider app documentation

> **Generated repository.** This is a copy of the rider app made from **trevthom/nostr-ride** by `scripts/export-apps.mjs`. Make changes in nostr-ride and export again: a hand edit here is overwritten by the next export.

> This repository is the **rider** app. The **driver** app is in its own repository, **nostr-ride-driver**. They share no server: they find each other through Nostr relays, so both use the same event formats (see [Nostr events](#nostr-events)).

Last updated with: **pay-as-you-ride ecash payments, Finish ride (no cancellations), start codes, local currency** (see the [changelog](#changelog)).

NostrRide is a decentralized ridesharing system. It is **two web apps** — a rider app and a driver
app — that find each other through **Nostr relays**. There is no company server and no database.
The rider pays the driver **while the ride runs**, in small **ecash** payments (Cashu) from the rider's wallet.
Lightning (through a connected NWC wallet, or any wallet) fills the ecash wallet and pays tips. There are **no cancellations and no cancellation fees**: either person finishes the ride, and the rider pays what the ride earned.

> This page is kept up to date with every change. If you change behavior, update the matching
> section and add a line to the [changelog](#changelog) in the same commit.

## Contents
1. [Quick start](#quick-start)
2. [The two apps](#the-two-apps)
3. [How a ride works](#how-a-ride-works)
4. [Pay as you ride (ecash) and finishing a ride](#pay-as-you-ride-ecash-and-finishing-a-ride)
5. [During a trip (both apps)](#during-a-trip-both-apps)
6. [Driver rates (each driver sets their own)](#driver-rates-each-driver-sets-their-own)
7. [Standard fare and flat price](#standard-fare-and-flat-price)
8. [Tips (optional, any time after the ride)](#tips-optional-any-time-after-the-ride)
9. [Changing the pickup while the driver is on the way](#changing-the-pickup-while-the-driver-is-on-the-way)
10. [Trip time and distance (the meter)](#trip-time-and-distance-the-meter)
11. [Driver gender preference (optional)](#driver-gender-preference-optional)
12. [Driver requirements](#driver-requirements)
13. [Architecture](#architecture)
14. [Nostr events](#nostr-events)
15. [Privacy](#privacy)
16. [Payments](#payments)
17. [Location and GPS](#location-and-gps)
18. [Safety](#safety)
19. [Blocking](#blocking)
20. [Disputes and evidence](#disputes-and-evidence)
21. [Reliability](#reliability)
22. [Native app and background GPS](#native-app-and-background-gps)
23. [Configuration](#configuration)
24. [Testing](#testing)
25. [Deploying](#deploying)
26. [Separate repositories (generated)](#separate-repositories-generated)
27. [Self-hosting map services](#self-hosting-map-services)
28. [Trying it on an iPhone](#trying-it-on-an-iphone-without-the-apple-developer-program)
29. [Known limits and roadmap](#known-limits-and-roadmap)
30. [Changelog](#changelog)

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
| Tab bar | Always visible, on every screen | Always visible, on every screen |
| Home | "Where to?" → standard fare or flat price → request | GO button → request cards (accept; counter a flat price) |
| During a trip | Live car, ETA, fare so far, start code, contact, **Finish ride**, add a stop | Route, arrived (within 50 m) / start code / **Finish ride**, fare and payments so far |
| After a trip | Receipt (anything still owed), rate, tip | Summary, waive part of the fare, rate the rider |
| Money | An ecash wallet (fill it with Lightning) | An ecash wallet (cash out to Lightning) |
| Needs | Ecash in the wallet before the ride starts | Face photo, vehicle and vehicle photo, plate, Lightning address |

Both apps share one code base for Nostr, maps, payments, profiles and UI (`src/nostr`, `src/lib`,
`src/ui`, `src/features`, `src/state`). The rider app must never import from `src/driver`, and the
reverse. The Vite *mode* picks the app (`vite --mode rider|driver`).

## How a ride works
1. The driver taps **GO** (needs a good or an *approximate* GPS fix, see [Location and GPS](#location-and-gps)). The app shares an approximate location.
2. The rider sets the pickup and the destination. **The app never fills in the pickup by itself.** The rider types an address or the name of a business or landmark (the search page says so), or **pins the spot on the map** (*Set pickup on the map*, always shown: drag the map under the pin), or taps *Your location* on the pickup field. The rider picks a **standard fare** (each driver's own rates) or a **flat price** and taps **Request**.
3. Nearby drivers get a **request card** with a countdown. A driver **accepts**, or (for a flat price) **counters** with a higher price. The reply carries the driver's rates and ecash mint.
4. The rider **chooses a driver**. The rider needs enough ecash at the driver's mint for the start (the base rate, two minutes and a mile). There is **no deposit**.
5. The driver drives to the pickup. The rider sees the car move live (end-to-end encrypted). **Nothing is charged yet.**
6. The driver taps **I've arrived** (only within 50 m of the pickup). The rider checks the car. Then each person types the **2-digit code** shown on the other person's phone, and the driver taps **Start trip**.
7. **The ride runs and the rider pays as it goes:** the base rate at the start, then each mile and each minute (ecash "ticks").
8. Either person taps **Finish ride** and confirms. The rider pays what the ride earned, up to that moment. Both rate each other. The driver may waive part of the fare.

**Going back while planning.** The back arrow on *Plan your ride* goes one screen back: to the home screen, or to the fare quote if the rider came from there with *Edit*.
The back arrow on the quote goes to the search page. **Cancel** on the search page, **Cancel and go home** under the *Request ride* button, the **X** on the quote and pin pages, and a tap on the *Ride* tab all cancel the planning and show the home screen.
Nothing is published until the rider taps *Request ride*. The tab bar is visible on every screen, including the quote and *Finding your driver*.

**Choosing a driver.** Each reply shows the driver's photo, name, rating, car, plate, **gender (when the driver gave one)**, price, rates and mint. The rider taps **Choose**, or
**No thanks** to turn that driver down. Turning a driver down does **not** end the request: it stays open, other drivers can still accept it, and the declined driver is told (they stop waiting,
the request leaves their list, and they cannot offer again on it). The confirm screen has *Not this driver* too. The rider can also close the whole request.

**Requests that nobody takes.** A request with no driver chosen closes by itself, and every app reads that from the signed request, so it disappears for the rider and for the drivers even if the
rider's app is closed: an ASAP request after **1 hour**; a reservation **2 hours after its pick-up time**. The rider's app says so once when it next runs. **Logging out closes every
request still waiting for a driver** (reservations too), because the app will not be there to choose a driver or pay. A ride that is already under way is never touched.

A reservation more than 30 minutes ahead waits under *Activity → Upcoming*. Everything on screen is **derived from the
signed events**, so a reload or a second device shows the same screen. Details of the money and the rules are in the next section.

## Pay as you ride (ecash) and finishing a ride
This is how money moves in NostrRide. **There is no deposit, no escrow, no cancellation and no cancellation fee.** The rider pays the
driver in small ecash payments ("ticks") **while the ride runs**. Either person can **finish the ride** at any time. The rider then owes
only what the ride has earned so far, and most of it is already paid.

### What the driver is paid
| When | Tick | Amount |
|---|---|---|
| The ride starts | **Base** | The driver's base rate |
| Each full mile driven | **Mile** | The driver's rate per mile |
| Each full minute that passes | **Minute** | The driver's rate per minute |
| Someone finishes the ride | **Final** | The part of a mile and of a minute that is not paid yet, to the sat |

- The fare is `base + per mile × miles + per minute × minutes`, with the driver's own rates. There is **no minimum fare**.
- Nothing is charged before the ride starts: not for the drive to the pickup, not for waiting at the pickup, not for a rider who does not come.
  The clock starts when the ride starts (after the two people confirm the start code, see below).
- The miles are the ones both screens show (the driver's GPS, unless the rider's differs by more than 5%, see the [meter](#trip-time-and-distance-the-meter)).
  The minutes come from the signed *start* marker. Both apps keep the same list of ticks (the **ledger**) from the same signed times and the
  same meter, so they agree without talking. Each app saves the ledger on its device, so a reload loses nothing.
- A tick is paid as **one ecash token** sent to the driver in a signed event (kind 30095). The token is sealed to the driver. The driver's app redeems
  it at the mint at once and answers with a signed reply (kind 30096). From then the money is the driver's own ecash. The driver can **cash out** to
  their Lightning address in *Account*.

### Standard fare or flat price
- The rider chooses on the quote screen:
  - **Standard fare.** Each driver who accepts charges their own rates, tick by tick. The screen shows an estimate, and traffic can raise it.
  - **Flat price.** The rider names an agreed price (any amount, in the local currency or in sats). A driver accepts it or counters with a higher price.
- **A flat price never grows with traffic or detours.** The app turns the flat price into ticks: each rate is scaled so that the whole trip adds up to the price.
  The ticks stop at the price. If the driver finishes the ride **at the destination**, the rest of the price is owed. If someone finishes early, only
  the part used so far is owed.
- **Adding a stop or changing the destination during the ride.** The rider asks (kind 30099) and is told first what it does to the price. The driver
  can **accept** the stop (kind 30100) or **finish the ride** instead. If the driver accepts:
  - a **flat price becomes the driver's normal fare** (base + each mile + each minute), **counted from the start of the ride**, not from the stop.
    What the rider already paid stays paid. The rider is told when asking and again when the driver accepts.
  - a ride that was already on the driver's standard fare keeps being charged by distance and time at the driver's rates.
- **The driver's rates cannot change after the ride has started.** The rates and the ecash mint are copied into the driver's offer. When the rider
  chooses that offer, they are frozen for the ride. The Account screen locks the rates while a ride runs, and a new offer sent later changes nothing
  (the app reads the offer the rider chose).

### Starting the ride: a code on each phone
1. The driver taps **I've arrived**. This works only within **50 m** of the pickup, on a good GPS fix (`ARRIVE_MAX_METERS`, `src/lib/arrival.js`).
   The button is off until then and says how far away the driver is. The marker carries the measured distance. The rider's app warns if the driver
   says "arrived" but the car is not near the pin.
2. The rider checks the car, plate and driver (*It matches*).
3. **Each phone shows its own random 2-digit code.** The rider types the code shown on the **driver's** phone. The driver types the code shown on the
   **rider's** phone. The codes come from the two people's shared secret and the ride (HMAC of the NIP-44 conversation key), so nothing travels between
   the phones for them, a third person cannot work them out, and every ride has new ones.
4. When both codes are right, **Start trip** works. Only 100 codes exist, so typing is locked for 30 s after the third wrong try, then for longer.
5. The start is the signed *riding* marker. The base tick is due at once.

### Missed payments
- The rider's app pays each tick as soon as it is due. If the wallet is short, it pays what it can and the rest **stays due**.
- A tick is **missed** when it has been due for more than 30 s and is not covered by what the driver confirmed.
- If the rider misses **two payments of any kind**, the **driver is notified** (a banner and a card) and **can finish the ride**. The driver can also tap
  **Rider still with me** to keep going.
- The rider sees a warning with **Add funds**. After a refill the app pays **everything that is missed in one payment**. This also works **after the
  ride has ended**: the receipt (and *Activity → the trip*) shows *You still owe*, and the app pays it when the wallet has money.
- The driver can still be paid later: the driver's app redeems payments for any of its rides, also for old ones.

### Finishing the ride
- Either person taps **Finish ride** and must **confirm** it in a dialog. The dialog says what the rider will pay.
- **Before the ride starts, finishing is free.** The request closes (or the ride ends) and nothing is owed.
- **After the ride starts**, the rider pays **the base rate + the distance driven + the time elapsed, up to the finish time and distance**. The finish event (kind 30081) is
  signed and carries the time and the meter. Most of it is paid already; the final tick settles the part of a mile and of a minute.
- If the rider finishes, the rider's app sends the final tick by itself. If the driver finishes, the driver says why: *driver*, *destination*, *unpaid*
  (missed payments) or *silence* (see below).
- A finish event can only come from the ride's rider or the assigned driver. **If both finish at nearly the same time**, the earliest signed one counts; within
  10 seconds of each other, the one that costs the rider less counts. The time a finish claims must be close to the time it was signed.
- **The driver may waive** all or part of the fare, for any reason, on the ride summary (*Waive part of the fare*, kind 30097). The unpaid part is
  forgiven first. If the driver waives more than that, the rest is **sent back to the rider as ecash**, which the rider's app adds to the wallet by itself.
  The money comes from the driver's own ecash at the ride's mint, so the driver can waive no more than they still hold there. The mint takes a small fee for spending ecash,
  so the last few sats may not fit: the app then sends the most it can, tells the driver, and the waiver records what was really sent.

### Lost connections, dead phones, tunnels, relays
| Case | What happens |
|---|---|
| **A phone goes quiet mid-ride** | It is **never a finish by itself.** After 2 minutes the other person is asked *Is your rider still with you?* / *Is your driver still driving?* and can tap **Rider still with me** / **Still driving** (a signed sign of life, kind 30098). |
| **Both phones silent for 10 minutes** | The ride finishes and **the charge runs up to the last signed signal** (the finish event says `silence`). It is checked when an app starts, and the claimed time cannot be earlier than a signed event that proves someone was there. |
| **Someone goes offline on purpose to dodge a charge** | It changes nothing: the charge runs to the last signal, as for any finish. |
| **The rider's phone dies, the rider is still in the car** | The driver's phone sees the rider go quiet and asks. The driver taps **Rider still with me**. The ride goes on and does not finish early. Payments are missed meanwhile (see above); the rider can pay them later. |
| **The driver is in a tunnel (a GPS gap)** | There is a **grace period of 10 minutes.** The missing miles are filled by a **straight line between the last fix and the next fix**. After a longer gap the miles in between are not counted and tracking restarts at the new fix. |
| **Relays are down while both phones are online** | Events are kept in the outbox and sent later. The time our own relays were unreachable is **not counted as silence for either person** (`src/nostr/link.js`). |
| **A tick is refused by the mint** | The driver's app replies with a final refusal only when the mint says "no" (for example, already spent). If the mint cannot be reached, it tries again and does not blame the rider. A refused tick is not counted as paid, so the rider's app pays it again. |

### Currency
- Each person picks a **local currency** in *Account → Currency* (USD, EUR, GBP, CAD, AUD, NZD, CHF, JPY, KRW, MXN, BRL, INR, SEK, NOK, DKK, PLN, CZK, ZAR, NGN, TRY).
  All prices and charges are shown in it.
- **Charges are stated in the currency of the driver's rates and turned into sats at the BTC price of the moment the charge happens.** Each tick's sats are fixed when
  the tick falls due. A later price change does not rewrite earlier ticks. Sats are what moves.
- A driver's rates are in the driver's currency (saved with the rates). A rider in another currency sees the fare converted. If the price for a
  currency is unknown, the app shows sats and does not guess; a metered tick waits until a price is known. The last good prices are kept on the device for up to 24 hours.
- The sanity limits on a driver's rates (`RATE_LIMITS`, in dollars) are scaled for other currencies.

### Ecash, the mint and the wallets
- **Ecash** is Cashu (NUT-00 to NUT-07). A **mint** holds the money behind the tokens and signs them blindly, so it cannot link a payment to a person.
  **A mint is a trusted third party:** if it disappears, the ecash is lost. Use a mint you trust, keep little in the wallet, and cash out often.
  Set the default with `VITE_DEFAULT_MINT`. The built-in default is the Macadamia mint, `https://macadamia.cash` (not yet run against: if that address is not a mint, set `VITE_DEFAULT_MINT`).
- The **driver is paid at their mint** (*Account → Ecash wallet*). It is in every offer. The **rider pays at the mint of the driver they choose**. Before the ride
  starts, the rider needs enough ecash there for the base rate, two minutes and a mile.
- **Add funds:** the mint makes a Lightning invoice. The rider pays it with a connected **NWC wallet** (one tap) or any wallet (QR, text or *Open wallet*). The app collects
  the ecash when the invoice is paid. A paid invoice that was not collected is collected the next time the app opens. **Cash out** (driver): the app asks
  the driver's Lightning address for an invoice and the mint pays it from the ecash.
- **Safety of the wallet.** The proofs are saved on the device, encrypted (NIP-44) to the user's own key, in pieces. A token being sent waits in a *pending* list until the
  event carrying it is published or queued; after a crash it returns to the wallet if the mint still calls it unspent. One money move runs at a time. A token cannot be
  redeemed twice. The user can back up the wallet as tokens (*Back up my ecash*). Logging out keeps the ecash on the device; without the nsec it cannot be opened.
- The mint charges a fee for spending proofs (`input_fee_ppk`). The **sender** adds it on top of each tick, so the driver gets the full tick.
- The Lightning wallet (NWC) is used to **add funds** and for **tips**. Tips are still paid over Lightning to the driver's Lightning address.

### What is built and what is not
- Built and tested: ticks, flat and standard fares, missed-payment counting, the final tick, Finish ride with confirmation, the start code, the 50 m arrival rule, the
  GPS-gap rule, silence and sign-of-life events, extra stops, waivers, currencies, the ecash wallet, funding by invoice and NWC, cash out, rates frozen per ride.
- Tested against **a local test mint that does the real blind-signature maths** (`test/helpers/localmint.mjs`) with the real `@cashu/cashu-ts` client, and in a headless
  browser with a rider and a driver. **Not yet run against a public mint or on a phone.**
- Not built: automatic cash out, mint choice by the rider, multi-mint swaps (a rider with funds at another mint must add funds at the driver's mint), push when the app is
  closed, a dispute arbiter.

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
- **Fare so far.** While the ride runs, both screens show what the ride has earned and what the rider has paid. The rider also sees a warning with
  **Add funds** when the wallet is short. The driver sees a card after two missed payments.
- **Finish ride.** One button on both screens. It always asks for confirmation first. There is no *Cancel* button.
- **Add a stop or change the destination** (rider, while riding): the driver accepts, or finishes the ride.

## Driver rates (each driver sets their own)
- In *Account → Your rates* a driver sets a **base rate** (paid when the ride starts), a **price per mile** and a **price per minute**, in the driver's
  **local currency** (limits in `RATE_LIMITS`, `src/config/settings.js`, in dollars and scaled for other currencies). The fare for a trip is
  `base + per mile × miles + per minute × minutes`. **There is no minimum fare.** A driver with no rates uses the app's rates (`FARE_RATES`, in dollars).
- The rates travel in the driver's profile (kind 0, `rates`, with a `currency`) and in public presence while online. Junk values are ignored.
  **They are frozen for a ride** once the rider chooses the driver (see [Pay as you ride](#pay-as-you-ride-ecash-and-finishing-a-ride)).
- **The rider sees them.** On the quote screen, *Drivers nearby* lists each nearby online driver with the fare for this trip in the rider's currency
  (drivers who did not set rates show "app rates"). The **suggested price** is the middle (median) of those fares; with no driver nearby it comes
  from the app's own formula. Drivers in different currencies compare fairly, because the comparison is in sats.
- Each driver's reply (offer) carries the driver's rates, their estimate for the trip (`typicalSats`) and their mint.
- The driver's request card shows the fare for this trip. For a flat price it warns when the rider's price is below the driver's standard fare.
- Both screens use the trip as the request publishes it (miles to a tenth), so the cents match.

## Standard fare and flat price
- On the quote screen the rider chooses one of two fares:
  - **Standard fare.** The rider accepts each driver's own rates. The request carries `fareMode: "standard"` and an estimate. A driver's reply is an offer with
    `mode: "metered"`; the driver cannot counter, because the price comes from the driver's rates. The ride is paid tick by tick and traffic can raise the cost.
  - **Flat price.** The rider **names an agreed price**: any amount, in the **local currency or sats** (the arrows button switches the unit and the choice is remembered; the other
    unit shows below). The amount must be between `MIN_OFFER_USD` and `MAX_OFFER_FACTOR` times the suggestion, so a typo cannot cost real money. The request
    carries `fareMode: "flat"`. A driver sees **Rider's flat price** and taps **Accept**, or **Ask for a different price** and counters with any higher amount
    (reply `mode: "flat"`, `priceSats` = the driver's price).
- **A flat price never grows with traffic or detours** (see [Pay as you ride](#pay-as-you-ride-ecash-and-finishing-a-ride)). If the rider adds a stop or changes the destination,
  the flat price becomes the driver's normal fare, counted from the start; the rider is told before and after.
- Sats are the source of truth (`fareSats` in the request). The local currency comes from the live BTC price.
- The rider sees every reply: for a flat price *Accepts your price* or *Counter-offer: $N more than your price*, with **Fastest** and **Lowest price** tags; for a standard fare, the driver's
  rates and estimate. Each reply shows the mint the driver is paid at.
- A rider with no replies can **change the flat price** while waiting. The request is published again (same d-tag, new price); earlier replies stay valid.
- Reservations work the same way.

## Tips (optional, any time after the ride)
- A tip is **never asked for**. The receipt only has a quiet *Leave a tip (optional)* link. After the receipt is closed, the rider can still tip
  from **Activity → the past trip → Leave a tip**, at any time, and as often as they like.
- Quick amounts (1, 2, 5, 10 in the local currency, scaled for currencies with small units) or **Other** (any amount, like a flat price). The tip is paid over Lightning straight to
  the driver's Lightning address (connected wallet, or any wallet by invoice).
- Each tip is a signed payment record (kind 30086) with phase `tip`, sealed proof for the driver. Only the ride's rider can author one, and only on a
  completed ride.
- The driver gets a notice ("A rider sent you a tip"). The trip summary shows it, the trip record lists it, and **Earnings** include it
  ("Includes … in tips"). A tip counts on the day it was sent. Tips are not ecash ticks: they go over Lightning to the driver's Lightning address.

## Changing the pickup while the driver is on the way
- While the driver is on the way (before they arrive), the rider can tap **Change pickup**: search a place or use *Your location*, then
  *Ask my driver to go there*.
- The driver gets a notice and a card with the new place and how far it is from the first one. They **Accept new pickup** or **Keep first pickup**.
  Until they accept, the first pickup stays for both people. If they accept, the route, the map and the trip record all use the new place.
  If they decline, the rider is told and still meets at the first place (and may ask again).
- **Changing the pickup does not change the miles or minutes already counted for the ride.** Both people are told this in the change window, on
  the driver's card, and in the notices. (The odometers and clocks never reset when the pickup changes. Nothing is charged before the ride starts anyway.)
- The new place is end-to-end encrypted to the driver and the rider (kind 30093); the driver's answer is kind 30094. Only the ride's rider can propose
  and only the assigned driver can answer; anyone else's event is ignored.

## Trip time and distance (the meter)
- During a trip both screens show **time and distance so far**: the drive to the pickup (from when the driver was confirmed until they arrive, with
  the wait at the pickup shown separately; neither is charged) and the trip itself (from *Start trip*). The collapsed trip card shows the current figures.
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
- The meter **feeds the payments**: the ticks for each mile and the final tick use the distance both screens show (see [Pay as you ride](#pay-as-you-ride-ecash-and-finishing-a-ride)).
  A GPS gap of up to 10 minutes is filled with a straight line between the two fixes around it; after a longer gap the new fix only restarts the count.

## Driver gender preference (optional)
- A driver can set **Female**, **Male** or **Not set** in *Account → Gender*. It is stored in the driver's kind-0 profile (`gender`)
  and copied into each offer. It is self-declared.
- A rider can choose **No preference**, **Female first** or **Male first** on the quote screen and on the driver list.
  Matching drivers move to the top; every other driver still appears below. The choice stays on the rider's device and is never published.

## Driver requirements
To go online a driver needs: face photo, vehicle year/make/model, **vehicle photo**, plate state and number,
and a Lightning address (`driveGaps` in `src/lib/profile.js`). No driver's license photo is asked for or stored.
The Account page and the checklist name each missing item (for example *Vehicle (year, model)*, *Vehicle photo*). After
*Save vehicle info* the app lists everything that is still needed.

## Architecture
```
user action ─▶ signed Nostr event ─▶ relays (and a local cache)
                                       │
relays ─▶ local cache ─▶ screens read it with relay.query()
```
- `src/state/AppContext.jsx` — shared state (`useApp()`): user, tab, ride requests, `publish`, notices, local currency and BTC prices, the ecash wallet, the NWC wallet.
- `src/rider/state/RiderContext.jsx`, `src/driver/state/DriverContext.jsx` — role state.
- `src/lib/trips.js` — works out the current ride from events (`activeRideFor`, `activeDriveFor`, offers).
- `src/lib/rides.js` — the **trust rules** (who may finish a ride, mark a stage, or rate).
- `src/lib/ticks.js`, `src/lib/ridemoney.js`, `src/lib/payments.js`, `src/lib/finish.js` — the ticks, the saved ledger, the payment events, and the finish and silence rules.
- `src/nostr/ecash.js` (wallet bookkeeping), `src/nostr/cashuMint.js` (the only file that uses the Cashu client library, loaded on demand), `src/features/payments/` (paying and redeeming ticks, Add funds).
- `src/ui/Layout.jsx` — page structure: full-screen map with a bottom sheet, tab bar.

More detail for contributors is in `CLAUDE.md` (the file map and every invariant).

## Nostr events
| Kind | Name | Sent by | Purpose |
|---|---|---|---|
| 0 | Metadata | anyone | Name, photo, Lightning address, vehicle (plate sealed), driver gender, driver rates |
| 30078 | Ride request | rider | Coarse pickup/dropoff, `fareMode` (`standard` or `flat`), the flat price or estimate (`fareSats`), the suggested price, sealed exact trip |
| 30079 | Ride offer | driver | Accept or counter: price, `mode` (`metered` or `flat`), the driver's `rates` (frozen when chosen), `mint`, trip miles and minutes, ETA, estimate, optional gender, sealed plate |
| 30080 | Ride accept | rider | Confirms a driver; exact trip sealed to the driver |
| 30081 | Ride finish | rider or assigned driver | Ends a ride: who, why (`rider`, `driver`, `destination`, `unpaid`, `silence`), the time, the meter (miles, minutes), and whether the driver was at the destination |
| 30082 | Rating | either party | Stars and review |
| 30084 | Ride complete | assigned driver | Older apps' way to end a ride at the destination (still read as a finish) |
| 30085 | Ride stage | assigned driver | `arrived` / `riding` |
| 30086 | Payment record | rider | Lightning payment proof (invoice, preimage, LUD-21 URL) sealed to the driver; phase `tip` (older rides: `deposit`, `rest`) |
| 30087 | Rider confirmation | rider | `boarded`, `code` (typed the driver's start code), `ended`, or `problem` (with a note) |
| 30093 | Pickup change | rider | A new pickup while the driver is on the way; the exact place sealed to the driver and the rider |
| 30094 | Pickup change answer | assigned driver | Accept or decline that change |
| 30095 | Tick | rider | One ecash payment while the ride runs: amount and what it was for (public), the Cashu token (sealed to the driver) |
| 30096 | Tick reply | assigned driver | "Received" (with the sats received) or a final refusal from the mint |
| 30097 | Waiver | assigned driver | Part of the fare waived: sats forgiven, sats sent back (an ecash token sealed to the rider), a reason |
| 30098 | Sign of life | rider or assigned driver | "Still riding" / "Still driving": a signed sign that the other person is there |
| 30099 | Stop change | rider | Add a stop or change the destination; the new place sealed to the driver and the rider |
| 30100 | Stop change answer | assigned driver | Accept the extra stop (the driver's other choice is to finish the ride) |
| 30101 | Offer declined | rider | "No thanks" to ONE driver's offer; the request stays open for everyone else. Only the ride's rider counts |
| 30091 | Trip share | throwaway key | Live trip state for a "Share my trip" link, encrypted with a key in the link |
| 30090 | Presence | driver | Online, coarse location, the driver's rates, short expiry |
| 21100 | Ride location | driver | Exact location and the driver's odometer, encrypted to the rider, ephemeral |
| 21101 | Trip meter | rider | The distances both screens show, encrypted to the driver, ephemeral. It also tells the driver's app the rider's app is there |

Every event carries the app tag `["t","nostrride"]` because kind numbers like 30078 are shared with other apps.

## Privacy
- Public relays see only an **approximate area** (about 1 km) for pickup and dropoff. The exact trip is
  encrypted (NIP-44) first to the rider, then to the chosen driver.
- The **license plate** is sealed to the rider who receives the offer.
- A rider's **gender preference** never leaves the device.
- The **ecash token** in a tick is sealed to the driver; the **start codes** are never sent (each phone works out both from a shared secret); a **refund token** is sealed to the rider.
  The tick **amounts** are public, like tips. The ecash wallet is saved on the device encrypted to the user's own key.
- The mint sees the amounts it signs and redeems, not who the people are (blind signatures). It can see which IP address asks.
- A driver who is online shares a location rounded to about 100 m. The exact position goes only to the matched rider.
- Requests, fares, offers and notes are public on the relays you use.
- Looking up an address from GPS sends the position (rounded to about 10 m) to the Photon geocoder.

## Payments
Payments are **peer to peer, with no escrow and no deposit.** The full rules are in [Pay as you ride](#pay-as-you-ride-ecash-and-finishing-a-ride). In short:
- **During a ride** the rider pays the driver in **ecash** ticks (base, each mile, each minute, a final part). The driver redeems each one at the mint at once.
- **Lightning** is used to **fill the ecash wallet** (the mint's invoice, paid by a connected NWC wallet or any wallet), to **cash out** (the driver's wallet takes a Lightning payment
  from the mint), and for **tips**. The app checks that a Lightning invoice is for the exact amount before paying it.
- **Prices are stated in the person's local currency** and turned into sats at the BTC price when each charge happens. The last prices are kept for 24 hours if the feed is down;
  if a currency has no price, amounts show in sats.
- **Trust.** The rider trusts the mint not to vanish. The driver trusts the mint too, and the rider only for the next unpaid tick (at most about two minutes of fare before the driver
  may finish). There is no refund of a payment except a waiver by the driver.

## Location and GPS
- A fix is **good** (accurate to 200 m or better), **weak**, or **stale** (older than 60 seconds).
- A driver can go online, and is shown to riders, with a **good** fix or an **approximate** one: a weak fix accurate to 25 km or better, like the *approximate location* a phone can give an app.
  A stale, missing or vaguer fix (for example a laptop's IP guess) cannot go online. The public position is rounded to about 100 m in any case. The driver sees a note with the accuracy and how to allow precise location.
- **Pickup pin.** The rider's pin picker sends the pin's position (rounded to about 10 m) to the geocoder to name the spot, like *Your location* does.
- During a drive the exact position is sent unless it is stale.
- The driver app keeps the screen awake while online or driving (browsers stop GPS when the screen sleeps).
- ETAs use the road time from the router, with a straight-line guess as a fallback.
- Browsers cannot track location in the background. The [native app](#native-app-and-background-gps) can.
- **I've arrived works only within 50 m of the exact pickup, on a good fix.** Within 150 m of the pickup (or the next stop or destination) the app shows a notice and highlights the next step. It never acts for the driver.
- A **GPS gap** (a tunnel) of up to 10 minutes is filled with a straight line between the fixes around it; after more than 10 minutes tracking restarts at the new fix without adding the missing miles.

## Safety
Rider app, on a trip, behind the **Safety** button:
- **Check before you get in.** When the driver arrives, the rider sees the plate, car and driver photo and taps *It matches* or *Doesn't match*. Either answer is a signed confirmation (kind 30087). The driver is told.
- **Call emergency services.** Dials `EMERGENCY_NUMBER` (default 911, in `src/config/settings.js`).
- **Share my trip.** Makes a link. A friend opens it in any browser (`track.html`, no account) and sees the car live, the driver, the car and plate, the destination, and the stage. How it works: the rider's app makes a throwaway key for the trip and publishes the state encrypted with that key; the key lives only in the link's `#fragment`, which browsers never send to a server. Updates expire after 2 hours. Sharing stops by itself when the trip ends, or when the rider taps Stop.
- **SOS.** Starts sharing and marks the trip red for anyone following. It does not call anyone, so the sheet says to also call emergency services.
- **Report a problem.** A signed note saved with the ride record.
- **Trusted contacts** (Account → Trusted contacts) are kept on the device only. The sheet offers a text message with the link for each one.

## Blocking
Either side can block. The block list is **local to the app on this device**, and the other person is not told. Blocking works **both ways on the map**:
- A blocked **rider's** requests never appear in the driver app, and the blocking **driver's car never appears for that rider**.
- A blocked **driver's** offers and car never appear in the rider app, and the blocking **rider's requests never appear for that driver**.
- How the other direction works without a server: the blocker's own public events carry short **hide tokens**, one per blocked person (a hash of the blocker's key and the other person's key, so the list names
  nobody). A rider's request carries the tokens of the drivers the rider blocked; a driver's presence carries the tokens of the riders the driver blocked. Each app checks its own token and hides what hides it.
  If a rider blocks a driver while a request is open, the request is published again with the new list. This is a courtesy between honest apps, not a lock: someone who changes their app can still read public events.
- Block from a person's profile (tap their name or photo), or from the receipt or trip summary. Manage the list in Account → Blocked people.
- Not synced across devices or between the two apps yet.

## Disputes and evidence
There is no escrow, so the apps keep a signed trail:
- **Ticks** (kind 30095) and the driver's **replies** (30096): what the rider sent, and what the driver confirmed. The driver's app counts a payment as paid only when its own
  mint redeemed it. The amount a reply gives is what the driver received, never more than the tick claims.
- **Finish events** (30081) with the time and the meter, **waivers** (30097), **signs of life** (30098) and **stop changes** (30099, 30100). The driver's stage markers say where
  the driver was when they arrived (`distM`) and that both codes were checked (`codes`).
- **Rider confirmations** (kind 30087): `boarded`, `code`, `ended` (ok or a reported problem), and `problem` (mid-trip). Only the ride's rider can author them.
- **Lightning tip records** (kind 30086) with the proof sealed to the driver. The driver re-checks them against the driver's own Lightning server (never the rider's word): *Confirmed by your Lightning server*, *Proof matches the invoice* or *Not verified*.
- **When two signed accounts disagree, the one that costs the rider less wins. No third party decides.** Today the app applies this to two finish events that arrive within 10 seconds of each other; the claimed time of a finish must be close to the time it was signed.
- **Copy trip record** (driver summary) copies all of this as one JSON bundle for whoever settles a dispute.
- Not built yet: the arbiter and the ruling flow. See the roadmap.

## Driver: new-request alerts and the nearby list
- **New request alerts** (Account) decide whether a request **pops up by itself** (the card with the countdown, a notice, a system notification). With alerts **off** nothing pops up.
- Either way, while online, the **Drive tab shows a count bubble** for the requests inside the driver's request radius, and the Drive screen shows **See nearby requests (N)**.
- That opens a **list**, closest first. Each row shows: pickup area, dropoff area, the fare (the rider's flat price, or the driver's own estimate for a standard fare), the drive time to the rider,
  the trip distance, the trip's drive time, the pick-up time for a reservation, and the rider's note. Tapping a row opens the request (Accept / Decline / counter a flat price); closing it returns to the list.
- A request whose rider blocked this driver, or turned this driver's offer down, never appears.

## Reliability
- **Outbox.** An event no relay accepts is kept (in the browser) and re-sent: after 3, 8, 20, 45, 90 and 180 seconds, when the network returns, and after a reload. Live-location events are never queued (they would be stale).
- **Reconnect.** Relay sockets reconnect by themselves. When the network returns, or the tab wakes up, all subscriptions are re-opened and recent events are fetched again.
- **A request that is slow to send is not an error.** A relay has 15 seconds (not the library's 4.4) to answer a publish. If no relay answers, the event waits in the outbox and is re-sent. *Finding your driver* says the request is still waiting only after it has waited 15 seconds in the outbox, and the message goes away by itself when it is sent. (Before, a first failed send left a "No relay accepted your request" warning on screen for good, even after a retry worked; a reload cleared it.)
- **Connection banner.** A strip at the top appears when the device is offline, when an update has been waiting 20 seconds or more to send, or when no relay can be reached. The "can't reach any relay" message needs ALL of these: no relay
  connected for 20 seconds, and a separate test connection to every relay failed within the last 15 seconds. A relay that is slow to connect, or reconnecting after a sleep, does not raise it.
- **Slow or dead connections heal themselves.** The relay pool waits up to 15 s for a connection (the library default of 3 s dropped a slow relay for good). A relay that answers the test but has no live connection is reconnected
  at once. After a network change, or a sleep of more than 30 seconds, all sockets are closed and opened fresh, because a dead socket can look connected for almost a minute.
- **Installable app and offline start.** Each app has a manifest, icons and a service worker (production builds only). The app opens offline after one earlier visit. Maps, relays and payments still need the network.
- **Notifications.** While the app is open (even in a background tab) alerts also show as system notifications, through the service worker, which works on phones. **No push when the app is closed:** that needs a push server (self-hosted ntfy or UnifiedPush, or Firebase in the native app). Not built yet.

## Native app and background GPS
A web page cannot read the location with the screen off. `native/` wraps the **driver app** in a Capacitor shell that uses a background location plugin (Android foreground service, iOS background mode). Inside the shell the app sends a location on every fix, and skips the wake lock and service worker. In a browser nothing changes. See `native/README.md` for the steps and permissions. **This part is written and unit-tested with a fake plugin but has not been run on a real phone.**

## Configuration
| What | Where |
|---|---|
| App rates (the fallback), flat-price limits, driver-rate limits, timers, demo data | `src/config/settings.js` |
| Tick rules: grace time for a missed payment (30 s), missed-payment limit (2) | `src/lib/ticks.js` |
| Silence rules (10 minutes), arrival distance (50 m), start-code lock | `src/lib/finish.js`, `src/lib/arrival.js`, `src/lib/startcode.js` |
| The ecash mint a new driver starts with | `VITE_DEFAULT_MINT` in `.env` (default in `src/config/services.js`) |
| Supported currencies | `src/lib/currency.js` |
| Relays | `src/config/relays.js` (also editable in the app) |
| Map tiles, address search, routing | `.env` (see `env.example`); defaults in `src/config/services.js` |
| Emergency number, arrival radius | `src/config/settings.js` |
| Colors | `src/theme.js`, Tailwind classes |

## Testing
`npm test` runs `test/*.test.mjs` with Node's built-in runner: trust rules, ride stages, finishing a ride (who may finish, earliest finish wins, the silence cut-off), fares, trips,
earnings, privacy, history, Lightning invoices, geocoding, publishing and the outbox, event ordering, contact links, GPS, payment evidence, blocking, trip sharing, native location, tips,
pickup changes, the odometer (and the GPS-gap rule) and the 5% distance rule, stage times, relay subscription calls, flat offers and counters, driver rates and currencies, exact amounts, gender
ordering, driver requirements, expiry of unmatched requests, blocking both ways, declined offers (`requests`), **the tick schedule (standard and flat), missed payments, the final tick, the start code, the 50 m arrival rule, silence and sign-of-life
rules, waivers, extra stops and frozen rates, the ecash wallet (funding, paying, redeeming, crash recovery, cash out, encrypted saving), a whole ride's money between a rider and a
driver, and the real `@cashu/cashu-ts` client against a local test mint that does the real blind-signature maths**.

The apps were also run end to end in a headless browser (a rider and a driver playing a whole ride through a local relay and the local test mint): funding with an invoice, the request,
the offer, the confirm screen, the 50 m arrival lock, both start codes, the base, minute and mile ticks, Finish ride with its confirmation, the receipt and summary, missed
payments, a refill after the ride, and a waiver with a refund. That harness is in `scripts/e2e/` (it needs `npm i --no-save ws playwright`; it is not part of `npm test`).
**Never run against a public mint, and never on a real phone.**

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
- No escrow and no deposit. The driver's risk is the next unpaid tick (about two minutes of fare). The mint is a trusted party for both people.
- Funds are held per mint. A rider with ecash at another mint must add funds at the driver's mint (no swap between mints yet).
- No in-app chat; the Contact sheet shows the other person's Signal, Telegram or phone.
- No push notification when the app is closed (needs a push server).
- Blocks are not synced across devices or apps. A Nostr mute list (NIP-51) could do it.
- The native background-GPS shell is untested on a device. Browsers cannot track location with the screen off.
- No arbiter or ruling flow yet; only the evidence trail.
- The silence rule is checked when an app starts for a ride, not while a stale tab sleeps.
- Both apps count minutes from the driver's signed start time with their own clock. A phone clock that is a minute wrong makes ticks late or early; the 30-second grace and the catch-up payment absorb small gaps, not large ones. Phones normally set their clock by network time.
- The ecash code (about 70 KB compressed) is a separate file that loads at login. The service worker keeps it after the first online visit, so ecash works offline only after one online login.
- Free public map, geocoder and router services need replacing before launch, and a mint you trust must be chosen (`VITE_DEFAULT_MINT`).
- Not built from the earlier draft (it no longer applies, because there are no cancellations or fees): waiting and no-show charges, charges for the drive to the pickup, driver-set waiting terms,
  and a cancel rate on profiles.

## Changelog
- **Strike removed; default mint is Macadamia** — the optional Strike link (funding, tips, cash out and whole rides paid Strike to Strike) is taken out of `main` again (two revert commits; the code stays in the history). The ecash mint a new driver starts with is now `https://macadamia.cash`, set in `src/config/services.js`; `VITE_DEFAULT_MINT` still overrides it. The address was given by the owner and could not be checked from the build machine.
- **Reservations expire, blocking both ways, nearby list, gender, "No thanks"** — a reservation nobody takes closes 2 hours after its pick-up time (was 1), and logging out closes every request still waiting for a driver. Blocking hides people from each other on the map (hide tokens in requests and presence). *New request alerts* off now really stops the pop-up; the Drive tab keeps its count bubble and a new *See nearby requests* list shows pickup, dropoff, fare, time to the rider, trip distance, trip time and notes. The rider sees the driver's gender (if given) before choosing, and *No thanks* turns one driver down without closing the request (new kind 30101). Presence and trip-share relay pools wait 15 s for a connection.
- **Pickup is never automatic; cancel buttons; stale relay warning fixed; version line** — the pickup is no longer filled in from GPS. The search page asks for an address or a business name, always shows *Set pickup on the map*, and keeps *Your location* as a deliberate tap. *Cancel* (search), *Cancel and go home* (quote), and an X (quote, pin) return to the home screen; the pin page has the X too. The tab bar was checked on every rider screen with real styling. The "No relay accepted your request" warning no longer sticks after a retry succeeds: it shows only while the request still waits in the outbox after 15 s. A relay has 15 s to answer a publish, and the outbox banner needs a 20 s wait. Account shows the app version (build time and commit), so a person can tell which build a phone runs.
- **Rider navigation, pickup pin, approximate driver location, relay banner, no license photo** — the rider can pin the pickup on the map (drag the map under a fixed pin; the address is looked up). The back arrow on *Plan your ride* goes one screen back (it used to loop between the quote and the search page); an X on the search, pin and quote pages, and the *Ride* tab, cancel the planning and show the home screen. The bottom tab bar is always visible in both apps. A driver can go online and be shown on the map with an approximate location (accurate to 25 km or better); marking *I've arrived* still needs a good fix. The false "can't reach any relay" message is fixed: the relay test no longer uses (and breaks) the app's own connection, the pool waits 15 s for a connection, the banner needs a sustained outage that a separate test confirms, and sockets are renewed after a sleep or a network change. The driver's license photo is gone: no upload, no requirement, no event kind 30092.
- **Pay as you ride with ecash; Finish ride; start codes; local currency** — the rider pays the driver in ecash ticks while the ride runs (the base rate, each mile, each minute, a final
  part) from an ecash wallet filled with Lightning (NWC or any wallet); the driver redeems each tick at the mint and can cash out. **No deposit, no escrow, no cancellations and no cancel fees:**
  either person taps *Finish ride* (confirmed), and the rider pays what the ride earned. After two missed payments the driver may finish; the rider can refill and pay what is missed, also later.
  Standard fare or flat price (a flat price never grows with traffic; an accepted extra stop turns it into the driver's normal fare from the start). The driver's rates and mint are frozen
  for a ride. *I've arrived* works within 50 m only; the ride starts when both people type the other's 2-digit code. Silence rules: a quiet phone is never a finish; "Rider still with me" /
  "Still driving"; both silent for 10 minutes finishes at the last signal; relay outages are not counted; a 10-minute GPS-gap grace with a straight-line fill. The driver may waive part of
  the fare (unpaid part forgiven, the rest sent back as ecash). Prices and charges in a local currency chosen in Account, turned into sats when each charge happens. New kinds 30095–30100;
  30081 is now "ride finish"; the deposit and "rest" payments are gone; the minimum fare is gone.
- **Tips, pickup change, trip meter, subscription fix** — an optional tip any time after a completed ride (driver is told; Earnings include tips). The rider can change the pickup while the driver is on the way; the driver accepts or declines; both are told that cancellation miles and minutes do not change. Time and distance show on both apps; the driver's distance is used unless the rider's own GPS figure differs by more than 5%. **Fix:** live subscriptions passed an array of filters, which the installed nostr-tools sends to relays as an invalid filter; they now pass one filter object (a test guards it).
- **Typical fares and exact offers** — each driver sets their own base, per-mile and per-minute rates; riders see them (nearby list, the suggestion, each reply). Offers and counters are exact amounts in dollars and cents or sats, with a unit switch and the other unit shown below (no more $1 steps).
- **Trip screen** — the trip card is nearly collapsed and draggable; the map zooms in on the vehicle and follows it (north-up) with a compass toggle for heading-up and a Re-center button.
- **Small fixes** — a "Your location" button on the pickup field (fills the GPS address; still editable). A driver's profile photo, vehicle photo and license photo show *Change*, not *Remove*, because all three are required.
- **Offers, gender order, driver requirements** — the rider names the price (the app only suggests one) and drivers accept or counter; the rider can change the offer while waiting. Optional driver gender and a rider "show first" preference (order only). Pickup fills in from GPS; *Done* button after *Edit*. Driver setup names every missing item. Vehicle photo and driver's license photo are now required (license encrypted, kind 30092).
- **Split repositories** — `scripts/export-apps.mjs` generates the rider and driver repositories from this one.
- **Evidence, safety, blocking, reliability** — signed payment records and rider confirmations (kinds 30086, 30087); driver re-checks payments; copyable trip record. Safety sheet with car check, share-my-trip link and tracking page, SOS, report a problem, trusted contacts. Local blocking. Driver arrival suggestion. Outbox with retry, reconnect, connection banner, service worker and manifest. Native background-GPS shell (untested on device). Map services configurable through `.env`.
- **Two apps** — rider and driver apps with an Uber/Lyft-style UI; new ride-stage event (30085); state is derived from events.
- **Maps and GPS** — OpenStreetMap tiles; GPS quality checks (good / weak / stale); screen wake lock for drivers; road-time ETAs.
