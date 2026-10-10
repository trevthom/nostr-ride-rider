// ════════════════════════════════════════════════════════════
//  DEMO DATA — Optional fake data so the app isn't empty on first
//  run. Toggle it on/off with USE_DEMO_DATA in config/settings.js.
//  Demo requests carry a ["demo","1"] tag; replies to them (offers)
//  stay in the local cache and never go to the public relays.
// ════════════════════════════════════════════════════════════

import { relay } from "./relay.js";
import { EVENT_KINDS } from "./eventKinds.js";
import { createNostrEvent } from "./events.js";
import { generateKeypair } from "./keys.js";
import { USE_DEMO_DATA } from "../config/settings.js";

// A few pretend users to populate the relay.
export const DEMO_USERS = [
  { ...generateKeypair(), name: "Alex Rivera", comm: [{ platform: "Signal", handle: "+1-555-0142" }] },
  { ...generateKeypair(), name: "Jordan Chen", comm: [{ platform: "Telegram", handle: "@jordanrides" }] },
  { ...generateKeypair(), name: "Sam Okafor", comm: [{ platform: "Signal", handle: "+1-555-0199" }] },
];

let seeded = false; // ensures we only seed once

export function seedDemoData() {
  if (seeded || !USE_DEMO_DATA) return;
  seeded = true;

  // Publish a profile for each demo user.
  DEMO_USERS.forEach((u) => {
    relay.publishLocal(
      createNostrEvent(
        EVENT_KINDS.METADATA,
        { name: u.name, about: "NostrRide user", communication: u.comm },
        [],
        u.publicKey
      )
    );
  });

  // Two open ride requests.
  relay.publishLocal(
    createNostrEvent(
      EVENT_KINDS.RIDE_REQUEST,
      {
        pickup: { name: "Downtown Transit Hub", lat: 38.04, lng: -84.5 },
        dropoff: { name: "Bluegrass Airport (LEX)", lat: 38.04, lng: -84.61 },
        time: "ASAP",
        notes: "Have one small suitcase",
        status: "requested",
      },
      [["d", "ride-demo-1"], ["t", "ride-request"], ["demo", "1"]],
      DEMO_USERS[0].publicKey
    )
  );

  relay.publishLocal(
    createNostrEvent(
      EVENT_KINDS.RIDE_REQUEST,
      {
        pickup: { name: "Fayette Mall", lat: 38.0, lng: -84.53 },
        dropoff: { name: "University of Kentucky", lat: 38.03, lng: -84.51 },
        time: new Date(Date.now() + 3600000).toISOString(),
        notes: "",
        status: "requested",
      },
      [["d", "ride-demo-2"], ["t", "ride-request"], ["demo", "1"]],
      DEMO_USERS[1].publicKey
    )
  );
}
