// "Automatically cash out at: $": when it is due (pure rules) and the saved choice.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
const A = await import(`${R}/lib/autocashout.js`);

const pk = "ab".repeat(32);
assert.equal(A.getAutoCashOut(pk), null, "off at first");
A.setAutoCashOut(pk, 25, "USD");
assert.deepEqual(A.getAutoCashOut(pk), { amount: 25, code: "USD" });
assert.equal(A.getAutoCashOut("cd".repeat(32)), null, "another account has its own choice");
A.setAutoCashOut(pk, 0, "USD");
assert.equal(A.getAutoCashOut(pk), null, "zero turns it off");
A.setAutoCashOut(pk, 25, "USD"); A.setAutoCashOut(pk, "", "USD");
assert.equal(A.getAutoCashOut(pk), null, "empty turns it off");
A.setAutoCashOut(pk, -5, "USD");
assert.equal(A.getAutoCashOut(pk), null, "a negative amount is not saved");
A.setAutoCashOut(pk, 5, "XYZ");
assert.equal(A.getAutoCashOut(pk), null, "an unknown currency is not saved");
A.setAutoCashOut(pk, A.AUTO_MAX + 1, "USD");
assert.equal(A.getAutoCashOut(pk), null, "an absurd amount is not saved");

// 20 dollars at $100,000 per BTC = 20,000 sats
const choice = { amount: 20, code: "USD" };
const price = 100000;
assert.equal(A.autoThresholdSats(choice, price), 20000);
assert.equal(A.autoThresholdSats(choice, null), null, "no price: no guess");
assert.equal(A.autoThresholdSats(null, price), null);

const base = { choice, price, balanceSats: 20000, lud16: "me@wallet.com", locked: false, failedAt: 0, now: 1_000_000 };
assert.equal(A.autoCashOutDue(base), true, "exactly at the amount");
assert.equal(A.autoCashOutDue({ ...base, balanceSats: 19999 }), false, "one sat short");
assert.equal(A.autoCashOutDue({ ...base, balanceSats: 90000 }), true, "above the amount");
assert.equal(A.autoCashOutDue({ ...base, choice: null }), false, "off");
assert.equal(A.autoCashOutDue({ ...base, lud16: "" }), false, "needs a cash out location");
assert.equal(A.autoCashOutDue({ ...base, locked: true }), false, "never during a ride");
assert.equal(A.autoCashOutDue({ ...base, price: null }), false, "no price known: wait");
assert.equal(A.autoCashOutDue({ ...base, failedAt: base.now - 60000 }), false, "after a failure it waits");
assert.equal(A.autoCashOutDue({ ...base, failedAt: base.now - A.AUTO_RETRY_MS - 1 }), true, "then it tries again");
console.log("autocashout tests ok");
