// Vouches ("I know and trust this person"): the only reputation in the app (no stars, no reviews).
//   • reading an npub safely (an nsec is refused)
//   • the list event: one public replaceable event per person, newest wins, bad entries dropped
//   • what a viewer sees: ONLY through the people they vouch for, one hop, never from strangers
//   • the words on the badge, and the sync that brings in the right lists
// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const V = await import(`${R}/lib/vouches.js`);
const { syncVouches } = await import(`${R}/nostr/vouchSync.js`);
const { generateKeypair, fullNpub } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const people = Object.fromEntries(["me", "c1", "c2", "c3", "target", "stranger", "x", "deep", "other"].map((n) => [n, generateKeypair()]));
const pk = (n) => people[n].publicKey;
// A person publishes their list (the same event the Account screen publishes).
const publishList = (who, names) => {
  const ev = V.vouchEvent(names.map(pk));
  const e = buildSignedEvent(ev.kind, ev.content, [...ev.tags, ["t", "nostrride"]], people[who].sk);
  relay._store(e);
  return e;
};

// ── Reading an npub ──
const npub = fullNpub(pk("target"));
assert.deepEqual(V.parsePubkey(npub), { pubkey: pk("target") });
assert.deepEqual(V.parsePubkey("  nostr:" + npub + "\n"), { pubkey: pk("target") }, "a pasted nostr: link and spaces are fine");
assert.deepEqual(V.parsePubkey(pk("target").toUpperCase()), { pubkey: pk("target") }, "64 hex digits work too");
assert.match(V.parsePubkey("nsec1" + "q".repeat(58)).error, /SECRET key/, "a secret key is refused and never kept");
assert.match(V.parsePubkey(npub.slice(0, -4) + "qqqq").error, /not valid/, "a mistyped npub is caught by its checksum");
assert.match(V.parsePubkey("hello").error, /not an npub/);
assert.ok(V.parsePubkey("").error);
assert.ok(V.parsePubkey(null).error);

// ── The list event ──
const ev = V.vouchEvent([pk("c1"), pk("c1"), "nothex", pk("c2"), 5]);
assert.equal(ev.kind, K.VOUCH_LIST);
assert.deepEqual(ev.tags, [["d", "vouches"], ["p", pk("c1")], ["p", pk("c2")]], "no duplicates, no junk");
assert.deepEqual(ev.content, { v: 1, count: 2 });
assert.equal(V.vouchEvent(Array.from({ length: 150 }, (_, i) => i.toString(16).padStart(64, "0"))).tags.length, 1 + V.MAX_VOUCHES, "a list stops at the limit");
assert.deepEqual(V.vouchEvent([]).tags, [["d", "vouches"]], "an empty list is a list too (it clears the old one)");

// ── The newest list wins; strangers' junk is ignored ──
assert.deepEqual(V.vouchList(pk("c1")), [], "nothing yet");
publishList("c1", ["target", "other"]);
assert.deepEqual(V.vouchList(pk("c1")).sort(), [pk("target"), pk("other")].sort());
publishList("c1", ["target"]);
assert.deepEqual(V.vouchList(pk("c1")), [pk("target")], "the newest list replaces the old one");
// A list with a different d tag, a self-vouch and a malformed p tag are not read.
relay._store(buildSignedEvent(K.VOUCH_LIST, { v: 1 }, [["d", "other-list"], ["p", pk("x")], ["t", "nostrride"]], people.stranger.sk));
assert.deepEqual(V.vouchList(pk("stranger")), [], "only the list named 'vouches' counts");
relay._store(buildSignedEvent(K.VOUCH_LIST, { v: 1 }, [["d", "vouches"], ["p", pk("stranger")], ["p", "zz"], ["p", pk("x")], ["p", pk("x")], ["t", "nostrride"]], people.stranger.sk));
assert.deepEqual(V.vouchList(pk("stranger")), [pk("x")], "no self-vouch, no bad key, no duplicate");

