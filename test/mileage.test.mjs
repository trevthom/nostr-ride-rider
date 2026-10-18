import test from "node:test";
import assert from "node:assert/strict";
import { milesDriven, statsOf } from "../src/lib/mileage.js";

const req = (id, c) => ({ id, pubkey: "r", created_at: 1, kind: 30078, tags: [], content: JSON.stringify(c) });

test("miles of finished rides count for the driver only", () => {
  const driver = "d".repeat(64);
  const rides = [req("a", { driverPubkey: driver, status: "closed", distanceMiles: 9 })];
  assert.equal(milesDriven(rides, driver), 0, "a ride that is not completed adds nothing");
  assert.equal(milesDriven([], driver), 0);
});
test("stats read from a profile are bounded", () => {
  assert.deepEqual(statsOf({ stats: { miles: 12.34 } }), { miles: 12.3 });
  assert.equal(statsOf({ stats: { miles: -1 } }), null);
  assert.equal(statsOf({ stats: { miles: "x" } }), null);
  assert.equal(statsOf({}), null);
});
console.log("mileage tests ok");
