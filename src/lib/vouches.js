// ════════════════════════════════════════════════════════════
//  VOUCHES — "I know and trust this person." The ONLY kind of reputation in the app: no stars, no reviews (they are too
//  easy to fake). Each person keeps a short list of the people they know and trust ("Your vouches", in Account).
//
//  The list is one public, replaceable event (kind 30102, d = "vouches", one `p` tag per person). A vouch is for the PERSON:
//  it counts the same whether they ride or drive.
//
//  What YOU (the viewer) see on a person's card — one hop, and only through people you chose:
//    • the person is in YOUR list                         → "You know and trust this person"
//    • people in YOUR list have THEM in their list        → "N of your vouches know and trust this person"
//  Someone who has never been vouched for by anyone you vouch for shows nothing at all (no "0", no warning): strangers are
//  not marked bad, they are just not vouched for. A vouch from someone you did not choose never shows, so a crowd of fake
//  accounts vouching for each other changes nothing on your screen.
//
//    parsePubkey(text)       npub / nostr:npub / 64-hex → { pubkey } or { error }   (an nsec is refused, never kept)
//    vouchEvent(list)        the event to publish for a list
//    vouchList(pubkey)       the people `pubkey` vouches for (newest list in the cache)
//    trustFor(target, me)    { direct, via: [pubkey…] } or null     trustHeadline / trustDetail: the words
// ════════════════════════════════════════════════════════════

import { nip19 } from "nostr-tools";
import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { latestVersions } from "../nostr/replaceable.js";

export const MAX_VOUCHES = 100; // a list this long is plenty, and keeps what other people's apps must read small
const HEX64 = /^[0-9a-f]{64}$/;

export function parsePubkey(text) {
  const t = String(text ?? "").trim().replace(/^nostr:/i, "");
  if (!t) return { error: "Paste the npub of a person you know and trust." };
  if (/^nsec1/i.test(t)) return { error: "That is a SECRET key (nsec). Never paste it anywhere. Ask for the person's npub instead." };
  if (HEX64.test(t.toLowerCase())) return { pubkey: t.toLowerCase() };
  if (/^npub1/i.test(t)) {
    try {
      const d = nip19.decode(t.toLowerCase());
      if (d.type === "npub" && HEX64.test(d.data)) return { pubkey: d.data };
    } catch { /* fall through */ }
    return { error: "That npub is not valid. Check that you copied all of it." };
  }
  return { error: "That is not an npub. It starts with npub1." };
}

// The event for a list (replaces the person's earlier list). Duplicates and bad entries are dropped.
export function vouchEvent(list) {
  const clean = [...new Set((list || []).filter((p) => HEX64.test(p)))].slice(0, MAX_VOUCHES);
  return { kind: EVENT_KINDS.VOUCH_LIST, content: { v: 1, count: clean.length }, tags: [["d", "vouches"], ...clean.map((p) => ["p", p])] };
}

// The people `pubkey` vouches for, from their newest list in the cache (never themself, never more than MAX_VOUCHES).
export function vouchList(pubkey) {
  if (!pubkey) return [];
  const mine = latestVersions(relay.query({ kinds: [EVENT_KINDS.VOUCH_LIST], authors: [pubkey] })).filter((e) => e.tags.some((t) => t[0] === "d" && t[1] === "vouches"));
  const newest = mine.sort((a, b) => b.created_at - a.created_at)[0];
  if (!newest) return [];
  const out = [];
  for (const t of newest.tags) {
    if (t[0] === "p" && HEX64.test(t[1] || "") && t[1] !== pubkey && !out.includes(t[1])) out.push(t[1]);
    if (out.length >= MAX_VOUCHES) break;
  }
  return out;
}

// What `me` can say about `target`: { direct: I vouch for them, via: [the people I vouch for who vouch for them] }.
// null when there is nothing to say (or target is me).
export function trustFor(target, me) {
  if (!target || !me || target === me) return null;
  const mine = vouchList(me);
  const direct = mine.includes(target);
  const via = mine.filter((c) => c !== target && vouchList(c).includes(target));
  return direct || via.length ? { direct, via } : null;
}

// The words on the badge: "2 of your vouches know and trust this person" (one: "1 of your vouches knows and trusts this person").
export function trustHeadline(t) {
  if (!t) return "";
  const n = t.via.length;
  if (n === 0) return "You know and trust this person";
  return `${n} of your vouches ${n === 1 ? "knows and trusts" : "know and trust"} this person`;
}
// The line under it, when the badge is opened: who they are (and that you vouch too).
export function trustDetail(t, nameOf) {
  if (!t) return "";
  const names = t.via.map((p) => nameOf(p)).join(", ");
  if (!t.via.length) return "";
  return t.direct ? `${names}. You know and trust them too.` : names;
}
