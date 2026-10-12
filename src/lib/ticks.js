// ════════════════════════════════════════════════════════════
//  TICKS — Pay as you ride. There is no deposit and no escrow. The rider's
//  app pays the driver in small ecash payments ("ticks") while the ride runs:
//
//    base     once, when the ride starts (the driver's base rate)
//    mile     each full mile driven (the driver's rate per mile)
//    minute   each full minute that passes (the driver's rate per minute)
//    final    when someone finishes the ride: the part of a mile and of a
//             minute that is still unpaid, rounded to the sat
//
//  A flat price (the rider's counter-offer that the driver accepted) uses the
//  same ticks. Each rate is scaled so that the whole trip adds up to the flat
//  price, and the total never goes above it, so traffic and detours cost the
//  rider nothing more. Driving all the way to the destination pays the rest.
//
//  Money is counted in SATS. Each tick's sats are fixed when the tick becomes
//  due: the driver's rate (in the driver's currency) is turned into sats at the
//  BTC price of that moment. Both apps keep the same list (the LEDGER) from the
//  same signed times and the same meter, so they agree without talking.
//
//  The driver's rates come from the offer and are frozen for the ride.
//
//  Pure functions. A ledger is plain JSON, so each app saves it with the ride.
//    newLedger(startedAt, mode)
//    advanceLedger(ledger, { terms, nowMs, miles, price }) → ledger
//    owedSats / dueSats / missedTicks / settle / convertToMetered / milesAt
// ════════════════════════════════════════════════════════════

import { satsFromFiat } from "./currency.js";

export const GRACE_MS = 30000; // a tick counts as MISSED this long after it was due
export const MISSED_LIMIT = 2; // the driver may finish the ride after this many
const SAMPLE_EVERY_MS = 15000; // how often the ledger remembers the miles (for "up to the last signal")
const MAX_SAMPLES = 480; // two hours at one sample per 15 s
const MINUTE = 60000;