// ── What the viewer sees ──
// me vouches c1, c2, c3. c1 and c2 vouch the target. c3 does not. A stranger and x vouch the target too (me does not know them).
publishList("me", ["c1", "c2", "c3"]);
publishList("c1", ["target"]);
publishList("c2", ["target", "other"]);
publishList("c3", ["other"]);
publishList("x", ["target"]);
publishList("stranger", ["target", "x"]);
let t = V.trustFor(pk("target"), pk("me"));
assert.deepEqual(t.via.sort(), [pk("c1"), pk("c2")].sort(), "only people I vouch for count: not x, not the stranger");
assert.equal(t.direct, false);
assert.equal(V.trustHeadline(t), "2 of your vouches know and trust this person");
// One voucher: the verb agrees.
publishList("c2", ["other"]);
t = V.trustFor(pk("target"), pk("me"));
assert.deepEqual(t.via, [pk("c1")]);
assert.equal(V.trustHeadline(t), "1 of your vouches knows and trusts this person");
assert.equal(V.trustDetail(t, (p) => (p === pk("c1") ? "Sam" : "?")), "Sam");
// Taking a vouch back removes it at once.
publishList("c1", []);
assert.equal(V.trustFor(pk("target"), pk("me")), null, "no one I vouch for knows them any more: nothing is shown, not even a zero");
// A stranger who is vouched for only by strangers shows nothing.
assert.equal(V.trustFor(pk("x"), pk("me")), null);
// I vouch for them myself.
publishList("me", ["c1", "c2", "c3", "target"]);
t = V.trustFor(pk("target"), pk("me"));
assert.deepEqual([t.direct, t.via], [true, []]);
assert.equal(V.trustHeadline(t), "You know and trust this person");
// Both: the badge counts the people, and says I vouch too.
publishList("c1", ["target"]);
publishList("me", ["c1", "c2", "c3", "target"]);
t = V.trustFor(pk("target"), pk("me"));
assert.deepEqual([t.direct, t.via], [true, [pk("c1")]]);
assert.equal(V.trustHeadline(t), "1 of your vouches knows and trusts this person");
assert.equal(V.trustDetail(t, () => "Sam"), "Sam. You know and trust them too.");
// One hop only: a vouch of a vouch of a vouch is nothing.
publishList("me", ["c3"]);
publishList("c3", ["deep"]);
publishList("deep", ["target"]);
assert.equal(V.trustFor(pk("target"), pk("me")), null, "two hops away: not shown");
// Vouching for me does not make me trusted by me, and being vouched does not flow backwards.
assert.equal(V.trustFor(pk("me"), pk("me")), null);
assert.equal(V.trustFor(pk("c3"), pk("target")), null, "someone who vouches for nobody sees nothing");
assert.equal(V.trustFor(null, pk("me")), null);
// The viewer's own list is read in either role: there is no role in the question (a vouch is for the person).
assert.equal(V.trustFor.length, 2, "trustFor(target, me): no role argument");

// ── The sync reads my list, then the lists of the people I vouch for (and their names), and nothing else ──
const remote = [];
const sign = (who, e, at) => { const s = buildSignedEvent(e.kind, e.content, [...e.tags, ["t", "nostrride"]], people[who].sk); s.created_at = at; remote.push(s); return s; };
const meB = generateKeypair(), cB = generateKeypair(), tB = generateKeypair(), nameless = generateKeypair();
{
  const mk = (kp, list, at) => { const e = V.vouchEvent(list); const s = buildSignedEvent(e.kind, e.content, [...e.tags, ["t", "nostrride"]], kp.sk); s.created_at = at; remote.push(s); };
  mk(meB, [cB.publicKey], 1000);
  mk(cB, [tB.publicKey], 1000);
  mk(nameless, [tB.publicKey], 1000); // someone I do not vouch for: must NOT be fetched
  const profile = buildSignedEvent(0, { name: "Casey" }, [], cB.sk); remote.push(profile);
}
const asked = [];
relay.pool.querySync = async (_relays, f) => {
  asked.push(f);
  return remote.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)));
};
assert.equal(V.trustFor(tB.publicKey, meB.publicKey), null, "before the sync the cache knows nothing");
await syncVouches(meB.publicKey);
assert.deepEqual(V.trustFor(tB.publicKey, meB.publicKey).via, [cB.publicKey], "after it, the badge can be drawn");
assert.deepEqual(asked.map((f) => [f.kinds[0], f.authors.length]), [[K.VOUCH_LIST, 1], [K.VOUCH_LIST, 1], [0, 1]], "my list, my vouches' lists, their names: three small questions");
assert.ok(asked.every((f) => f.authors.every((a) => [meB.publicKey, cB.publicKey].includes(a))), "no one else's list is read");
assert.equal(V.trustFor(tB.publicKey, nameless.publicKey) === null, true, "a person nobody of mine vouches for is not a source");
// A relay that does not answer leaves the sync quiet.
relay.pool.querySync = async () => { throw new Error("relay down"); };
await syncVouches(meB.publicKey);

// ── Add, then remove at once: the screen follows the cache, whether or not any relay took the change ──
{
  const me2 = generateKeypair(), friend = generateKeypair();
  const send = (list) => { const e = V.vouchEvent(list); const s = buildSignedEvent(e.kind, e.content, [...e.tags, ["t", "nostrride"]], me2.sk); relay._store(s); return s; };
  const added = send([friend.publicKey]);
  assert.deepEqual(V.vouchList(me2.publicKey), [friend.publicKey]);
  const removed = send([]); // no relay answers: the event only sits in the cache (and the outbox)
  assert.ok(removed.created_at > added.created_at, "two changes in the same second still order correctly");
  assert.deepEqual(V.vouchList(me2.publicKey), [], "the vouch is gone at once");
  assert.equal(V.trustFor(friend.publicKey, me2.publicKey), null, "and no badge says the person is vouched for");
  // A relay that still holds the OLD list sends it back later: it must not bring the vouch back.
  relay.pool.querySync = async () => [added];
  await syncVouches(me2.publicKey);
  assert.deepEqual(V.vouchList(me2.publicKey), [], "an older list from a relay never undoes a newer change");
}

// ── The new kind is in the live subscription ──
assert.match(fs.readFileSync(new URL("../src/nostr/relay.js", import.meta.url), "utf8"), /EVENT_KINDS\.VOUCH_LIST/, "new lists reach the app live");
console.log("vouches: ok");
process.exit(0);
