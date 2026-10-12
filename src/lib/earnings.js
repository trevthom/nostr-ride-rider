// ════════════════════════════════════════════════════════════
//  EARNINGS — What a driver has earned, from finished rides: the ecash payments
//  (ticks) the driver CONFIRMED, plus tips. Older rides, from before ticks, count
//  the price the driver's offer carried. This is a record of the rides, not a wallet balance:
//  the money itself is in the driver's ecash wallet (Account).
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { rideEnding, rideStatus, rideVersions } from "./rides.js";
import { tipsOf } from "./evidence.js";
import { paidSats, ticksOf } from "./payments.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

// Completed drives for `pubkey`: [{ request, fareSats, tips, tipSats, at }] newest first.
// `tips` are the optional tips the rider sent afterwards: [{ sats, at }].
export function completedDrives(requests, pubkey) {
  return requests
    .filter((r) => parse(r)?.driverPubkey === pubkey && rideStatus(r) === "completed")
    .map((request) => {
      const ids = rideVersions(request).map((e) => e.id);
      const offer = relay
        .query({ kinds: [EVENT_KINDS.RIDE_OFFER], authors: [pubkey], "#e": ids })
        .sort((a, b) => b.created_at - a.created_at)[0];
      const legacy = parse(offer || {})?.priceSats ?? parse(request)?.fareSats ?? 0;
      const fareSats = ticksOf(request).length ? paidSats(request) : legacy; // what actually arrived (older rides: the agreed price)
      const tips = tipsOf(request);
      return { request, fareSats: Number(fareSats) || 0, tips, tipSats: tips.reduce((s, t) => s + t.sats, 0), at: rideEnding(request)?.at || request.created_at };
    })
    .sort((a, b) => b.at - a.at);
}

// Totals since local midnight, 7 days ago, and ever. `nowMs` is injectable for tests.
export function summarizeEarnings(drives, nowMs = Date.now()) {
  const startOfDay = new Date(nowMs);
  startOfDay.setHours(0, 0, 0, 0);
  // A fare counts on the day the ride ended; a tip counts on the day it was sent.
  const sum = (since) => {
    const list = drives.filter((d) => d.at * 1000 >= since);
    const tips = drives.flatMap((d) => d.tips || []).filter((t) => t.at * 1000 >= since).reduce((s, t) => s + t.sats, 0);
    return { sats: list.reduce((s, d) => s + d.fareSats, 0) + tips, trips: list.length, tips };
  };
  return { today: sum(startOfDay.getTime()), week: sum(nowMs - 7 * 86400000), all: sum(0) };
}
