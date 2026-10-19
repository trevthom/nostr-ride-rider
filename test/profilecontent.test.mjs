// The profile (kind 0) is shared by the Rider and Driver apps. A save writes only what it changes: an app holding an OLD copy of the
// profile must not write that old copy back over what the other app saved (cash out location, vehicle, rates, gender, ...).
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { profileContent } = await import(`${R}/lib/profilecontent.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);

const me = generateKeypair();
const veh = { year: "2020", make: "VW", model: "Golf", picture: "p", sealedPlate: "SEALED" };
const base = { name: "Sam", about: "hello", nip05: "sam@x.io", picture: "face", communication: [{ platform: "Signal", handle: "1" }],
  lud16: "sam@wallet.com", gender: "female", rates: { base: 2, perMile: 1, perMinute: 0.2 }, stats: { miles: 40 }, vehicle: veh };
// The Rider app opened before the Driver app saved all that: its own copy of the user is empty.
const stale = { publicKey: me.publicKey, sk: me.sk, name: "Sam", picture: "face", comm: [], lud16: "", gender: "", rates: null, vehicle: null };

const renamed = profileContent(base, { ...stale, name: "Samantha" }, { name: "Samantha" });
assert.equal(renamed.name, "Samantha");
assert.equal(renamed.lud16, "sam@wallet.com", "the cash out location from the other app is kept");
assert.equal(renamed.gender, "female");
assert.deepEqual(renamed.rates, base.rates);
assert.deepEqual(renamed.stats, { miles: 40 });
assert.deepEqual(renamed.vehicle, veh, "the vehicle (and its sealed plate) from the other app is kept");
assert.deepEqual(renamed.communication, base.communication);
assert.equal(renamed.nip05, "sam@x.io", "fields from other Nostr apps are kept");
assert.equal(renamed.picture, "face");

// A save that changes a field writes it, and nothing else moves.
const addr = profileContent(base, { ...stale, lud16: "new@wallet.com" }, { lud16: "new@wallet.com" });
assert.equal(addr.lud16, "new@wallet.com"); assert.deepEqual(addr.vehicle, veh); assert.equal(addr.name, "Sam");
const cleared = profileContent(base, { ...stale, lud16: "" }, { lud16: "" });
assert.equal(cleared.lud16, "", "removing the address is a change too");
const norates = profileContent(base, { ...stale, rates: null }, { rates: null });
assert.equal(norates.rates, null, "null = back to the app's own rates");

// A new vehicle is sealed: the plate is not in the clear.
const nv = { ...stale, vehicle: { year: "2021", make: "Kia", model: "Soul", picture: "q", plateState: "KY", plateNumber: "ZZZ999" } };
const withCar = profileContent(base, nv, { vehicle: nv.vehicle });
assert.ok(!JSON.stringify(withCar).includes("ZZZ999") && withCar.vehicle.make === "Kia" && withCar.vehicle.sealedPlate);

// A first save (no profile yet) takes the app's own copy.
const first = profileContent({}, { ...stale, name: "New", picture: "pic", comm: [{ platform: "Phone", handle: "5" }] }, { name: "New" });
assert.equal(first.name, "New"); assert.equal(first.picture, "pic"); assert.deepEqual(first.communication, [{ platform: "Phone", handle: "5" }]);
assert.equal(first.about, "NostrRide user");
assert.ok(!("lud16" in first), "nothing invented");
console.log("profile content ok");
