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
  assert.ok(!w.content.includes("Elm") && !w.content.includes("4200") && !w.content.includes("nostrride"));
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
  assert.ok(sent.every((e) => !e.content.includes("Elm")));
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