// terms = what the ride was agreed on (frozen when the driver is chosen):
//   { mode: "metered" | "flat", currency, base, perMile, perMinute,   (the driver's rates, major units)
//     flatSats?, tripMiles?, tripMinutes? }                            (flat: the price, and the trip it was priced for)
export function normalizeTerms(t) {
  if (!t || typeof t !== "object") return null;
  const n = (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
  const base = n(t.base), perMile = n(t.perMile), perMinute = n(t.perMinute);
  if (base == null || perMile == null || perMinute == null) return null;
  const mode = t.mode === "flat" ? "flat" : "metered";
  const out = { mode, currency: typeof t.currency === "string" ? t.currency : "USD", base, perMile, perMinute };
  if (mode === "flat") {
    const flat = n(t.flatSats);
    if (!flat || flat < 1) return null;
    out.flatSats = Math.round(flat);
    out.tripMiles = n(t.tripMiles) ?? 0;
    out.tripMinutes = n(t.tripMinutes) ?? 0;
  }
  return out;
}

// Sats for ONE base / mile / minute tick at `price` (BTC price in the terms' currency).
// Returns null when a metered ride has no price (the tick waits; it is not guessed).
export function unitSats(terms, price) {
  if (terms.mode === "flat") {
    const est = terms.base + terms.perMile * terms.tripMiles + terms.perMinute * terms.tripMinutes;
    if (!(est > 0)) return { base: terms.flatSats, mile: 0, minute: 0 };
    const share = (rate) => Math.floor((terms.flatSats * rate) / est);
    return { base: share(terms.base), mile: share(terms.perMile), minute: share(terms.perMinute) };
  }
  const base = satsFromFiat(terms.base, price), mile = satsFromFiat(terms.perMile, price), minute = satsFromFiat(terms.perMinute, price);
  return base == null || mile == null || minute == null ? null : { base, mile, minute };
}

export const newLedger = (startedAt, mode = "metered") => ({ v: 1, mode, startedAt, units: [], samples: [], final: null });

export const owedSats = (ledger) => ledger.units.reduce((s, u) => s + u.sats, 0) + (ledger.final ? ledger.final.sats : 0);
export const dueSats = (ledger, paidSats) => Math.max(0, owedSats(ledger) - Math.max(0, paidSats || 0));

// A flat ride never owes more than its price.
function clampToFlat(terms, ledger, sats) {
  if (terms.mode !== "flat") return sats;
  return Math.max(0, Math.min(sats, terms.flatSats - owedSats(ledger)));
}

// Add every tick that has fallen due by now. Safe to call as often as you like: a tick is added once.
// `miles` = the trip distance both screens show (lib/meter.js). Returns the same ledger when nothing changed.
export function advanceLedger(ledger, { terms, nowMs, miles, price }) {
  if (!ledger || ledger.final || !terms || !Number.isFinite(ledger.startedAt) || nowMs < ledger.startedAt) return ledger;
  const per = unitSats(terms, price);
  const have = new Set(ledger.units.map((u) => u.id));
  const add = [];
  let next = ledger;
  const push = (id, kind, at, sats) => {
    if (have.has(id) || sats == null) return;
    const clamped = clampToFlat(terms, { ...next, units: [...ledger.units, ...add] }, sats);
    have.add(id);
    add.push({ id, kind, at, sats: clamped });
  };
  if (per) {
    push("base", "base", ledger.startedAt, per.base);
    const minutes = Math.floor((nowMs - ledger.startedAt) / MINUTE);
    for (let k = 1; k <= minutes; k++) push("min-" + k, "minute", ledger.startedAt + k * MINUTE, per.minute);
    const whole = Number.isFinite(miles) && miles > 0 ? Math.floor(miles + 1e-9) : 0;
    for (let j = 1; j <= whole; j++) push("mile-" + j, "mile", nowMs, per.mile);
  }
  const last = ledger.samples[ledger.samples.length - 1];
  const sample = Number.isFinite(miles) && (!last || nowMs - last.t >= SAMPLE_EVERY_MS) ? [{ t: nowMs, miles }] : [];
  if (!add.length && !sample.length) return ledger;
  next = { ...ledger, units: add.length ? [...ledger.units, ...add] : ledger.units, samples: [...ledger.samples, ...sample].slice(-MAX_SAMPLES) };
  return next;
}

// How many ticks are MISSED: due for longer than the grace time and not covered by what has been paid.
// (A payment that catches up several ticks covers all of them.)
export function missedTicks(ledger, paidSats, nowMs, graceMs = GRACE_MS) {
  const paid = Math.max(0, paidSats || 0);
  let cum = 0, missed = 0;
  [...ledger.units].sort((a, b) => a.at - b.at).forEach((u) => {
    cum += u.sats;
    const slack = Math.floor(cum * 0.02) + 1; // two prices a few seconds apart differ by a sat or two
    if (cum > paid + slack && nowMs - u.at > graceMs) missed++;
  });
  return missed;
}

// The miles at time `t`, from the saved samples (straight line between the two around it).
// Used to charge "up to the last signal". Before the first sample: 0. After the last: the last.
export function milesAt(ledger, t) {
  const s = ledger.samples;
  if (!s.length || t <= s[0].t) return s.length && t >= s[0].t ? s[0].miles : 0;
  if (t >= s[s.length - 1].t) return s[s.length - 1].miles;
  let i = 1;
  while (i < s.length && s[i].t < t) i++;
  const a = s[i - 1], b = s[i];
  return a.miles + ((b.miles - a.miles) * (t - a.t)) / Math.max(1, b.t - a.t);
}

// Close the ledger at the moment the ride is finished (`atMs`, `miles`):
// adds the "final" tick for the part of a mile and of a minute not yet paid.
//   flat price + driver at the destination → everything left of the price
//   flat price, finished early            → the part used so far (never above the price)
// `price` is needed for a metered ride; without it the final tick waits (null).
export function settle(ledger, { terms, atMs, miles, price, atDestination = false }) {
  if (ledger.final) return ledger;
  const base = advanceLedger(ledger, { terms, nowMs: atMs, miles, price });
  const per = unitSats(terms, price);
  if (!per) return null;
  const minutes = Math.max(0, (atMs - base.startedAt) / MINUTE);
  const fracMin = minutes - Math.floor(minutes + 1e-9);
  const fracMile = Number.isFinite(miles) ? Math.max(0, miles - Math.floor(miles + 1e-9)) : 0;
  let sats = Math.round(fracMile * per.mile + fracMin * per.minute);
  if (terms.mode === "flat") {
    const room = Math.max(0, terms.flatSats - owedSats(base));
    sats = atDestination ? room : Math.min(sats, room);
  }
  return { ...base, final: { at: atMs, sats: Math.max(0, sats), miles: Number.isFinite(miles) ? miles : 0, minutes, atDestination: !!atDestination } };
}

// A flat ride that gets an extra stop turns into the driver's normal fare, counted from the start of the
// ride (not from the stop). Rebuild the list as a metered one at the current price; what the rider has
// already paid stays paid, so nothing more is due until the metered total passes it.
export function convertToMetered(ledger, { terms, nowMs, miles, price }) {
  if (ledger.mode === "metered") return ledger;
  const metered = normalizeTerms({ ...terms, mode: "metered" });
  if (!metered) return ledger;
  const fresh = { ...newLedger(ledger.startedAt, "metered"), samples: ledger.samples };
  return advanceLedger(fresh, { terms: metered, nowMs, miles, price });
}

// A one-line name for a tick (receipts, history).
export function tickLabel(u) {
  if (u.kind === "base") return "Base fare";
  if (u.kind === "minute") return "Minute " + String(u.id).replace("min-", "");
  if (u.kind === "mile") return "Mile " + String(u.id).replace("mile-", "");
  return "End of ride";
}
