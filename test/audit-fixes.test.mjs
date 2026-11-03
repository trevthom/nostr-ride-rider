// Regression tests for the security audit (run-1): the meter cannot be backdated, the relay cache is bounded,
// a share link cannot make the page reach private or plaintext hosts, and a profile photo must be embedded.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay, MAX_EVENTS } = await import(`${R}/nostr/relay.js`);
const { rideTimes } = await import(`${R}/lib/rides.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);
const S = await import(`${R}/nostr/share.js`);
const { getProfile } = await import(`${R}/nostr/profiles.js`);

const now = () => Math.floor(Date.now() / 1000);
const sign = (who, kind, content, tags, at) => {
  const e = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk);
  e.created_at = at ?? now() - 600;
  relay._store(e);
  return e;
};
const trip = { pickup: { name: "P", lat: 1, lng: 1 }, dropoff: { name: "D", lat: 2, lng: 2 } };
const request = (rider, driver, d) => sign(rider, K.RIDE_REQUEST, { ...trip, status: "in_progress", driverPubkey: driver.publicKey }, [["d", d]], now() - 900);
const confirm = (rider, req, driver) => sign(rider, K.RIDE_CONFIRM, { phase: "code", ok: true }, [["e", req.id], ["p", driver.publicKey], ["d", "confirm-" + req.id]], now() - 840);
const riding = (rider, req, driver, claim, at, d) => sign(driver, K.RIDE_STAGE, { stage: "riding", at: claim }, [["e", req.id], ["p", rider.publicKey], ["d", d]], at);

// ── 1. A start claimed EARLIER than the marker that reports it is not believed (10 min of meter time = 4000 sats) ──
const rider = generateKeypair(), driver = generateKeypair();
const r1 = request(rider, driver, "audit-ride-1");
confirm(rider, r1, driver);
const markerAt = now();
riding(rider, r1, driver, (markerAt - 600) * 1000, markerAt, "audit-stage-1");
assert.equal(rideTimes(r1).startedAt, markerAt * 1000, "a backdated start is pulled forward to the marker's own time");

// A LATE claim is still tolerated: a phone whose clock runs slow may not be punished for it.
const r2 = request(rider, driver, "audit-ride-2");
confirm(rider, r2, driver);
const late = now();
riding(rider, r2, driver, (late + 120) * 1000, late, "audit-stage-2");
assert.equal(rideTimes(r2).startedAt, (late + 120) * 1000, "a start a couple of minutes late is believed");

// The rider's own signed "the code was right" is a floor, even if the driver's marker arrived first.
const r3 = request(rider, driver, "audit-ride-3");
const earlyMarker = now();
riding(rider, r3, driver, earlyMarker * 1000, earlyMarker, "audit-stage-3");
const codeAt = earlyMarker + 30;
sign(rider, K.RIDE_CONFIRM, { phase: "code", ok: true }, [["e", r3.id], ["p", driver.publicKey], ["d", "confirm-" + r3.id]], codeAt);
assert.equal(rideTimes(r3).startedAt, codeAt * 1000, "the meter never starts before the rider confirmed the code");

// ── 2. The relay cache is a bounded working set, not an archive anyone can grow ──
const flood = (n, kind, tag) => {
  let last = "";
  for (let i = 0; i < n; i++) {
    relay._store({
      id: i.toString(16).padStart(64, "0"),
      pubkey: "e".repeat(64),
      created_at: 1700000000,
      kind,
      tags: [["d", tag + "-" + i], ["t", "nostrride"]],
      content: JSON.stringify(trip),
      sig: "0".repeat(128),
    });
    last = i.toString(16).padStart(64, "0");
  }
  return last;
};
const newest = flood(MAX_EVENTS + 10, K.RIDE_REQUEST, "flood");
assert.ok(relay.events.length <= MAX_EVENTS, `the cache stays bounded (${relay.events.length} <= ${MAX_EVENTS})`);
assert.ok(relay.events.length > MAX_EVENTS / 2, "trimming drops the oldest quarter, not everything");
assert.ok(relay.query({ kinds: [K.RIDE_REQUEST] }).some((e) => e.id === newest), "the newest events are kept");
assert.ok(!relay.query({ kinds: [K.RIDE_REQUEST] }).some((e) => e.id === "0".repeat(64)), "the oldest are dropped");

// ── 3. A share link may only name an ordinary public wss:// relay ──
const token = S.newShareToken();
const relays = (r) => S.parseShareHash(`#k=${token}&r=${r}`).relays;
assert.deepEqual(relays("wss://relay.example,wss://other.example"), ["wss://relay.example", "wss://other.example"], "public relays are kept");
assert.deepEqual(relays("ws://127.0.0.1:6379"), [], "no plaintext loopback probing (the page is not local)");
assert.deepEqual(relays("ws://192.168.1.1:8080"), [], "no plaintext private host");
assert.deepEqual(relays("wss://192.168.1.1"), [], "no private address, even encrypted");
assert.deepEqual(relays("wss://10.0.0.5,wss://169.254.169.254"), [], "no LAN or link-local addresses");
assert.deepEqual(relays("javascript:alert(1),http://x,wss://ok.example"), ["wss://ok.example"], "only real relays survive");
assert.deepEqual(relays("wss://relay.example,a,b,c,d,e,f"), ["wss://relay.example"], "at most the relays that parse");

// ── 4. A profile photo must be embedded, never fetched from an address someone else controls ──
const who = generateKeypair();
sign(who, K.METADATA, { name: "Remote", picture: "https://tracker.example/p.gif?rider=r", vehicle: { make: "X", picture: "https://tracker.example/c.gif" } }, [], now() - 300);
assert.equal(getProfile(who.publicKey).picture, "", "a remote profile photo is not used");
assert.equal(getProfile(who.publicKey).vehicle.picture, "", "nor a remote vehicle photo");
const embedded = "data:image/jpeg;base64,AAAA";
sign(who, K.METADATA, { name: "Local", picture: embedded, vehicle: { make: "X", picture: embedded } }, [], now() - 120);
assert.equal(getProfile(who.publicKey).picture, embedded, "an embedded photo is used");
assert.equal(getProfile(who.publicKey).vehicle.picture, embedded, "so is an embedded vehicle photo");

console.log("audit fixes ok");
process.exit(0);
