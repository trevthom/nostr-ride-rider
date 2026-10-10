// Evidence: only the rider's confirmations/payments count; the driver re-checks payments.
// Run with: npm test
import assert from "node:assert/strict";
import { bech32 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);
const { seal } = await import(`${R}/lib/privacy.js`);
const { rideConfirm } = await import(`${R}/lib/rides.js`);
const E = await import(`${R}/lib/evidence.js`);

const rider = generateKeypair(), driver = generateKeypair(), other = generateKeypair();
const pub = (kind, content, tags, who) => { const e = buildSignedEvent(kind, content, [...tags, ["t", "nostrride"]], who.sk); relay._store(e); return e; };
const trip = { pickup: { name: "P", lat: 1, lng: 1 }, dropoff: { name: "D", lat: 2, lng: 2 } };
const req = pub(K.RIDE_REQUEST, { ...trip, status: "in_progress", driverPubkey: driver.publicKey }, [["d", "ride-e"]], rider);

// A valid invoice for 2000 sats (20000n) whose preimage we know.
const preimage = "ab".repeat(32), hash = bytesToHex(sha256(hexToBytes(preimage)));
const tag = (type, w) => [type, Math.floor(w.length / 32), w.length % 32, ...w];
const pr = bech32.encode("lnbc20000n", [...Array(7).fill(0), ...tag(1, bech32.toWords(hexToBytes(hash))), ...Array(104).fill(0)], false);

// Level: the preimage must match the invoice to count as "preimage".
assert.equal(E.proofLevel({ via: "wallet", pr, preimage }), "preimage");
assert.equal(E.proofLevel({ via: "wallet", pr, preimage: "cd".repeat(32) }), "wallet", "a wrong preimage is not proof");
assert.equal(E.proofLevel({ via: "claimed", pr }), "claimed");

// Rider's confirmations: only the ride's rider counts.
pub(K.RIDE_CONFIRM, { phase: "boarded", ok: true }, [["e", req.id], ["p", driver.publicKey], ["d", "c1"]], rider);
pub(K.RIDE_CONFIRM, { phase: "ended", ok: true }, [["e", req.id], ["d", "c2"]], other);
pub(K.RIDE_CONFIRM, { phase: "ended", ok: true }, [["e", req.id], ["d", "c3"]], driver);
assert.equal(rideConfirm(req).boarded.ok, true);
assert.equal(rideConfirm(req).ended, undefined, "only the rider's word counts");
pub(K.RIDE_CONFIRM, { phase: "ended", ok: false, note: "x".repeat(900) }, [["e", req.id], ["d", "c4"]], rider);
assert.equal(rideConfirm(req).ended.ok, false); assert.equal(rideConfirm(req).ended.note.length, 500, "notes are capped");

// Payment records: sealed to the driver; rider and driver read them, others cannot; fakes ignored.
const pay = (who, phase, amount, level, detail) => pub(K.RIDE_PAYMENT, { phase, amountSats: amount, level, sealed: seal(who.sk, driver.publicKey, detail) }, [["e", req.id], ["p", driver.publicKey], ["d", "pay-" + phase + who.publicKey.slice(0, 4)]], who);
pay(rider, "deposit", 2000, "preimage", { pr, preimage, verify: "" });
pay(other, "rest", 9999, "preimage", { pr, preimage }); // not the rider: ignored
const mineR = E.paymentRecords(req, rider), mineD = E.paymentRecords(req, driver), mineO = E.paymentRecords(req, other);
assert.equal(mineR.length, 1); assert.equal(mineD.length, 1, "driver sees it");
assert.equal(mineD[0].detail.preimage, preimage); assert.equal(mineD[0].amountSats, 2000);
assert.ok(mineO.every((r) => r.detail === null), "a stranger sees no proof details (phase and amount are public)");
// Driver's own check without a verify URL: consistent, not confirmed.
assert.equal(await E.verifyPayment(mineD[0], "dana@wallet.test"), "consistent");
assert.equal(await E.verifyPayment({ ...mineD[0], amountSats: 5 }, "dana@wallet.test"), "unverified", "wrong amount");
// A verify URL on someone else's host is never fetched.
let fetched = 0; globalThis.fetch = async () => { fetched++; return { ok: true, json: async () => ({ settled: true }) }; };
const evil = { ...mineD[0], detail: { ...mineD[0].detail, verify: "https://evil.example/verify/1" } };
assert.equal(await E.verifyPayment(evil, "dana@wallet.test"), "consistent"); assert.equal(fetched, 0, "foreign verify host not trusted");
const good = { ...mineD[0], detail: { ...mineD[0].detail, verify: "https://wallet.test/verify/1" } };
assert.equal(await E.verifyPayment(good, "dana@wallet.test"), "confirmed"); assert.equal(fetched, 1);
assert.ok(E.disputeRecord(req, driver).payments.length === 1);
console.log("evidence checks passed");
process.exit(0);
