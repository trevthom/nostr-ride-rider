# NostrRide Rider app 🚗⚡

The **rider** half of NostrRide, a decentralized ridesharing system on **Nostr**. The rider pays the driver in **ecash** (Cashu)
as the ride runs. There is no central server and no database. Uber/Lyft-style: "Where to?", fare quote, find a driver, watch the car arrive, start with a 4-digit code (the driver shows it, the rider types it), pay the driver in ecash as the ride runs, finish the ride.

The other half is in its own repository: **nostr-ride-driver**. The two apps only talk through Nostr relays,
so they can be deployed separately.

## Run it
```bash
npm install
npm run dev     # http://localhost:5173
npm test        # automated checks
npm run build   # static site in dist/
```
Needs Node.js 22.23.4+ (or 24.22.1+ on the 24 line) and internet (fonts, map, relays). Location needs `https://` or `localhost`.
To try a whole ride, run both apps and sign in with a different account in each.

## Docs
- [`docs/index.md`](docs/index.md): how it works, events, privacy, payments, safety, deploying, self-hosting maps.
- [`CLAUDE.md`](CLAUDE.md): the file map and the rules.
- `env.example`: use your own map, search and routing servers.
