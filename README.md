# NostrRide Rider app 🚗⚡

The **rider** half of NostrRide, a decentralized ridesharing system on **Nostr**. The rider pays the driver in **ecash** (Cashu)
as the ride runs; **Lightning** and **NWC** fill and empty the ecash wallet. No central server, no database. Uber/Lyft-style: "Where to?", fare quote, find a driver, watch the car arrive, start with a 2-digit code, pay the driver in ecash as the ride runs, finish the ride, rate.

The other half is in its own repository: **nostr-ride-driver**. The two apps only talk through
Nostr relays, so they can be deployed separately.

> **Generated repository.** This is a copy of the rider app made from **trevthom/nostr-ride** by `scripts/export-apps.mjs`. Make changes in nostr-ride and export again: a hand edit here is overwritten by the next export.

## Run it
```bash
npm install
npm run dev     # http://localhost:5173
npm test        # automated checks
npm run build   # static site in dist/
```
Needs Node.js (LTS) and internet (Tailwind CDN, fonts, map, relays). Location needs `https://` or `localhost`.
To try a whole ride, run both apps and sign in with a different account in each.

## Try it on an iPhone (no Apple Developer Program)
Deploy `dist/` to any free https host, open it in Safari, then Share → **Add to Home Screen**. See
[`docs/index.md`](docs/index.md#trying-it-on-an-iphone-without-the-apple-developer-program).

## Docs
- [`docs/index.md`](docs/index.md): how it works, events, privacy, payments, safety, disputes, reliability, deploying, self-hosting maps.
- [`CLAUDE.md`](CLAUDE.md): file map and every invariant.
- `env.example`: use your own map, search and routing servers.
