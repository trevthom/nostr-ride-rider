// ════════════════════════════════════════════════════════════
//  TERMS — What a ride was agreed on, in the form lib/ticks.js needs.
//  They come from the driver's OFFER that the rider chose (the RIDE_ACCEPT names
//  that exact offer), so the driver's rates are frozen the moment the ride is
//  agreed: editing the rates later, or sending a new offer, changes nothing
//  for a ride that is already running.
//
//  An offer carries:  rates  { base, perMile, perMinute, currency }   (a copy, frozen)
//                     priceSats  the driver's estimate for the ride
//                     mint   the ecash mint the driver is paid at
//                     tripMiles / tripMinutes   the trip the estimate was made for
//  (An older offer with mode "flat" is read as the driver's standard fare at its rates: there are no flat prices any more.)
//
//    agreedOffer(request)    the offer event the rider chose (null before)
//    rideTerms(request)      normalized terms for lib/ticks.js (null before a driver is chosen)
//    rideMint(request)       the mint URL the driver is paid at
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { rideDriver, rideVersions } from "./rides.js";
import { acceptFor, offerFrom } from "./trips.js";
import { normalizeTerms } from "./ticks.js";
import { normalizeRates } from "./fare.js";
import { isMintUrl } from "./mints.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

export function agreedOffer(request) {
  const driver = rideDriver(request);
  if (!driver) return null;
  const accept = acceptFor(request, driver);
  if (!accept) return null; // no accept from the rider yet: nothing is agreed
  const id = parse(accept)?.offerId;
  if (!id) return offerFrom(request, driver); // an accept from an older app did not name the offer
  // The accept names ONE offer. If that offer is not in hand (not synced yet), nothing is agreed yet. The driver's
  // NEWEST offer is never used instead: a driver could replace the offer after the rider chose it, with higher rates
  // or another mint, and the replacement would reach the rider after a reload.
  const ids = new Set(rideVersions(request).map((e) => e.id));
  const chosen = relay.query({ kinds: [EVENT_KINDS.RIDE_OFFER], ids: [id] }).find((o) => o.pubkey === driver && o.tags.some((t) => t[0] === "e" && ids.has(t[1])));
  return chosen || null;
}

export function rideTerms(request) {
  const offer = agreedOffer(request);
  const c = offer && parse(offer);
  if (!c) return null;
  const rates = normalizeRates(c.rates);
  if (!rates) return null; // an old offer without rates: nothing to meter
  return normalizeTerms({ currency: rates.currency, base: rates.base, perMile: rates.perMile, perMinute: rates.perMinute });
}

export function rideMint(request) {
  const c = parse(agreedOffer(request) || { content: "{}" });
  return isMintUrl(c?.mint) ? c.mint : null;
}
