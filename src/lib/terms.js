// ════════════════════════════════════════════════════════════
//  TERMS — What a ride was agreed on, in the form lib/ticks.js needs.
//  They come from the driver's OFFER that the rider chose (the RIDE_ACCEPT names
//  that exact offer), so the driver's rates are frozen the moment the ride is
//  agreed: editing the rates later, or sending a new offer, changes nothing
//  for a ride that is already running.
//
//  An offer carries:  mode   "metered" (the driver's standard fare) or "flat" (the agreed price)
//                     rates  { base, perMile, perMinute, currency }   (a copy, frozen)
//                     priceSats  the flat price, or the driver's estimate for a metered ride
//                     mint   the ecash mint the driver is paid at
//                     tripMiles / tripMinutes   the trip the price was made for
//  An accepted extra stop turns a flat ride into a metered one (lib/stops.js).
//
//    agreedOffer(request)    the offer event the rider chose (null before)
//    rideTerms(request)      normalized terms for lib/ticks.js (null before a driver is chosen)
//    rideMint(request)       the mint URL the driver is paid at
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { rideDriver } from "./rides.js";
import { acceptFor, offerFrom } from "./trips.js";
import { normalizeTerms } from "./ticks.js";
import { normalizeRates } from "./fare.js";
import { hasAcceptedStop } from "./stops.js";
import { isMintUrl } from "./mints.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

export function agreedOffer(request) {
  const driver = rideDriver(request);
  if (!driver) return null;
  const accept = acceptFor(request, driver);
  const id = accept && parse(accept)?.offerId;
  const chosen = id ? relay.query({ kinds: [EVENT_KINDS.RIDE_OFFER], ids: [id] }).find((o) => o.pubkey === driver) : null;
  return chosen || offerFrom(request, driver);
}

export function rideTerms(request) {
  const offer = agreedOffer(request);
  const c = offer && parse(offer);
  if (!c) return null;
  const rq = parse(request) || {};
  const rates = normalizeRates(c.rates);
  if (!rates) return null; // an old offer without rates: nothing to meter
  const flat = c.mode === "flat";
  const terms = normalizeTerms({
    mode: flat ? "flat" : "metered",
    currency: rates.currency,
    base: rates.base, perMile: rates.perMile, perMinute: rates.perMinute,
    flatSats: flat ? c.priceSats : undefined,
    tripMiles: c.tripMiles ?? rq.distanceMiles ?? 0,
    tripMinutes: c.tripMinutes ?? rq.durationMin ?? 0,
  });
  if (!terms) return null;
  return terms.mode === "flat" && hasAcceptedStop(request) ? { ...terms, mode: "metered" } : terms;
}

export function rideMint(request) {
  const c = parse(agreedOffer(request) || { content: "{}" });
  return isMintUrl(c?.mint) ? c.mint : null;
}
