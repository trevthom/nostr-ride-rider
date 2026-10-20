# NostrRide Rider app documentation

> **Generated repository.** This is a copy of the rider app made from **trevthom/nostr-ride** by `scripts/export-apps.mjs`. Make changes in nostr-ride and export again: a hand edit here is overwritten by the next export.

> This repository is the **rider** app. The **driver** app is in its own repository, **nostr-ride-driver**. They share no server: they find each other through Nostr relays, so both use the same event formats (see [Nostr events](#nostr-events)).

Last updated with: **Create New Wallet / Restore my wallet (no wallet is made by itself, and a restore keeps the typed words), no Lightning wallet (NWC), Units under Appearance, the Wallets section (currency, ecash and cash out location in one place, Add funds by Lightning or on-chain, Send beside it), settings saved to your relays by themselves, two dark switches (application and map), up to 3 vehicle photos, a cash out location that is optional, an address search that shows only what the active box needs (its map button first, its 3 recent places below), sending ecash to another wallet (a token or Lightning), "Automatically cash out at", a live ecash balance, the estimate below Paid, Add stop / update fare with an estimated change, seconds on the trip clock, default rates $1.50 / $1.10 / $0.20, no car-confirmation button (the start-code field is shown at once), dark mode, a password eye, "Cash out location", no flat price or counter-offer, a wide start-code field, phone-sized screens (pinned main buttons), one 4-digit start code typed only by the rider, I've arrived within 150 m, a 12-word recovery phrase for the ecash wallet, collapsible Account sections, vouches ("I know and trust this person") in place of star ratings, pay-as-you-ride ecash payments, Finish ride (no cancellations), start codes, local currency** (see the [changelog](#changelog)).

NostrRide is a decentralized ridesharing system. It is **two web apps** — a rider app and a driver
app — that find each other through **Nostr relays**. There is no company server and no database.
The rider pays the driver **while the ride runs**, in small **ecash** payments (Cashu) from the rider's wallet.
Lightning (any wallet) fills the ecash wallet, and tips are paid from the ecash. There are **no cancellations and no cancellation fees**: either person finishes the ride, and the rider pays what the ride earned.

> This page is kept up to date with every change. If you change behavior, update the matching
> section and add a line to the [changelog](#changelog) in the same commit.

## Contents
1. [Quick start](#quick-start)
2. [The two apps](#the-two-apps)
3. [How a ride works](#how-a-ride-works)
4. [Pay as you ride (ecash) and finishing a ride](#pay-as-you-ride-ecash-and-finishing-a-ride)
5. [During a trip (both apps)](#during-a-trip-both-apps)
6. [Driver rates (each driver sets their own)](#driver-rates-each-driver-sets-their-own)
7. [The fare (each driver's own rates)](#the-fare-each-drivers-own-rates)
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
20. [Vouches ("I know and trust this person")](#vouches-i-know-and-trust-this-person)
21. [Disputes and evidence](#disputes-and-evidence)
22. [Reliability](#reliability)
23. [Native app and background GPS](#native-app-and-background-gps)
24. [Configuration](#configuration)
25. [Testing](#testing)
26. [Deploying](#deploying)
27. [Separate repositories (generated)](#separate-repositories-generated)
28. [Self-hosting map services](#self-hosting-map-services)
29. [Trying it on an iPhone](#trying-it-on-an-iphone-without-the-apple-developer-program)
30. [Known limits and roadmap](#known-limits-and-roadmap)
31. [Changelog](#changelog)

## Quick start
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # automated checks
npm run build      # dist/
```
To play a whole ride, also run the **driver** app from its repository (port 5174) and sign in with a different account in each.
Needs internet for fonts, the map, and the relays. Location needs `https://` or `localhost`.

## The two apps
| | Rider app (repo nostr-ride-rider) | Driver app (repo nostr-ride-driver) |
|---|---|---|
| Tabs | Ride · Activity · Account | Drive · Earnings · Account |
| Account | Every setting is a section that opens and closes (closed at first; what you opened is remembered on the device) | The same |
| Tab bar | Always visible, on every screen | Always visible, on every screen |
| Home | "Where to?" → the estimated fare → request | GO button → request cards (accept or decline) |
| During a trip | Live car, ETA, **your ecash balance**, fare so far, paid, estimated total, start code, contact, **Finish ride**, **Add stop / update fare** | Route, arrived (within 150 m) / start code / **Finish ride**, fare and payments so far |
| After a trip | Receipt (anything still owed), tip | Summary, waive part of the fare |

**Phone screens.** Both apps are laid out for a phone first: the page fills the screen (without the browser bars), keeps clear of the notch and the home bar, and the keyboard shrinks the page instead of covering a field. The main button of a sheet
(*Request ride*, *Accept*, *Confirm driver*, *I've arrived*, *Start trip*, *Finish ride*) stays pinned at the bottom of the sheet, so on a small phone it is never below the fold; the sheet scrolls above it. On a phone held sideways the buttons scroll
with the sheet. Fields are 16 px or larger on touch screens, so iPhones do not zoom in. The search fields fit a 320 px screen (the *Your location* button turns into an icon), at most two notices show at once, and the map's credit line sits above the sheet. On a computer the
app is a phone-width column in the middle of the page, as before. `E2E_VIEWPORT=360x640 node scripts/e2e/ride.mjs` plays a ride in a phone-sized browser.

**Dark mode.** *Account → Appearance* (both apps) has **two switches**: **Dark Mode (application)** darkens the screens and the phone's bar color but **not the map**; **Dark Mode (map)** darkens only the map tiles (and the map's credit line).
Each switch **saves and applies the moment it is flipped**: there is no Save button. The choices stay on the device (`nostrride_dark`, `nostrride_darkMap`, `src/lib/appearance.js`) and travel in the encrypted settings backup;
the app starts light until they are turned on. The colors of the screens are CSS variables (`src/index.css`, wired in `tailwind.config.js`): `white`, `black`, the grays
and the tints of red, amber, green and blue follow the application switch (the `dark` class on the page), and `white` and `black` trade places (a black button becomes a light one with dark text). A color that must not change (white text on the green
GO button, on a red button, the dark backdrop behind a dialog or a photo) is written as a fixed value such as `text-[#fff]` or `bg-[#000]/50`. The map tiles are turned dark with a CSS filter that hangs on the map switch (the `dark-map` class); the pins,
the route and the price tags keep their colors. `public/theme-init.js` (a small script from the app's own files, so the Content-Security-Policy still allows no inline script) puts both classes on the page
before the first paint, so a reload does not flash white. `scripts/e2e/appearance.mjs` checks all of this.

**Your settings are saved for you.** There is no Backup section. Every saved setting (the block list, trusted contacts, currency, units, both dark switches, the request radius and alerts, gender preference, the chosen mint, the relay list,
"Automatically cash out at", on-chain deposit addresses) and the vouch list go to the person's relays as **one note that only their secret key can open** (NIP-44 to their own key, kind 30111; `src/lib/backup.js`, `src/state/useBackup.js`).
It is sent a few seconds after a change and checked every minute; a note no relay accepts waits in the outbox. A new phone that logs in with the same nsec gets the settings back; the app always looks for the note first and sends nothing until it has looked,
so a fresh phone cannot overwrite the note with its empty state. Relays see that a note exists, its size and when it changed, nothing inside. The ecash is not in it.

**Password eye.** Every password field (the *Remember me* password and the **Unlock** page of a saved account) has an eye button that shows or hides the typed text (`src/ui/PasswordField.jsx`).
The password starts hidden each time the page is drawn.

**Cash out location.** *Account → Wallets → Cash out location* (both apps) is where the person's Lightning address is kept (`lud16` in the profile, checked when saved). It is **optional**: a driver can go online
without it and keep the ecash in the wallet. With it, a driver or a rider can *Cash out*, a driver can use *Automatically cash out at*, and a rider's tip goes there (without it the tip screen says the driver has no Lightning address).
The profile (kind 0) is shared by the Rider and Driver apps, so an address saved in one app is the same in the other: the other app reads it at login, every 5 minutes and when it comes back to the front. A profile save writes only the fields it changes
(`src/lib/profilecontent.js`), so an app that was opened before the other one saved never writes its old copy back over the new address, vehicle, rates or gender. (It was called *Lightning address*.)

**Wallets.** *Account → Wallets* (both apps) holds everything about money, top to bottom: **Currency** (first), the **ecash wallet** ("Add ecash here before you ride.", the balance, **Add funds** and **Send** side by side, *Automatically cash out at* for a driver, the mint),
and the **Cash out location**. (These were separate sections: Ecash wallet, Currency, Cash out location, Lightning wallet; the Lightning wallet (NWC) is gone.) **A device with no wallet** shows two buttons in place of the balance: **Create New Wallet** (a warning that the 12 words are the only way to get the money back, then the words at once) and **Restore my wallet** (type the 12 words from another phone). The section keeps the id `ecash`, so an open or closed state saved earlier still applies.
| Money | An ecash wallet (fill it with Lightning) | An ecash wallet (cash out to the **cash out location**, a Lightning address) |
| Needs | Ecash in the wallet before the ride starts | Face photo, vehicle and vehicle photo, plate (a cash out location is optional) |

Both apps share one code base for Nostr, maps, payments, profiles and UI (`src/nostr`, `src/lib`,
`src/ui`, `src/features`, `src/state`). The rider app must never import from `src/driver`, and the
reverse. The Vite *mode* picks the app (`vite --mode rider|driver`).

## How a ride works
1. The driver taps **GO** (needs a good or an *approximate* GPS fix, see [Location and GPS](#location-and-gps)). The app shares an approximate location.
2. The rider sets the pickup and the destination. **The app never fills in the pickup by itself.** The rider types an address or the name of a business or landmark (the search page says so), or **pins the spot on the map** (*Set pickup on the map*: drag the map under the pin), or taps *Your location* on the pickup field. **The drop-off can be pinned the same way** (*Set drop-off on the map*); with both places set the quote opens.
   The search page shows **nothing but the two boxes until one is active** (has the cursor). Then, for that box only: its map button comes first, and the **3 most recent pickups** (or **3 most recent drop-offs**) are listed below it; once the rider types, the search results take their place.
   The rider sees each driver's own rates (a **standard fare**) and taps **Request**.
3. Nearby drivers get a **request card** with a countdown. A driver **accepts** (or declines). The reply carries the driver's rates and ecash mint.
4. The rider **chooses a driver**. The rider needs enough ecash at the driver's mint for the start: the base rate, two minutes and a mile (with the default rates $1.50 + $0.40 + $1.10 = **$3.00**).
   The confirm screen shows the sum. The second minute is a small cushion, so the first payments are never late (a minute is due after 60 seconds and the app checks every 3 seconds). It is **not locked away**:
   the ride is paid as it is used. There is **no deposit**.
5. The driver drives to the pickup. The rider sees the car move live (end-to-end encrypted). **Nothing is charged yet.**
6. The driver taps **I've arrived** (only within 150 m of the pickup). The rider checks the car. Then the rider types the **4-digit start code** shown on the driver's phone, and the driver taps **Start trip**. The driver types nothing.
7. **The ride runs and the rider pays as it goes:** the base rate at the start, then each mile and each minute (ecash "ticks").
8. Either person taps **Finish ride** and confirms. The rider pays what the ride earned, up to that moment. The driver may waive part of the fare. There are no star ratings and no reviews (see [Vouches](#vouches-i-know-and-trust-this-person)).

**Going back while planning.** The back arrow on *Plan your ride* goes one screen back: to the home screen, or to the fare quote if the rider came from there with *Edit*.
The back arrow on the quote goes to the search page. **Cancel** on the search page, **Cancel** under the *Request ride* button, the **X** on the quote and pin pages, and a tap on the *Ride* tab all cancel the planning and show the home screen.
Nothing is published until the rider taps *Request ride*. The tab bar is visible on every screen, including the quote and *Finding your driver*.

**Choosing a driver.** Each reply shows the driver's photo, name, the vouch badge (when someone you vouch for knows and trusts them), car, plate, **gender (when the driver gave one)**, price, rates and mint. The rider taps **Choose**, or
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
  their **cash out location** (a Lightning address) in *Account*, by hand or automatically (see *Sending and cashing out ecash*).

### The fare
- **There is one fare: each driver's own rates**, paid tick by tick. The quote screen shows an estimate and the drivers nearby; traffic can raise the cost.
  The rider does not name a price and a driver does not counter (the *flat price* and the counter-offer were removed; see the changelog).
- **Old requests and offers.** A request that says `fareMode: "flat"` and an offer that says `mode: "flat"` (from an older app) are read as the standard fare at the driver's rates.
- **Add stop / update fare (a stop, or a new destination, during the ride).** The rider asks (kind 30099) and sees first the **estimated change in the fare**: a dashed box with
  "≈", for example *≈ +$2.40* and *+1.8 mi · +4 min* (or *≈ −$11.52* for a shorter way). The driver sees the same estimate on the request, and can **accept** the stop (kind 30100) or **finish the ride**
  instead. If the driver accepts, the ride keeps being charged by distance and time at the driver's rates, and the **estimated total** in the fare card is priced again for the new route
  (see *During a trip*). How it is estimated: the route from the car through the places still ahead is compared with the same route with the new place in it (OSRM, like the map);
  the fare change is per mile × the change in miles + per minute × the change in minutes at the driver's frozen rates. The base rate does not change. No route or no price: no number is shown.
- **The driver's rates cannot change after the ride has started.** The rates and the ecash mint are copied into the driver's offer. When the rider
  chooses that offer, they are frozen for the ride. The Account screen locks the rates while a ride runs, and a new offer sent later changes nothing
  (the app reads the offer the rider chose).

### Starting the ride: one code, typed by the rider
1. The driver taps **I've arrived**. This works only within **150 m** of the pickup, on a good GPS fix (`ARRIVE_MAX_METERS`, `src/lib/arrival.js`).
   The button is off until then and says how far away the driver is. The marker carries the measured distance. The rider's app warns if the driver
   says "arrived" but the car is not near the pin (more than 300 m away: the limit plus room for GPS error on both phones).
2. The rider checks the car, plate and driver **by eye**. There is nothing to tap: the driver's photo, car and plate are on the rider's screen, and the code field (step 3) is there at once.
3. **The driver's phone shows a random 4-digit start code.** The driver reads it to the rider, and the **rider** types it on the rider's phone. The driver types
   nothing. The code comes from the two people's shared secret and the ride (HMAC of the NIP-44 conversation key), so nothing travels between
   the phones for it, a third person cannot work it out, and every ride has a new one.
   The field fills the whole width of the sheet, and *Confirm* sits below it (once, on a phone, the button took the whole row and squeezed the field to two digits).
4. When the rider's code is right (a signed *code* confirmation), **Start trip** works on the driver's phone. 10,000 codes exist, so typing is locked for 30 s after the third wrong try, then for longer.
5. The start is the signed *riding* marker (its `codes` field says the start code was checked). The base tick is due at once.

### Missed payments
- The rider's app pays each tick as soon as it is due. If the wallet is short, it pays what it can and the rest **stays due**.
- A tick is **missed** when it has been due for more than 30 s and is not covered by what the driver confirmed.
- If the rider misses **two payments of any kind**, the **driver is notified** (a banner and a card) and **can finish the ride**. The driver can also tap
  **Rider still with me** to keep going.
- The rider sees a warning with **Add funds**. After a refill the app pays **everything that is missed in one payment**. This also works **after the
  ride has ended**: the receipt (and *Activity → the trip*) shows *You still owe*, and the app pays it when the wallet has money.
- The driver can still be paid later: the driver's app redeems payments for any of its rides, also for old ones.
- **A sleeping phone pays nothing.** A web page's timers stop when the screen locks or the app goes to the background. The rider's app pays from a 3-second timer, so a rider whose
  phone sleeps stops paying although the wallet is full, and the driver (whose app stays awake) sees missed payments after about a minute. To prevent this the rider app **keeps the screen on
  while a ride is running** (the same screen wake lock the driver app uses). When the page wakes up again it pays everything that fell due at once, in one payment. If the browser refuses the lock
  (old browsers, battery saver) the ride screen says *Keep this app open on your screen*. Switching to another app still pauses the payments until the rider comes back.

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
- Each person picks a **local currency** in *Account → Wallets → Currency* (USD, EUR, GBP, CAD, AUD, NZD, CHF, JPY, KRW, MXN, BRL, INR, SEK, NOK, DKK, PLN, CZK, ZAR, NGN, TRY).
  All prices and charges are shown in it.
- **Charges are stated in the currency of the driver's rates and turned into sats at the BTC price of the moment the charge happens.** Each tick's sats are fixed when
  the tick falls due. A later price change does not rewrite earlier ticks. Sats are what moves.
- A driver's rates are in the driver's currency (saved with the rates). A rider in another currency sees the fare converted. If the price for a
  currency is unknown, the app shows sats and does not guess; a metered tick waits until a price is known. The last good prices are kept on the device for up to 24 hours.
- The sanity limits on a driver's rates (`RATE_LIMITS`, in dollars) are scaled for other currencies.

### Ecash, the mint and the wallets
- **Ecash** is Cashu (NUT-00 to NUT-09, and NUT-13 for the recovery phrase). A **mint** holds the money behind the tokens and signs them blindly, so it cannot link a payment to a person.
  **A mint is a trusted third party:** if it disappears, the ecash is lost. Use a mint you trust, keep little in the wallet, and cash out often.
  Set the default with `VITE_DEFAULT_MINT`. The built-in default is the public Minibits mint, `https://mint.minibits.cash/Bitcoin`, a starting point for trying the app (**choose a mint you trust before you launch**). `https://macadamia.cash` is the website of an iOS wallet, not a mint. A mint address is checked before it is saved (*Account → Wallets → Save*): a website that answers with a page is refused with a short reason.
- The **driver is paid at their mint** (*Account → Wallets*). It is in every offer. The **rider pays at the mint of the driver they choose**. Before the ride
  starts, the rider needs enough ecash there for the base rate, two minutes and a mile.
- **Add funds:** the mint makes a Lightning invoice. The rider pays it with any wallet (QR, text or *Open wallet*). The app collects
  the ecash when the invoice is paid. A paid invoice that was not collected is collected the next time the app opens. **Cash out** (driver): the app asks
  the driver's Lightning address for an invoice and the mint pays it from the ecash.
- **Add funds on-chain.** *Add funds* has two tabs, **Lightning** and **On-chain**. On-chain uses the Cashu on-chain method (NUT-30, still marked experimental in the client library): the mint gives a **bitcoin address**, the person sends bitcoin to it from any wallet, and after the network confirms the payment the mint lets the app turn it into ecash
  (`EcashWallet.onchainStart/claimOnchain`, `features/payments/OnchainFunds.jsx`). **Only mints that list the on-chain method can do this**: the app asks the mint first and says so, before anyone sends bitcoin to a mint that cannot (the default Minibits mint was not checked; choose a mint that supports it). The mint sets the smallest amount and the fee; the address can be paid more than once.
  The address belongs to a key made from the recovery seed and the quote's number (NUT-20), so only this wallet's 12 words can claim it. The app checks every 15 s while the screen is open and claims whatever was paid when it starts (`claimAll`); closing the screen loses nothing.
  The addresses (quote ids and numbers, no key and no coin) are also saved as a plain setting that the encrypted settings backup carries, and after *Restore my wallet* the same words own the addresses again, so a deposit that was never turned into ecash is claimed. An address that came from another phrase is never handed out again.
- **Sending and cashing out ecash.** *Account → Wallets → Send* (both apps; paused while a ride runs) sends money from the balance to another wallet, two ways.
  **Ecash token**: the app takes the amount out as a token (text starting `cashuB…`); the person pastes it into their ecash wallet (this app's *Add ecash you were sent* too). A token is cash: anyone with the text can take it.
  Until *Done* is tapped, *Take it back* asks the mint: if nobody has taken the token the money returns to the wallet; if it was taken, it is forgotten (`EcashWallet.reclaim`).
  **Lightning**: paste an invoice (it must name an amount) or a Lightning address with an amount; the mint pays it and charges a small fee on top (`EcashWallet.payInvoice`; too little money is refused before anything is spent; a failed payment keeps the ecash).
  **Automatically cash out at: $** (driver app, needs a cash out location): the driver types an amount; when the ecash held at a mint is worth that much, the app cashes out by itself to the cash out location (`features/ecash/useAutoCashOut.js`,
  rules in `lib/autocashout.js`). The choice is saved when the field is left or Enter is pressed (never on each key, so typing "15" cannot cash out at "1"); empty turns it off. It never runs during a ride, never without a price, waits 10 minutes after a failure
  and tells the driver once. It is kept per account on the device, in the currency that was current when it was set.
- **Safety of the wallet.** The proofs are saved on the device, encrypted (NIP-44) to the user's own key, in pieces. A token being sent waits in a *pending* list until the
  event carrying it is published or queued; after a crash it returns to the wallet if the mint still calls it unspent. One money move runs at a time. A token cannot be
  redeemed twice. The user can back up the wallet as tokens (*Back up my ecash*). Logging out keeps the ecash on the device; without the nsec it cannot be opened.
- **The ecash is kept on the device, so the app also gives a way back if the device is lost: see *Recovering the ecash (12 words)* below.**
- The mint charges a fee for spending proofs (`input_fee_ppk`). The **sender** adds it on top of each tick, so the driver gets the full tick.
- **Tips** are still paid over Lightning to the driver's Lightning address: from the rider's own ecash (the mint pays the invoice, for a small fee), or with the driver's invoice shown for any other wallet. There is no Lightning-wallet (NWC) connection any more.

### Recovering the ecash (12 words)
The proofs live only on the device. A lost phone would mean lost money, so every coin the wallet makes for itself gets its secret from a **recipe**: a 12-word
**recovery phrase** + the mint's keyset + a counter (Cashu NUT-13). The same 12 words on a new device ask the mint which coins it signed for them and
still calls unspent (NUT-09), and the money is back. No server, no account, no relay is involved.
- **The phrase is not the Nostr key.** People paste an nsec into many Nostr apps; if the money came from it, one leak anywhere could drain the wallet. The phrase is a standard
  BIP39 phrase made on the device from the browser's secure random source, when the person taps **Create New Wallet** (before any coin exists, so every coin is under it). Nothing makes a wallet by itself: a new phone has none until the person creates or restores one. Other Cashu wallets
  that follow NUT-13 can restore from it too.
- **Where it is kept.** On the device, encrypted (NIP-44) under its own key, made from the user's secret key with its own label (so it is a different key from the one that
  encrypts the proofs). It is never put in an event, never sent to a relay or the mint, and never logged. The app asks for the words only on the Recovery screen.
- **Writing it down** (*Account → Recovery phrase*, or the warning at the top of Account while there is ecash and the words are not written down): the 12 words are shown in a numbered list;
  the person types three of them back (asked by number) before the app counts the phrase as safe. The words can be shown again (they hide after 30 seconds). Ecash made before
  the phrase existed (random secrets) is swapped once for coins under the phrase when the phrase is confirmed.
- **Counters** (one per mint keyset) are saved with the wallet **before** the mint is asked, so a number is never used twice. A coin the mint signed but the wallet never saved
  (a crash, a closed tab) is found again by a restore.
- **Coins sent to someone else use random secrets.** A restore therefore never brings back a token that was already handed to a driver, and the driver can still redeem it.
- **Restore my wallet** (*Account → Wallets*, offered **only while this device has no wallet**): the person types the 12 words and names the mints to look in (the ones the app knows are listed already). The typed words **become this phone's wallet words**:
  nothing is swept into another phrase and there is nothing new to write down (the person has the words in hand, so they count as written down). For each mint the app scans every keyset, keeps the coins the mint calls unspent, and
  **swaps them for fresh coins under the same phrase** (a copy of the old coins on a lost phone is spent). **If no mint knows a coin for the words** (a typo that still passes the check, the wrong mint, a mint that did not answer) **everything is undone**
  and the phone stays without a wallet, so a wrong guess leaves nothing behind. **The last phone to restore holds the money:** another phone that still uses the same words loses its coins (it drops them the next time it asks the mint).
  A phone that already has a wallet does not offer Restore; to restore other words there, first *Disconnect ecash from this device*.
- **A device whose coins were moved elsewhere shows the truth.** The wallet asks the mint which of its coins are spent (when it opens and every 5 minutes) and drops them (`syncSpent`), so an old phone stops
  showing money that a restore on another device moved. The mint is asked without holding the money lock, so a slow mint never holds up a payment.
- **Disconnect ecash from this device** (*Account → Wallets*): for a phone you are about to lose, sell or stop trusting. The app drops spent coins, then **erases the coins, the counters and the recovery phrase from this device** and remembers that the wallet is disconnected.
  **Nothing is swapped at the mint.** The money stays at the mint and comes back with the 12 words (*Restore my wallet*). It is **refused** while a payment is being sent, and while there is money and the words are **not written down** (that money would be lost).
  It is not offered while a ride is running. While disconnected: a **driver cannot go online** and a **rider cannot confirm a driver** (nobody could be paid), and the ecash part offers **Create New Wallet** (new, empty, new 12 words) or **Restore my wallet** (the old 12 words bring the money back; that phone takes over).
  A copy of the old coins made before the disconnect stays spendable until someone moves the money: restoring on a safe phone swaps every coin there, which makes the old copies worthless.
- **Two devices with the same phrase** at the same time can pick the same counter. The mint then refuses ("already signed"); the app looks where the mint's records end, moves its counters past them
  and tries again. It does not take the other device's coins until the person restores there.
- **Limits.** The mint must support restore (NUT-09) and must still exist. A top-up invoice paid but not yet collected when the phone was lost is not covered. The list of payments is not restored.
  Whoever has the 12 words can take the ecash, so they belong on paper, not in a photo, a note or a cloud.
- Tests: `test/recovery.test.mjs` (words, the NUT-13 specification vector, the encrypted box), `test/restore.test.mjs` (the real Cashu client against a local mint that remembers what it signed:
  restore under a new phrase, a sent token not brought back, old copies spent, a stale device dropping spent coins, disconnect (wipe, no swap, refusals), a crash between "signed" and "saved", counters, two devices,
  old coins moved, no phrase on the wire), `scripts/e2e/recovery.mjs` (the screens, a fresh browser, new words, disconnect and connect, no phrase on any relay), `scripts/e2e/disconnect.mjs` (a driver's GO while disconnected).

### What is built and what is not
- Built and tested: ticks, the standard fare, missed-payment counting, the final tick, Finish ride with confirmation, the start code, the 150 m arrival rule, the
  GPS-gap rule, silence and sign-of-life events, extra stops, waivers, currencies, the ecash wallet, funding by invoice, cash out, rates frozen per ride.
- Tested against **a local test mint that does the real blind-signature maths** (`test/helpers/localmint.mjs`) with the real `@cashu/cashu-ts` client, and in a headless
  browser with a rider and a driver. **Not yet run against a public mint or on a phone.**
- Not built: automatic cash out, mint choice by the rider, multi-mint swaps (a rider with funds at another mint must add funds at the driver's mint), push when the app is
  closed, a dispute arbiter.

## During a trip (both apps)
- **The rider's ecash balance, live, above "Fare so far".** While riding, the rider's fare card starts with *Your ecash*: the wallet's balance at the mint that pays this ride, in the rider's currency (sats small). It
  changes by itself as each tick is paid. At **$5.00 or less** (US dollars at the live price; `LOW_BALANCE_USD`) the label and the amount turn **red**. It is a warning only: the ride is never stopped by it, and
  the "wallet is short" notice (when a payment cannot be made) is separate. (`lib/fare.js isLowBalance`, `rider/screens/OnTrip.jsx`.)
- **The estimated total sits below "Paid", on both screens.** The ride's estimated fare (the driver's own estimate for the trip) is a **dashed box with "≈"** under *Paid* (*Paid by the rider* on the driver's
  screen): the look says "estimate" before any word does. It used to be at the bottom of the sheet next to the route. Before the ride starts (while the driver is on the way) it still shows there. After a stop or a
  new destination is accepted, the box shows the new estimated total and a second muted line, for example *from the added stop ≈ +$2.67* (or *from the new destination*, or *from your changes*).
  (`ui/FareEstimate.jsx EstimatedTotal`, `lib/useFareEstimate.js`.) The exact numbers (fare so far, paid) never use the dashed look.
- **"Trip so far" counts the seconds** on both screens: `1.1 mi · 5 min 03 s` (under a minute `45 s`, over an hour `1 h 05 min 03 s`), also on the collapsed sheet's one line. The rider's screen redraws every second for it
  (`lib/meter.js fmtDurationSec`). The drive to the pickup and the waiting clock keep their own forms.
- **"Paid so far" lines next to the fare.** Under *Fare so far* and *Paid*, both apps show what has been paid until now, split by kind, and it grows through the ride:
  `Paid so far:` · `Base rate: $1.50` · `Miles: 3 ($3.30)` · `Minutes: 7 ($1.40)`. A mile or a minute counts once its payment is covered; one only partly paid adds the part that was paid to its
  amount but not to the count. After the ride, the receipt (rider) and the summary (driver) show the same lines, plus *End of ride:* for the settled rest of the last mile and minute. (`lib/ticks.js paidBreakdown`, `ui/FareBreakdown.jsx`.)
- **Nearly full-screen map.** Once a driver is confirmed, the trip card is tucked away: only a handle and one line
  (for example "Driver arriving in 5 min") show at the bottom. Drag the handle up, or tap it, to open the details; drag down or tap to close.
  The card opens by itself when the user has a step to take: the rider when the driver arrives (the start code is at the top of the card), the driver at the arrival
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
- **Add stop / update fare** (rider, while riding): the rider sees the estimated change in the fare; the driver accepts, or finishes the ride.

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
- The driver's request card shows the fare for this trip.
- Both screens use the trip as the request publishes it (miles to a tenth), so the cents match.

## The fare (each driver's own rates)
- The rider's quote screen shows the **estimated price** (the middle of the nearby drivers' fares, or the app's formula with no driver near) and the drivers nearby. The request carries
  `fareMode: "standard"` and the estimate (`fareSats`, in sats). A driver's reply is an offer with `mode: "metered"`: the price in it is only that driver's estimate, because the
  ride is paid tick by tick at the rates in the offer.
- **The rider names no price and a driver makes no counter-offer.** (Earlier versions had a *flat price*: the rider typed an amount and a driver accepted it or countered with a higher one.
  It was removed, together with `offerLimitsSats`, `offerLevel`, `replyKind`, `raiseOffer`, `convertToMetered`, `MIN_OFFER_USD` and `MAX_OFFER_FACTOR`.)
- The rider sees every reply with the driver's rates and estimate, with **Fastest** and **Lowest price** tags. Each reply shows the mint the driver is paid at.
- The money is in sats (`fareSats`). The local currency comes from the live BTC price.
- Reservations work the same way.

## Tips (optional, any time after the ride)
- A tip is **never asked for**. The receipt only has a quiet *Leave a tip (optional)* link. After the receipt is closed, the rider can still tip
  from **Activity → the past trip → Leave a tip**, at any time, and as often as they like.
- Quick amounts (1, 2, 5, 10 in the local currency, scaled for currencies with small units) or **Other** (any amount). The tip is paid over Lightning straight to
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
To go online a driver needs: face photo, vehicle year/make/model, **a vehicle photo** (one is enough; up to **3** can be added in *Vehicle & plate*), plate state and number,
(`driveGaps` in `src/lib/profile.js`). A cash out location (a Lightning address) is optional. No driver's license photo is asked for or stored.
The Account page and the checklist name each missing item (for example *Vehicle (year, model)*, *Vehicle photo*). After
*Save vehicle info* the app lists everything that is still needed.
The vehicle photos are saved as `picture` (the main one, which older apps read) and `morePictures` (up to two more) in the profile. Because a profile event must stay under the 64 KB many relays allow, a vehicle with several photos keeps each one small (about 12 KB);
riders see all of them in the driver's profile card and can tap one to enlarge it. Only small embedded images are accepted from other people's profiles.

## Architecture
```
user action ─▶ signed Nostr event ─▶ relays (and a local cache)
                                       │
relays ─▶ local cache ─▶ screens read it with relay.query()
```
- `src/state/AppContext.jsx` — shared state (`useApp()`): user, tab, ride requests, `publish`, notices, local currency and BTC prices, the ecash wallet (none until the person creates or restores one).
- `src/rider/state/RiderContext.jsx`, `src/driver/state/DriverContext.jsx` — role state.
- `src/lib/trips.js` — works out the current ride from events (`activeRideFor`, `activeDriveFor`, offers).
- `src/lib/rides.js` — the **trust rules** (who may finish a ride or mark a stage), and the trip counts.
- `src/lib/vouches.js`, `src/nostr/vouchSync.js`, `src/ui/VouchBadge.jsx`, `src/features/profile/VouchesSection.jsx` — the vouch list, the one-hop reading of it, the badge, and the Account section.
- `src/lib/ticks.js`, `src/lib/ridemoney.js`, `src/lib/payments.js`, `src/lib/finish.js` — the ticks, the saved ledger, the payment events, and the finish and silence rules.
- `src/nostr/ecash.js` (wallet bookkeeping), `src/nostr/cashuMint.js` (the only file that uses the Cashu client library, loaded on demand), `src/features/payments/` (paying and redeeming ticks, Add funds).
- `src/ui/Layout.jsx` — page structure: full-screen map with a bottom sheet, tab bar.

More detail for contributors is in `CLAUDE.md` (the file map and every invariant).

## Nostr events
| Kind | Name | Sent by | Purpose |
|---|---|---|---|
| 0 | Metadata | anyone | Name, photo, Lightning address, vehicle (plate sealed), driver gender, driver rates |
| 30078 | Ride request | rider | Coarse pickup/dropoff, `fareMode` (always `standard`; an older `flat` is read as standard), the estimate (`fareSats`), the suggested price, sealed exact trip |
| 30079 | Ride offer | driver | Accept: the driver's estimate, `mode` (`metered`; an older `flat` is read as metered), the driver's `rates` (frozen when chosen), `mint`, trip miles and minutes, ETA, estimate, optional gender, sealed plate |
| 30080 | Ride accept | rider | Confirms a driver; exact trip sealed to the driver |
| 30081 | Ride finish | rider or assigned driver | Ends a ride: who, why (`rider`, `driver`, `destination`, `unpaid`, `silence`), the time, the meter (miles, minutes), and whether the driver was at the destination |
| 30082 | Rating | — | **Unused.** Star ratings and reviews were removed (they are too easy to fake). Old events are ignored |
| 30084 | Ride complete | assigned driver | Older apps' way to end a ride at the destination (still read as a finish) |
| 30085 | Ride stage | assigned driver | `arrived` / `riding` |
| 30086 | Payment record | rider | Lightning payment proof (invoice, preimage, LUD-21 URL) sealed to the driver; phase `tip` (older rides: `deposit`, `rest`) |
| 30087 | Rider confirmation | rider | `code` (typed the 4-digit start code shown on the driver's phone), `ended`, or `problem` (with a note); older rider apps also sent `boarded` |
| 30093 | Pickup change | rider | A new pickup while the driver is on the way; the exact place sealed to the driver and the rider |
| 30094 | Pickup change answer | assigned driver | Accept or decline that change |
| 30095 | Tick | rider | One ecash payment while the ride runs: amount and what it was for (public), the Cashu token (sealed to the driver) |
| 30096 | Tick reply | assigned driver | "Received" (with the sats received) or a final refusal from the mint |
| 30097 | Waiver | assigned driver | Part of the fare waived: sats forgiven, sats sent back (an ecash token sealed to the rider), a reason |
| 30098 | Sign of life | rider or assigned driver | "Still riding" / "Still driving": a signed sign that the other person is there |
| 30099 | Stop change | rider | Add a stop or change the destination; the new place sealed to the driver and the rider |
| 30100 | Stop change answer | assigned driver | Accept the extra stop (the driver's other choice is to finish the ride) |
| 30101 | Offer declined | rider | "No thanks" to ONE driver's offer; the request stays open for everyone else. Only the ride's rider counts |
| 30102 | Vouch list | anyone | "Your vouches": one `p` tag per person they know and trust (`d` = `vouches`, at most 100). Public. The newest list replaces the old one |
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
- The **ecash token** in a tick is sealed to the driver; the **start code** is never sent (each phone works it out from a shared secret); a **refund token** is sealed to the rider.
  The tick **amounts** are public, like tips. The ecash wallet is saved on the device encrypted to the user's own key.
- The mint sees the amounts it signs and redeems, not who the people are (blind signatures). It can see which IP address asks.
- A driver who is online shares a location rounded to about 100 m. The exact position goes only to the matched rider.
- Requests, fares, offers and notes are public on the relays you use.
- Your **vouch list** is public: anyone can see which npubs you know and trust.
- Looking up an address from GPS sends the position (rounded to about 10 m) to the Photon geocoder.

## Payments
Payments are **peer to peer, with no escrow and no deposit.** The full rules are in [Pay as you ride](#pay-as-you-ride-ecash-and-finishing-a-ride). In short:
- **During a ride** the rider pays the driver in **ecash** ticks (base, each mile, each minute, a final part). The driver redeems each one at the mint at once.
- **Lightning** is used to **fill the ecash wallet** (the mint's invoice, paid by any wallet), to **cash out** (the driver's wallet takes a Lightning payment
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
- The driver app keeps the screen awake while online or driving (browsers stop GPS when the screen sleeps). The rider app keeps it awake while a ride is running (a sleeping page stops paying the ticks, see [Missed payments](#missed-payments)).
- ETAs use the road time from the router, with a straight-line guess as a fallback.
- Browsers cannot track location in the background. The [native app](#native-app-and-background-gps) can.
- **I've arrived works only within 150 m of the exact pickup, on a good fix.** At the same distance from the pickup (or the next stop or destination) the app shows a notice and highlights the next step. It never acts for the driver.
- A **GPS gap** (a tunnel) of up to 10 minutes is filled with a straight line between the fixes around it; after more than 10 minutes tracking restarts at the new fix without adding the missing miles.

## Safety
Rider app, on a trip, behind the **Safety** button:
- **Check before you get in.** When the driver arrives, the rider sees the plate, car and driver photo and checks them by eye; the screen says what to do if they do not match (do not get in, use *Safety*). There is no *It matches* button any more. (An older rider app may still send a `boarded` confirmation, kind 30087; the driver app still reads it and will not start a trip after a "did not match".)
- **Call emergency services.** Dials `EMERGENCY_NUMBER` (default 911, in `src/config/settings.js`).
- **Share my trip.** Makes a link. A friend opens it in any browser (`track.html`, no account) and sees **the rider's own position live** (the rider's phone, a blue dot; the car too until the ride starts), the driver, the car and plate, the destination, and the stage. The rider's app sends a position **every 6 seconds** (`LOCATION_PING_MS` in `src/config/settings.js`), the same pace as the driver's app sends the car's position to the rider. A position that is stale (no fresh GPS fix) is left out, so a friend never sees an old position as if it were now. How it works: the rider's app makes a throwaway key for the trip and publishes the state encrypted with that key; the key lives only in the link's `#fragment`, which browsers never send to a server. Updates expire after 2 hours. Sharing stops by itself when the trip ends, or when the rider taps Stop.
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

## Vouches ("I know and trust this person")
The app has **no star ratings and no reviews**, because both are easy to fake. The only kind of reputation is a **vouch**: "I know and trust this person."
- In *Account → Your vouches* ("Add the npub of people you know and trust, whether they ride or drive. See the documentation to understand how they work.") a person pastes the **npub** of each person they know and trust (a `nostr:` link or 64 hex digits also work; an **nsec is refused**). Remove a person with *Remove*. A list holds up to 100 people.
- A vouch is for **the person**. It counts the same when that person rides and when that person drives.
- **What you see.** Say you are B. When you look at a driver or a rider A (an offer, a request card, a profile), the badge counts the people **in your list who have A in their list**:
  - one: "1 of your vouches knows and trusts this person"; two or more: "2 of your vouches know and trust this person". Tap the badge to see their names.
  - A is in your own list: "You know and trust this person" (with the count first, when others in your list vouch for A too).
  - Nobody you vouch for vouches for A: **nothing shows**. There is no "0" and no warning. A stranger is not marked bad; they are just not vouched for.
- **One hop only.** A vouch from someone you did not choose never shows, so a crowd of fake accounts that vouch for each other changes nothing on your screen. A vouch of a vouch of a vouch is not counted either.
- **How it travels.** A list is one public, replaceable event (kind 30102, `d` = `vouches`). The app reads only your list, then the lists of the people in it, and their names (three small relay questions at login, then every 5 minutes and after each change to your list).
- **Public.** Anyone who reads the relays can see who you vouch for. The Account screen says so.
- The trip counts on a profile ("12 trips") stay. They are plain facts from signed events, not opinions. Old rating events (kind 30082) on the relays are ignored.

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
- That opens a **list**, closest first. Each row shows: pickup area, dropoff area, the fare (the driver's own estimate), the drive time to the rider,
  the trip distance, the trip's drive time, the pick-up time for a reservation, and the rider's note. Tapping a row opens the request (Accept / Decline); closing it returns to the list.
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
| App rates (the fallback: base $1.50, $1.10 per mile, $0.20 per minute), driver-rate limits, the low-balance warning (`LOW_BALANCE_USD`, $5), timers, demo data | `src/config/settings.js` |
| Tick rules: grace time for a missed payment (30 s), missed-payment limit (2) | `src/lib/ticks.js` |
| Silence rules (10 minutes), arrival distance (150 m), start-code lock | `src/lib/finish.js`, `src/lib/arrival.js`, `src/lib/startcode.js` |
| The ecash mint a new driver starts with | `VITE_DEFAULT_MINT` in `.env` (default in `src/config/services.js`) |
| Supported currencies | `src/lib/currency.js` |
| Relays | `src/config/relays.js` (also editable in the app) |
| Map tiles, address search, routing | `.env` (see `env.example`); defaults in `src/config/services.js` |
| Emergency number, arrival radius | `src/config/settings.js` |
| Colors | `src/theme.js`, Tailwind classes (built into the app's CSS: `tailwind.config.js`, `src/tailwind.css`) |

## Testing
`npm test` runs `test/*.test.mjs` with Node's built-in runner: trust rules, ride stages, finishing a ride (who may finish, earliest finish wins, the silence cut-off), fares, trips,
earnings, privacy, history, Lightning invoices, geocoding, publishing and the outbox, event ordering, contact links, GPS, payment evidence, blocking, trip sharing, native location, tips,
pickup changes, the odometer (and the GPS-gap rule) and the 5% distance rule, stage times, relay subscription calls, old flat offers read as standard, driver rates and currencies, exact amounts, gender
ordering, driver requirements, expiry of unmatched requests, blocking both ways, declined offers (`requests`), **the recovery phrase and getting the ecash back from it (`recovery`, `restore`)**, **vouches (reading an npub, the list event, the one-hop badge, its words, the sync)**, **the tick schedule, missed payments, the final tick, the start code, the 50 m arrival rule, silence and sign-of-life
rules, waivers, extra stops and frozen rates, the ecash wallet (funding, paying, redeeming, crash recovery, cash out, paying an invoice, taking a token back, encrypted saving), the automatic cash out rules (`autocashout`), a whole ride's money between a rider and a
driver, and the real `@cashu/cashu-ts` client against a local test mint that does the real blind-signature maths**.

The apps were also run end to end in a headless browser (a rider and a driver playing a whole ride through a local relay and the local test mint): funding with an invoice, the request,
the offer, the confirm screen, the 150 m arrival lock, the 4-digit start code typed by the rider, the base, minute and mile ticks, Finish ride with its confirmation, the receipt and summary, missed
payments, a refill after the ride, and a waiver with a refund. The vouch badge was run the same way (`scripts/e2e/vouches.mjs`: a friend's list, the badge on a request card and on an offer, an nsec refused, Remove). That harness is in `scripts/e2e/` (it needs `npm i --no-save ws playwright`; it is not part of `npm test`).
**Never run against a public mint, and never on a real phone.**

## Deploying
`npm run build` makes `dist/`. Put it on any static host (for example `ride.example.com`); it works from any sub-path. Use `https://` (location needs it). Each app keeps its own
saved key in the browser.
The built pages carry a Content-Security-Policy (`<meta>`, `csp.mjs`). If the host lets you set headers, also send `Content-Security-Policy: frame-ancestors 'none'` (a `<meta>` tag cannot set it) so the pages cannot be framed by another site.
A host that adds its own scripts to pages (an analytics snippet, for example) will be blocked by the policy: that is on purpose.

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
- Two devices that share one recovery phrase and spend at the same time can pick the same counter. The app recovers by itself (it skips ahead), but the second device does not see the first device's coins until the person runs Restore.
- Funds are held per mint. A rider with ecash at another mint must add funds at the driver's mint (no swap between mints yet).
- No in-app chat; the Contact sheet shows the other person's Signal, Telegram or phone.
- No push notification when the app is closed (needs a push server).
- Vouches are not checked by anyone: a person can vouch for anyone. They only count for you when someone **you** chose vouches. The list is public, and there is no way to vouch in private yet.
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
- **Create New Wallet / Restore my wallet; no Lightning wallet (NWC); Units under Appearance** — (1) **Nothing makes an ecash wallet by itself any more.** A new phone shows, in *Account → Wallets*, **Create New Wallet** (a warning first: the 12 words are the only way to get the money back; then the words are shown at once) and **Restore my wallet** (type the 12 words from another phone). Until there is a wallet a rider cannot choose a driver and a driver cannot go online; those screens say so and a button opens Wallets (`WalletPrompt`). A phone that already had a wallet is simply "on". (2) **Restore adopts the typed words, no sweeping:** the words become that phone's words, the unspent coins are found at the mints (NUT-09) and swapped for fresh coins under the same phrase, and nothing new has to be written down. If no mint knows a coin for the words, everything is undone. Restore is offered only while the phone has no wallet. (3) **The Lightning wallet (NWC) is removed:** Add funds shows the mint's invoice for any wallet, and a tip is paid from the rider's ecash or with the driver's invoice shown for another wallet. (4) *Units* moved from its own section into *Appearance*. (Ported from trevthom/nostr-ride, where the two apps became one app with a Ride / Drive switch; this standalone app stays as it was otherwise.)
- **Wallets, settings saved for you, two dark switches, on-chain funding, 3 vehicle photos** — (1) *Account → Wallets* (both apps) now holds the currency (first), the ecash wallet with **Add funds** and **Send** side by side ("Add ecash here before you ride."), the cash out location (now in the rider app too, and shared with the other app through the profile), and the Lightning wallet (NWC); the separate Ecash wallet, Currency, Cash out location and Lightning wallet sections are gone. A profile save now writes only the fields it changes (`profileContent`), so the two apps never write an old address, vehicle, rate or gender over each other. (2) The **Backup** section is gone: the encrypted note on the relays is always on (`useBackup` has no switch); the first note is sent when none exists. (3) **Dark Mode (application)** no longer darkens the map and has no description; **Dark Mode (map)** is a second switch for the map only (`dark-map`, `nostrride_darkMap`). (4) **Add funds on-chain** (NUT-30): a bitcoin address from the mint, claimed with a key from the recovery seed, only on mints that support it; addresses are kept in the backup; restore claims unclaimed deposits. (5) A driver can add **up to 3 vehicle photos**; one is needed to drive (`picture` + `morePictures`). (6) The *Your vouches* text is shorter. New: `lib/profilecontent.js`, `features/profile/WalletsSection.jsx`, `features/payments/OnchainFunds.jsx`, `EcashWallet.onchainStart/claimOnchain`, `vehiclePhotos`, `useDarkMap`; tests `onchain`, `profilecontent`, `vehiclephotos`, `appearance`; browser runs `scripts/e2e/wallets.mjs`, `appearance.mjs`. Not changed: the 12 words are still separate for each app (a shared set would have to be made from the nsec, which gives up the rule that a leaked nsec cannot reach the ecash).
- **Security fixes after an audit** — (1) A driver's answer "refused" no longer makes the rider pay the same payment again: the rider's app first takes its own token back from the mint; if the mint says it is spent, the payment counts as paid. (2) The distance in a finish event (and a distance reported live) is held to what the rider's phone can believe, and to what the clock allows; each ride has a spending cap (3 × the quoted fare, at least 10 US dollars) and stops with "Allow more"; a BTC price far from the last good one waits for confirmation. (3) A request that names a driver puts the driver on a ride only if the driver offered and the rider accepted (before, any stranger could make a driver's app send its live position). (4) The driver cannot start the meter alone: "riding" counts only after the rider typed the start code. (5) Agreed rates and mint never fall back to a newer offer; the estimated fare shown is worked out from the rates, not taken from the driver's number; a mint the rider has not used needs a yes before adding funds; refunds are accepted only at the ride's mint. (6) Requests go to vouched drivers first, then the nearest, then random ones, so fake drivers at the pickup cannot fill every place; presence time is bounded; block tokens can no longer be tested by strangers; a flood of gift wraps cannot freeze the app.
- **Sealed jobs** — Every job event (requests, offers, stages, ticks, payments…) is sent only inside NIP-44 gift wraps (kind 1059); relays cannot read kind, tags, places or prices. A request goes to the online drivers near the pickup; a driver who comes online later gets it from the rider's app, so the rider keeps the app open while waiting. Relays must accept and keep kind 1059. Also: total miles driven in the profile (self-reported in kind 0 `stats`).
- **Cash out location optional, a calmer address search, send ecash, automatic cash out** — (1) A driver no longer needs a cash out location to go online (the onboarding list and the gate dropped it; the section stays in Account). (2) The address search shows no button and no choice until a box is active; then the map button of that box is first and that box's 3 most recent places are below it (`recentPlaces(field, limit)` reads the rider's own earlier pickups and drop-offs). (3) *Account → Wallets → Send*: an ecash token for another wallet, or a Lightning invoice / address; *Take it back* returns an unclaimed token. (4) *Automatically cash out at* (driver app): a threshold; the app cashes out to the cash out location when the ecash reaches it. Tests: `ecash`, `autocashout`, `negotiation`; browser run: `scripts/e2e/send.mjs`, `nav.mjs`.
- **A live ecash balance, the estimate below "Paid", "Add stop / update fare" with an estimated change, seconds on the trip clock, new default rates** — (1) The rider's fare card starts with *Your ecash* (the wallet's balance at the ride's mint, live), red at $5.00 or less. (2) The estimated total moved from the bottom of the sheet to a dashed "≈" row below *Paid* on both screens; the old place shows it only before the ride starts. (3) *Add a stop or change the destination* is now **Add stop / update fare**: after the rider picks a place the modal shows the estimated change in the fare (dashed, ≈, for example *≈ +$2.40 · +1.8 mi · +4 min*; negative for a shorter way), the driver's request card shows the same, the rider's pending note shows it, and after the driver accepts the estimated total is priced again for the new route with a muted *from the added stop ≈ +$…* line. (4) *Trip so far* shows seconds on both screens. (5) The app's default rates are now **$1.50 base, $1.10 per mile, $0.20 per minute** (were $2.00 / $1.10 / $0.25): `FARE_RATES` in `config/settings.js`; the start amount with the defaults is $1.50 + 2 × $0.20 + $1.10 = **$3.00**. New: `lib/useFareEstimate.js`, `ui/FareEstimate.jsx`, `fareChangeSats`, `isLowBalance`, `fmtDurationSec`, `test/tripcard.test.mjs`; the `ride` and `stop` browser runs check all of it.
- **No "It matches" button; the start-code field is at the top; apps say which commit they came from** — the rider no longer taps *It matches* / *Doesn't match* to confirm the car: the driver's photo, car and plate are on the screen and the rider checks them by eye (the screen says: if they do not match, do not get in; use *Safety*). The 4-digit start-code field is now on the arrived screen at once, at the top of the sheet (it was hidden behind that button and below the fold on a small phone). The driver app still reads a `boarded` confirmation from an older rider app. The service worker cache is renamed (`nostrride-v2`) and a page reload asks the server for a fresh page, so no phone keeps an old copy of the app. The exported apps now show *version <time> · from nostr-ride <commit>* at the bottom of Account, so a person can see at once whether the rider and the driver app are from the same commit (a rider app from before the single 4-digit code shows a 2-digit code on both phones and a narrow box: that is an old build, not this code).
- **Dark mode, a password eye, "Cash out location", no flat price, a wide start-code field** — (1) *Account → Appearance → Dark mode* in both apps, saved the moment it is flipped; the colors are CSS variables, the map is darkened, a first-paint script avoids a white flash. (2) Every password field
  has a show/hide eye (the Unlock page too). (3) The driver's *Lightning address* section is now **Cash out location** (its helper line is just "Lightning address"; the onboarding list says the same); the *Ecash wallet* section no longer opens with "Riders pay you in ecash…" on the
  driver app. (4) **The flat price and the counter-offer are gone**: the rider no longer names a price, a driver no longer counters, and an extra stop no longer converts anything (the fare is always the driver's rates, tick by tick). Removed: `offerLimitsSats`,
  `offerLevel`, `replyKind`, `raiseOffer`, `convertToMetered`, `clampToFlat`, `MIN_OFFER_USD`, `MAX_OFFER_FACTOR`, `STOP_NOTE_FLAT`, the flat tests and `FLAT=1` in the e2e run. A request or offer from an older app that says `flat` is read as the standard fare. (5) The 4-digit start code
  field had room for two digits on a phone: the *Confirm* button was `w-full` in the same flex row and squeezed the field. The field now takes the whole width and the button sits below it (a new e2e check measures that all four digits fit). The driver already typed nothing; that is now stated and
  checked (`input[inputmode=numeric]` must not exist on the driver's screen). (6) **"Needed to start" is explained**: it is the base rate + 2 minutes + 1 mile (default rates: $2.00 + $0.50 + $1.10 = $3.60), a cushion so the first payments are never late; the confirm screen shows the sum and says nothing is locked
  away. (7) The driver no longer sees "That ride is no longer available" in the moment the rider chooses *that* driver (the notice now waits 4 s for the accept to arrive).
- **"Paid so far" lines: base rate, miles and minutes** — the fare card of both apps (and the rider's receipt and the driver's summary) now shows four lines near the fare: `Paid so far:`, `Base rate: $x.xx`, `Miles: # ($x.xx)`, `Minutes: # ($x.xx)`, so the totals can be followed all through the ride. They are worked out from the ride's saved list of payments (`paidBreakdown`: what the driver confirmed covers the ticks in the order they fell due). On the driver's phone the fare card now comes before the trip meter, so the lines are not hidden under the pinned *Finish ride* button. Tested in `test/ticks.test.mjs`, and `scripts/e2e/ride.mjs` checks the lines on both screens.
- **Phone screens** — the apps are now fitted to the phone. Found by playing a whole ride in a 360×640 and a 320×568 browser and reading the screenshots: the pickup and drop-off fields ran off the right edge of the search page (the flex child had no `min-w-0`), the main button of most sheets was below the fold (the driver's *Accept*, with its 45-second timer, too), three stacked notices covered half of the driver's screen, the three buttons of the rider's trip sheet wrapped, and the map's credit line sat on top of the sheet's buttons. Now: `StickyActions` pins the main button at the bottom of the sheet (scrolls normally in landscape); the search fields fit (the *Your location* button is an icon under 380 px); at most two notices; the credit line sits above the sheet; fields are 16 px on touch screens (iOS does not zoom); `interactive-widget=resizes-content` so the keyboard shrinks the page; the frame uses `dvh` with a fallback and respects the side safe areas; text is not inflated in landscape. The desktop column is unchanged. New: `E2E_VIEWPORT` for the browser tests.
- **One 4-digit start code, typed only by the rider** — before, each phone showed a 2-digit code and each person typed the other's. Now the **driver's** phone shows one random 4-digit code (10,000 possibilities; the lock after three wrong tries stays) and the **rider** types it; the driver types nothing, and *Start trip* unlocks when the rider's signed *code* confirmation arrives. The code is still worked out on both phones from the shared secret and never sent. The driver's code card is the first thing on the driver's sheet at the pickup. `startCode(sk, otherPubkey, rideKey)` lost its `role` argument. The `codes` field of the *riding* marker keeps its name and now means "the start code was checked".
- **I've arrived works within 150 m (was 50 m)** — `ARRIVE_MAX_METERS` is 150, so a driver who has stopped at the kerb or in a car park near the pin can mark arrival; the rider's own check of a claimed arrival is now 300 m (was 150 m), and the driver's *You're at the pickup* notice and the button work at the same distance.
- **The rider's phone no longer stops paying when the screen locks** — a rider with a full wallet showed up on the driver's screen as "missed payments". Cause: only the driver app held a screen wake lock. In the rider app the 3-second payment timer froze as soon as the phone's screen went dark (a web page's timers stop), so after the base tick no minute or mile tick was paid until the rider looked at the phone again, while the driver's app, awake, counted them as missed after 30 s (two missed payments let the driver finish the ride). Reproduced with the real money code (`test/rideflow.test.mjs`, section 11): base paid, then no payments → the driver sees "missed 2" and about 2 dollars open with a full wallet; one payment on waking clears it. Now the rider app holds the wake lock while a ride is `in_progress` (`RiderContext`), pays at once when the page wakes (`visibilitychange`, `online`), and `OnTrip` says *Keep this app open on your screen* when the browser will not give the lock. `useWakeLock` now returns true when the lock is unavailable.
- **Disconnect ecash from this device; a restore moves the money under the device's own new words; old phones stop showing moved money** — *Account → Ecash wallet → Disconnect ecash from this device* swaps every coin for a new one (a copy taken earlier is worth nothing), then erases the coins, the counters and the recovery phrase from the device; it is refused while a payment is being sent or while there is money and the 12 words are not written down; if a mint cannot be reached for the swap the person may go on anyway. While disconnected a driver cannot go online and a rider cannot confirm a driver, and *Connect ecash wallet* makes a new empty wallet. Restore changed too: it no longer takes over the typed words; the coins are swapped under THIS wallet's own phrase and the typed phrase is left empty (so a leaked phrase or a compromised lost phone cannot take the money again), and the app asks for the new words at once. A device whose coins were moved elsewhere now asks the mint at start and every 5 minutes and drops the spent coins, so it stops showing them (`syncSpent`). New: `EcashWallet.syncSpent/wipe`, `recovery.disconnect`, `forgetWallet`, `ecashOff/connectEcash/disconnectEcash` in `useApp()`, `scripts/e2e/disconnect.mjs`.
- **Default mint is Minibits again; a mint address is checked; no more page dump** — `https://macadamia.cash` is the website of the Macadamia iOS wallet, not a mint: every mint request got a 404 web page, and adding funds showed that whole page as the error. The default mint is `https://mint.minibits.cash/Bitcoin` again (`src/config/services.js`; `VITE_DEFAULT_MINT` still overrides it). Now the Cashu adapter turns an answer that is a web page into a short reason ("… is not a Cashu mint: it answered with a web page. Check the mint address."), and *Account → Wallets → Save* asks the mint first (`ecash.checkMint`) and refuses an address that is not a mint. Tested against a local server that answers like that website (`test/cashu-adapter.test.mjs`).
- **No script from another site runs in the apps: Tailwind is built in, and the pages carry a Content-Security-Policy** — both apps used to load Tailwind from `https://cdn.tailwindcss.com` as a script. A script runs with full access to the page, so the CDN (or anyone who got into it) could have read the secret key, the ecash and the recovery phrase. Now Tailwind CSS v3 is a normal build step (PostCSS in `vite.config.js`, `tailwind.config.js`, `src/tailwind.css`) and the styles are one CSS file the app hosts itself. `vite build` also adds a Content-Security-Policy `<meta>` (`csp.mjs`) to every page: scripts only from the app's own files, no inline script, no `object`, no `<base>`, no form posts; network connections stay open to `https:`/`wss:` because relays, mints and Lightning servers are on addresses the person chooses. The dev server is not affected. Class names must now be written out in full (the old CDN also found names built from pieces at run time); the browser tests print any class name on screen without a rule. Tailwind v3 is pure JavaScript, so the old reason for keeping it out of `package.json` (v4's native binary) does not apply; v4 and `@tailwindcss/vite` are still not to be used. The Inter font still loads from Google Fonts. `frame-ancestors` cannot be set from a `<meta>` tag: set it as a header on the host if the pages must not be framed.
- **Pin the drop-off on the map too** — the search page has a second button, *Set drop-off on the map* (next to *Set pickup on the map*). It opens the same full-screen map with a fixed pin (the pin starts at the drop-off already chosen, else near the pickup); the address of the spot is looked up and shown, and *Confirm drop-off* sets the place. With both places set the quote opens. Back from the pin page keeps what was chosen. `components/PinPicker.jsx` takes a `field`; the plan state has `pinField`. `scripts/e2e/nav.mjs` covers it.
- **A 12-word recovery phrase for the ecash, and collapsible Account sections** — the ecash lives on the device, so a lost phone used to mean lost money. Now every coin the wallet makes for itself gets its secret from a recipe (a BIP39 phrase + the mint's keyset + a counter, Cashu NUT-13), and the 12 words on a new device find the coins again at the mint (NUT-09) and swap them for fresh ones, so a copy on the lost phone is worth nothing. The phrase is its own secret (not the nsec), kept encrypted on the device and never sent anywhere; the person writes it down and types three words back; a warning shows at the top of Account while there is ecash and the words are not written down. Counters are saved before the mint is asked; coins sent to a driver use random secrets (a restore never brings them back); a second device with the same phrase skips ahead past used counters; old coins are moved under the phrase once it is confirmed; words that find nothing never replace the wallet's own phrase. New: `lib/recovery.js`, `nostr/seedbox.js`, `nostr/ecashRecovery.js`, `features/ecash/RecoverySection.jsx` + `RestorePanel.jsx`, NUT-09 in the local test mint, `test/recovery.test.mjs`, `test/restore.test.mjs`, `scripts/e2e/recovery.mjs`. `@cashu/cashu-ts` is now pinned to an exact version and `@scure/bip39` is a dependency. Every section on both Account screens is now a **fold** (`ui/Fold.jsx`): closed at first, a tap opens it, what you opened is remembered on the device, and a closed section keeps what was typed in it. The vehicle and Lightning address sections of a driver who still needs them start open.
- **Vouches replace star ratings and reviews** — ratings and reviews are removed from both apps (they are too easy to fake): no stars after a ride, none on profiles, no review text. The only reputation is now a **vouch**, "I know and trust this person". *Account → Your vouches* holds the npubs a person knows and trusts (an nsec is refused; up to 100; the list is public, kind 30102). When someone **you** vouch for also vouches for a driver or a rider, their card shows "N of your vouches know and trust this person" (one hop only; tap for names; "You know and trust this person" when they are in your own list). A vouch is for the person, in either role. Nothing shows for a person nobody you vouch for knows. Trip counts stay as plain facts. Old rating events are ignored; kind 30082 is unused. New: `lib/vouches.js`, `nostr/vouchSync.js`, `ui/VouchBadge.jsx`, `features/profile/VouchesSection.jsx`, `test/vouches.test.mjs`.
- **Shared trips show the rider, every 6 s** — "Share my trip" now sends the rider's own phone position (it used to send the car's), and sends it every 6 seconds like the driver's pings (one shared `LOCATION_PING_MS`); before, the timer was 15 s and any car update forced a send. The car still shows until the ride starts. A stale fix is not sent. Older trip links keep working: an update from an older app is drawn as the car, as before.
- **Strike removed; default mint is Macadamia** — the optional Strike link (funding, tips, cash out and whole rides paid Strike to Strike) is taken out of `main` again (two revert commits; the code stays in the history). The ecash mint a new driver starts with is now `https://macadamia.cash`, set in `src/config/services.js`; `VITE_DEFAULT_MINT` still overrides it. The address was given by the owner and could not be checked from the build machine.
- **Reservations expire, blocking both ways, nearby list, gender, "No thanks"** — a reservation nobody takes closes 2 hours after its pick-up time (was 1), and logging out closes every request still waiting for a driver. Blocking hides people from each other on the map (hide tokens in requests and presence). *New request alerts* off now really stops the pop-up; the Drive tab keeps its count bubble and a new *See nearby requests* list shows pickup, dropoff, fare, time to the rider, trip distance, trip time and notes. The rider sees the driver's gender (if given) before choosing, and *No thanks* turns one driver down without closing the request (new kind 30101). Presence and trip-share relay pools wait 15 s for a connection.
- **Pickup is never automatic; cancel buttons; stale relay warning fixed; version line** — the pickup is no longer filled in from GPS. The search page asks for an address or a business name, always shows *Set pickup on the map*, and keeps *Your location* as a deliberate tap. *Cancel* (search), *Cancel and go home* (quote), and an X (quote, pin) return to the home screen; the pin page has the X too. The tab bar was checked on every rider screen with real styling. The "No relay accepted your request" warning no longer sticks after a retry succeeds: it shows only while the request still waits in the outbox after 15 s. A relay has 15 s to answer a publish, and the outbox banner needs a 20 s wait. Account shows the app version (build time and commit), so a person can tell which build a phone runs.
- **Rider navigation, pickup pin, approximate driver location, relay banner, no license photo** — the rider can pin the pickup on the map (drag the map under a fixed pin; the address is looked up). The back arrow on *Plan your ride* goes one screen back (it used to loop between the quote and the search page); an X on the search, pin and quote pages, and the *Ride* tab, cancel the planning and show the home screen. The bottom tab bar is always visible in both apps. A driver can go online and be shown on the map with an approximate location (accurate to 25 km or better); marking *I've arrived* still needs a good fix. The false "can't reach any relay" message is fixed: the relay test no longer uses (and breaks) the app's own connection, the pool waits 15 s for a connection, the banner needs a sustained outage that a separate test confirms, and sockets are renewed after a sleep or a network change. The driver's license photo is gone: no upload, no requirement, no event kind 30092.
- **Pay as you ride with ecash; Finish ride; start codes; local currency** — the rider pays the driver in ecash ticks while the ride runs (the base rate, each mile, each minute, a final
  part) from an ecash wallet filled with Lightning (any wallet); the driver redeems each tick at the mint and can cash out. **No deposit, no escrow, no cancellations and no cancel fees:**
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
- **Maps and GPS** — OpenStreetMap tiles; GPS quality checks (good / weak / stale); screen wake lock for drivers and for riders during a ride; road-time ETAs.
