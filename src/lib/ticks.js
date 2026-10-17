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
//  Money is counted in SATS. Each tick's sats are fixed when the tick becomes
//  due: the driver's rate (in the driver's currency) is turned into sats at the
//  BTC price of that moment. Both apps keep the same list (the LEDGER) from the
//  same signed times and the same meter, so they agree without talking.
//
//  The driver's rates come from the offer and are frozen for the ride.
//
//  Pure functions. A ledger is plain JSON, so each app saves it with the ride.
//    newLedger(startedAt)
//    advanceLedger(ledger, { terms, nowMs, miles, price }) → ledger
//    owedSats / dueSats / missedTicks / paidBreakdown / settle / milesAt
// ════════════════════════════════════════════════════════════

import { satsFromFiat } from "./currency.js";

export const GRACE_MS = 30000; // a tick counts as MISSED this long after it was due
export const MISSED_LIMIT = 2; // the driver may finish the ride after this many
const SAMPLE_EVERY_MS = 15000; // how often the ledger remembers the miles (for "up to the last signal")
const MAX_SAMPLES = 480; // two hours at one sample per 15 s
const MINUTE = 60000;

// terms = what the ride was agreed on (frozen when the driver is chosen):
//   { currency, base, perMile, perMinute }   (the driver's rates, major units)
export function normalizeTerms(t) {
  if (!t || typeof t !== "object") return null;
  const n = (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
  const base = n(t.base), perMile = n(t.perMile), perMinute = n(t.perMinute);
  if (base == null || perMile == null || perMinute == null) return null;
  return { mode: "metered", currency: typeof t.currency === "string" ? t.currency : "USD", base, perMile, perMinute };
}

// Sats for ONE base / mile / minute tick at `price` (BTC price in the terms' currency).
// Returns null when there is no price (the tick waits; it is not guessed).
export function unitSats(terms, price) {
  const base = satsFromFiat(terms.base, price), mile = satsFromFiat(terms.perMile, price), minute = satsFromFiat(terms.perMinute, price);
  return base == null || mile == null || minute == null ? null : { base, mile, minute };
}

export const newLedger = (startedAt) => ({ v: 1, mode: "metered", startedAt, units: [], samples: [], final: null });

export const owedSats = (ledger) => ledger.units.reduce((s, u) => s + u.sats, 0) + (ledger.final ? ledger.final.sats : 0);
export const dueSats = (ledger, paidSats) => Math.max(0, owedSats(ledger) - Math.max(0, paidSats || 0));

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
    have.add(id);
    add.push({ id, kind, at, sats });
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
// `price` is needed; without it the final tick waits (null).
export function settle(ledger, { terms, atMs, miles, price }) {
  if (ledger.final) return ledger;
  const base = advanceLedger(ledger, { terms, nowMs: atMs, miles, price });
  const per = unitSats(terms, price);
  if (!per) return null;
  const minutes = Math.max(0, (atMs - base.startedAt) / MINUTE);
  const fracMin = minutes - Math.floor(minutes + 1e-9);
  const fracMile = Number.isFinite(miles) ? Math.max(0, miles - Math.floor(miles + 1e-9)) : 0;
  const sats = Math.round(fracMile * per.mile + fracMin * per.minute);
  return { ...base, final: { at: atMs, sats: Math.max(0, sats), miles: Number.isFinite(miles) ? miles : 0, minutes } };
}

// What has been PAID so far, by kind, for the "Paid so far" lines of the fare cards:
//   { base, miles: { n, sats }, minutes: { n, sats }, end }   (all sats)
// What was paid covers the ride's ticks in the order they fell due. A tick counts (n) once it is covered, with the same few sats of slack as
// missedTicks; a tick only partly covered adds the part that was paid to its line but not to the count. `end` = the part of the last mile and
// minute that is settled when the ride is finished.
export function paidBreakdown(ledger, paidSats) {
  const out = { base: 0, miles: { n: 0, sats: 0 }, minutes: { n: 0, sats: 0 }, end: 0 };
  if (!ledger) return out;
  const paid = Math.max(0, paidSats || 0);
  const list = [...ledger.units].sort((a, b) => a.at - b.at);
  if (ledger.final) list.push({ kind: "final", at: ledger.final.at, sats: ledger.final.sats });
  let cum = 0;
  for (const u of list) {
    const before = cum;
    cum += u.sats;
    const covered = cum <= paid + Math.floor(cum * 0.02) + 1;
    const sats = covered ? u.sats : Math.max(0, Math.min(u.sats, paid - before));
    if (u.kind === "base") out.base += sats;
    else if (u.kind === "mile") { out.miles.sats += sats; if (covered) out.miles.n++; }
    else if (u.kind === "minute") { out.minutes.sats += sats; if (covered) out.minutes.n++; }
    else out.end += sats;
  }
  return out;
}

// A one-line name for a tick (receipts, history).
export function tickLabel(u) {
  if (u.kind === "base") return "Base fare";
  if (u.kind === "minute") return "Minute " + String(u.id).replace("min-", "");
  if (u.kind === "mile") return "Mile " + String(u.id).replace("mile-", "");
  return "End of ride";
}
