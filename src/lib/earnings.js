// ════════════════════════════════════════════════════════════
//  EARNINGS — What a driver has earned, from completed drives.
//  The fare is the price the driver's offer carried (falling back to
//  the fare quoted in the request). Payment itself is peer-to-peer over
//  Lightning, so this is the agreed fare, not a wallet balance.
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { rideEnding, rideStatus, rideVersions } from "./rides.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

// Completed drives for `pubkey`: [{ request, fareSats, at }] newest first.
export function completedDrives(requests, pubkey) {
  return requests
    .filter((r) => parse(r)?.driverPubkey === pubkey && rideStatus(r) === "completed")
    .map((request) => {
      const ids = rideVersions(request).map((e) => e.id);
      const offer = relay
        .query({ kinds: [EVENT_KINDS.RIDE_OFFER], authors: [pubkey], "#e": ids })
        .sort((a, b) => b.created_at - a.created_at)[0];
      const fareSats = parse(offer || {})?.priceSats ?? parse(request)?.fareSats ?? 0;
      return { request, fareSats: Number(fareSats) || 0, at: rideEnding(request)?.at || request.created_at };
    })
    .sort((a, b) => b.at - a.at);
}

// Totals since local midnight, 7 days ago, and ever. `nowMs` is injectable for tests.
export function summarizeEarnings(drives, nowMs = Date.now()) {
  const startOfDay = new Date(nowMs);
  startOfDay.setHours(0, 0, 0, 0);
  const sum = (since) => {
    const list = drives.filter((d) => d.at * 1000 >= since);
    return { sats: list.reduce((s, d) => s + d.fareSats, 0), trips: list.length };
  };
  return { today: sum(startOfDay.getTime()), week: sum(nowMs - 7 * 86400000), all: sum(0) };
}
