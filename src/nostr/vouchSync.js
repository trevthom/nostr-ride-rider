// ════════════════════════════════════════════════════════════
//  VOUCH SYNC — Brings into the cache what the badge needs (lib/vouches.js): MY vouch list, and the lists of the people I
//  vouch for (their lists are how I learn who they know and trust), plus their names. Nothing else is read: the app never
//  scans everyone's lists. The live subscription only reaches back 24 h, so this asks the relays directly.
//  Run at login, every few minutes, and after the person changes their own list.
// ════════════════════════════════════════════════════════════

import { relay } from "./relay.js";
import { getRelays } from "../config/relays.js";
import { EVENT_KINDS, APP_TAG } from "./eventKinds.js";
import { vouchList } from "../lib/vouches.js";

const CHUNK = 50;

export async function syncVouches(me) {
  if (!me) return;
  const relays = getRelays();
  const take = (events) => events.forEach((e) => relay.ingest(e));
  const lists = (authors) => relay.pool.querySync(relays, { kinds: [EVENT_KINDS.VOUCH_LIST], authors, "#t": [APP_TAG] }).catch(() => []);
  take(await lists([me]));
  const mine = vouchList(me);
  for (let i = 0; i < mine.length; i += CHUNK) take(await lists(mine.slice(i, i + CHUNK)));
  // Their names, so the badge and the list can say who.
  for (let i = 0; i < mine.length; i += CHUNK) take(await relay.pool.querySync(relays, { kinds: [EVENT_KINDS.METADATA], authors: mine.slice(i, i + CHUNK) }).catch(() => []));
}
