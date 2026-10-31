# NostrRide Rider app

This repository is the **rider** half of NostrRide. The **driver** app is **nostr-ride-driver**.
The apps share no server: they find each other through Nostr relays and use the same event formats.

## Commands
- `npm install` then `npm run dev` → http://localhost:5173
- `npm test` → Node's built-in test runner over `test/*.test.mjs` (no extra deps)
- `npm run build` → `dist/` (static files; relative paths)
- No linter configured.

## Shape
- `main.jsx`, `index.html` — the entry page. `track.html`/`track.jsx` — the page that follows a shared trip.
- `src/app/App.jsx` — the rider shell and its three rider tabs.
- `src/state/AppContext.jsx` — the shared key, profile, wallet, relays and settings.
- `src/rider/` — this app's screens and state.
- `src/features/`, `src/lib/`, `src/nostr/`, `src/ui/` — shared code.

## Rules
- This repository is rider-only: `src/app/App.jsx` mounts the rider shell; the driver app is separate. There is no Ride / Drive switch here.
- Never publish an exact address, a plate or a key in clear; read `docs/index.md` before touching money or privacy.
