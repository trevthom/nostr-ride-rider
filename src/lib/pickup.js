// ════════════════════════════════════════════════════════════
//  PICKUP CHANGE — The state of a rider's request to change the pickup
//  while the driver is on the way. The rider proposes (kind 30093); the
//  driver accepts or declines (kind 30094). Until the driver accepts, the
//  first pickup stays in force (lib/privacy.js exactTrip does the swap).
//
//  Changing the pickup NEVER changes the miles or minutes already counted
//  for a cancellation: the trip meter and the cancellation clocks run on
//  signed events and the odometers, not on where the pickup is.
//
//    pickupChange(request) → { id, at, status, proposal } | null
//      status: "pending" (waiting for the driver) | "accepted" | "declined"
// ════════════════════════════════════════════════════════════

import { pickupProposals, pickupReplies } from "./privacy.js";

export const PICKUP_CHANGE_NOTE =
  "Changing the pickup does not change the miles or minutes already counted if the ride is cancelled.";

export function pickupChange(request) {
  const [newest] = pickupProposals(request);
  if (!newest) return null;
  const reply = pickupReplies(request).find((r) => r.changeId === newest.c.changeId);
  return {
    id: newest.c.changeId,
    at: newest.event.created_at,
    status: reply ? (reply.accepted ? "accepted" : "declined") : "pending",
    proposal: newest,
  };
}
