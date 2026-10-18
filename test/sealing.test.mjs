// Job events travel only inside gift wraps: a relay sees no kind, no tags, no content (nostr/sealing.js, relay.js, lib/audience.js).
import test from "node:test";
import assert from "node:assert/strict";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { wrap, unwrap, recipientsOf, GIFT_WRAP, SEALED_KINDS } from "../src/nostr/sealing.js";
import { EVENT_KINDS, APP_TAG } from "../src/nostr/eventKinds.js";
import { audienceFor } from "../src/lib/audience.js";
const { relay } = await import("../src/nostr/relay.js");

const people = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const alice = people(), bob = people(), carl = people();
const job = (from, to, kind = EVENT_KINDS.RIDE_OFFER, content = { priceSats: 4200, secret: "12 Elm Street" }) =>
  finalizeEvent({ kind, created_at: 1000, tags: [["p", to.pk], ["d", "offer-1"], ["t", APP_TAG]], content: JSON.stringify(content) }, from.sk);

test("a wrap shows a relay only a throwaway author, the recipient and a blob", () => {
  const inner = job(bob, alice);
  const w = wrap(inner, alice.pk);
  assert.equal(w.kind, GIFT_WRAP);
  assert.deepEqual(w.tags, [["p", alice.pk]]);
  assert.notEqual(w.pubkey, bob.pk);
  assert.ok(!w.content.includes("12 Elm Street") && !w.content.includes("priceSats") && !w.content.includes("nostrride"));
  assert.notEqual(wrap(inner, alice.pk).pubkey, w.pubkey, "a new throwaway key for every wrap");
});

test("only the recipient opens it, and the inner signature must hold", () => {
  const inner = job(bob, alice);
  const w = wrap(inner, alice.pk);
  assert.equal(unwrap(w, alice.sk).id, inner.id);
  assert.equal(unwrap(w, carl.sk), null);
  const forged = { ...inner, content: JSON.stringify({ priceSats: 1 }) };
  assert.equal(unwrap(wrap(forged, alice.pk), alice.sk), null, "a changed event fails its signature");
  const profile = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: "{}" }, bob.sk);
  assert.equal(unwrap(wrap(profile, alice.pk), alice.sk), null, "only job kinds travel in a wrap");
});

test("recipients: the author, the p tags and the audience, once each", () => {
  const inner = job(bob, alice);
  assert.deepEqual(new Set(recipientsOf(inner, [carl.pk, alice.pk, "junk"])), new Set([bob.pk, alice.pk, carl.pk]));
});

test("publish sends wraps only; the receiver's cache gets the inner event once", async () => {
  const sent = [];
  relay.pool.publish = (_urls, ev) => { sent.push(ev); return [Promise.resolve("ok")]; };
  const inner = job(bob, alice);
  assert.equal(await relay.publish(inner, { to: [carl.pk] }), true);
  assert.equal(sent.length, 3, "one wrap each for the author, alice and carl");
  assert.ok(sent.every((e) => e.kind === GIFT_WRAP && e.tags.length === 1 && e.tags[0][0] === "p"));
  assert.deepEqual(new Set(sent.map((e) => e.tags[0][1])), new Set([bob.pk, alice.pk, carl.pk]));
  assert.ok(sent.every((e) => !e.content.includes("12 Elm Street")));
  // Alice's device: reads the wrap addressed to her.
  relay.seen.delete(inner.id); relay.events = []; relay.byKind = new Map(); relay.byTag = new Map();
  relay.setIdentity(alice.sk, alice.pk);
  const toAlice = sent.find((e) => e.tags[0][1] === alice.pk);
  assert.equal(relay._ingest(toAlice), true);
  assert.equal(relay.query({ kinds: [EVENT_KINDS.RIDE_OFFER] }).length, 1);
  assert.equal(relay._ingest(toAlice), false, "the same wrap is not read twice");
  const toCarl = sent.find((e) => e.tags[0][1] === carl.pk);
  assert.equal(relay._ingest(toCarl), false, "a wrap for someone else is ignored");
  relay.setIdentity(null, null);
});

test("every kind of job event is sealed, and profile, presence and vouches are not", () => {
  for (const k of ["RIDE_REQUEST", "RIDE_TICK", "RIDE_FINISH"]) assert.ok(SEALED_KINDS.has(EVENT_KINDS[k]), k);
  for (const k of ["METADATA", "PRESENCE", "VOUCH_LIST", "TRIP_SHARE", "SETTINGS_BACKUP", "RIDE_LOCATION"]) assert.ok(!SEALED_KINDS.has(EVENT_KINDS[k]), k);
});

