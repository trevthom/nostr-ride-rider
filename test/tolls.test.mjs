// Avoid tolls: the request flag, the toll-free Valhalla route, its cache, and
// the rule that a failed toll-free route never falls back to a toll route.
// Run with: npm test
import assert from "node:assert/strict";

const R = new URL("../src", import.meta.url).pathname;
const Rides = await import(`${R}/lib/rides.js`);

// A request carries the flag only when the rider checked the box.
assert.equal(Rides.rideAvoidTolls({ content: JSON.stringify({ avoidTolls: true }) }), true);
assert.equal(Rides.rideAvoidTolls({ content: JSON.stringify({ avoidTolls: false }) }), false);
assert.equal(Rides.rideAvoidTolls({ content: JSON.stringify({}) }), false, "an older request means normal routing");
assert.equal(Rides.rideAvoidTolls({ content: "not json" }), false, "junk means normal routing");

const SHAPE = "grueiAfv}|qC"; // the first point of the Washington route: 38.907188, -77.036916
const calls = [];
let mode = "ok";
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), method: options.method || "GET", body: options.body });
  if (String(url).includes("valhalla")) {
    if (mode === "fail") return { ok: false, status: 503, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        trip: {
          summary: { has_toll: mode === "toll", length: 1.6849, time: 378.486 },
          legs: [{ shape: SHAPE }],
        },
      }),
    };
  }
  return {
    ok: true,
    json: async () => ({ routes: [{ geometry: { coordinates: [[2, 1], [4, 3]] }, distance: 300, duration: 30 }] }),
  };
};

const { getDrivingRoute, decodePolyline } = await import(`${R}/lib/routing.js`);
const points = [{ lat: 38.9072, lng: -77.0369 }, { lat: 38.8895, lng: -77.0353 }];

const decoded = decodePolyline(SHAPE);
assert.equal(decoded.length, 1);
assert.ok(Math.abs(decoded[0][0] - -77.036916) < 0.000001, "decoded longitude");
assert.ok(Math.abs(decoded[0][1] - 38.907188) < 0.000001, "decoded latitude");

const tollFree = await getDrivingRoute(points, { avoidTolls: true });
assert.ok(Math.abs(tollFree.distanceMeters - 1.6849 * 1609.344) < 0.01, "miles become metres");
assert.equal(tollFree.durationSeconds, 378.486);
assert.deepEqual(tollFree.coordinates, decoded);
await getDrivingRoute(points, { avoidTolls: true });
assert.equal(calls.length, 1, "the toll-free route is cached");

const normal = await getDrivingRoute(points, { avoidTolls: false });
assert.equal(normal.distanceMeters, 300, "the normal route still comes from OSRM");
assert.equal(calls.length, 2, "toll-free and normal routes are cached separately");
assert.doesNotMatch(calls[1].url, /exclude=toll/, "OSRM is never sent its unsupported exclude flag");

const [toll, ordinary] = calls;
assert.match(toll.url, /valhalla/, "toll-free routes go to Valhalla");
assert.equal(toll.method, "POST");
const body = JSON.parse(toll.body);
assert.deepEqual(body.locations, [{ lat: 38.9072, lon: -77.0369 }, { lat: 38.8895, lon: -77.0353 }]);
assert.equal(body.costing_options.auto.use_tolls, 0, "Valhalla is asked to avoid tolls");
assert.match(ordinary.url, /route\/v1\/driving/);

mode = "toll";
const tollRoute = await getDrivingRoute([{ lat: 5, lng: 6 }, { lat: 7, lng: 8 }], { avoidTolls: true });
assert.equal(tollRoute, null, "a route that still has a toll is not accepted");

mode = "fail";
const before = calls.length;
await assert.rejects(
  () => getDrivingRoute([{ lat: 9, lng: 10 }, { lat: 11, lng: 12 }], { avoidTolls: true }),
  /Toll-free routing request failed/
);
assert.equal(calls.length, before + 1, "a failed toll-free request does not fall back to OSRM");
assert.match(calls.at(-1).url, /valhalla/);

console.log("tolls tests ok");
process.exit(0);