test("audience: near online drivers for a ride, nearest first, not the blocked", () => {
  const near = { lat: 40, lng: -100 };
  const at = (pubkey, extra = {}) => ({ pubkey, lat: 40.01, lng: -100, ...extra });
  const list = [at("d1"), at("d2", { lat: 45 }), at("d3", { lat: 40.05 }), at("me")];
  assert.deepEqual(audienceFor({ pickup: near }, list, { me: "me" }), ["d1", "d3"]);
  assert.deepEqual(audienceFor({ pickup: near }, list, { me: "me", blocked: [{ pubkey: "d1" }] }), ["d3"]);
  assert.deepEqual(audienceFor({}, list, { me: "me" }), []);
});

test("a flood of wraps is opened in small steps, not all at once", async () => {
  const me = people(), sender = people();
  relay.events = []; relay.byKind = new Map(); relay.byTag = new Map(); relay.seen = new Set();
  relay.setIdentity(me.sk, me.pk);
  relay.wrapLimits = { budget: 20, windowMs: 60000, queueMax: 60, seenMax: 30000, batch: 25 };
  relay.wrapWindowAt = 0; relay.wrapsInWindow = 0;
  const wraps = Array.from({ length: 100 }, (_, i) => wrap(finalizeEvent({ kind: EVENT_KINDS.RIDE_ALIVE, created_at: 2000 + i, tags: [["p", me.pk], ["d", "alive-" + i], ["t", APP_TAG]], content: JSON.stringify({ i }) }, sender.sk), me.pk));
  const elsewhere = wrap(job(sender, alice), alice.pk);
  assert.equal(relay._ingest(elsewhere), false, "a wrap for someone else costs nothing");
  assert.equal(relay.seenWraps.has(elsewhere.id), false);
  let opened = 0;
  for (const w of wraps) if (relay._ingest(w)) opened++;
  assert.equal(opened, 20, "the budget is opened at once");
  assert.equal(relay.wrapQueue.length, 60, "the next ones wait in the queue; past its limit a flood is dropped");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(relay.query({ kinds: [EVENT_KINDS.RIDE_ALIVE] }).length, 80, "the queue was opened a few at a time");
  assert.equal(relay.wrapQueue.length, 0);
  relay.wrapLimits = { budget: 300, windowMs: 5000, queueMax: 3000, seenMax: 30000, batch: 100 };
  relay.setIdentity(null, null);
});

test("the list of opened wraps does not grow without end", () => {
  const me = people(), sender = people();
  relay.setIdentity(me.sk, me.pk);
  relay.wrapLimits = { budget: 1e9, windowMs: 1, queueMax: 10, seenMax: 30, batch: 10 };
  for (let i = 0; i < 100; i++) relay._ingest(wrap(finalizeEvent({ kind: EVENT_KINDS.RIDE_ALIVE, created_at: 5000 + i, tags: [["p", me.pk], ["d", "z" + i], ["t", APP_TAG]], content: "{}" }, sender.sk), me.pk));
  assert.ok(relay.seenWraps.size <= 30, "bounded: " + relay.seenWraps.size);
  relay.wrapLimits = { budget: 300, windowMs: 5000, queueMax: 3000, seenMax: 30000, batch: 100 };
  relay.setIdentity(null, null);
});

test("audience: people the rider vouches for come first, and a few places are drawn at random", () => {
  const near = { lat: 40, lng: -100 };
  const at = (pubkey, d) => ({ pubkey, lat: 40 + d, lng: -100 });
  // 40 fakes crowd the exact pickup; the real driver is a little further out.
  const people = [...Array.from({ length: 40 }, (_, i) => at("fake" + i, 0.0001 * i)), at("real", 0.2), at("friend", 0.4)];
  const picked = audienceFor({ pickup: near }, people, { me: "me", limit: 30, trusted: (pk) => pk === "friend", random: () => 0 });
  assert.ok(picked.includes("friend"), "the rider's vouch is always in");
  assert.equal(picked.length, 30);
  assert.equal(new Set(picked).size, 30, "no one twice");
  // with random draws the real driver can be picked even though 40 fakes are nearer: some draw puts it in
  let hits = 0;
  for (let i = 0; i < 40; i++) if (audienceFor({ pickup: near }, people, { me: "me", limit: 30, random: Math.random }).includes("real")) hits++;
  assert.ok(hits > 0, "the random places give a real driver a chance: " + hits + " of 40");
  assert.deepEqual(audienceFor({ pickup: near }, people, { me: "me", limit: 0 }), [], "no room: nobody");
});

test("presence time is believed only within a minute of the signed event's time", async () => {
  const { presenceTs } = await import("../src/nostr/live.js");
  const t = 1_700_000_000;
  assert.equal(presenceTs(t, t * 1000 + 5000), t * 1000 + 5000);
  assert.equal(presenceTs(t, t * 1000 + 3_650_000_000), t * 1000 + 60000, "a time a year ahead is cut back");
  assert.equal(presenceTs(t, 0), t * 1000 - 60000, "and so is one far behind");
  assert.equal(presenceTs(t, "junk"), t * 1000);
});
