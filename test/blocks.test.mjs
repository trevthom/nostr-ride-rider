// Block list helpers.
// Run with: npm test
import assert from "node:assert/strict";
const { isBlocked, addBlock, removeBlock } = await import("../src/lib/blocks.js");
let l = [];
l = addBlock(l, "aa", "Alex", 1);
assert.equal(isBlocked(l, "aa"), true); assert.equal(isBlocked(l, "bb"), false);
assert.equal(addBlock(l, "aa", "Again"), l, "adding twice changes nothing");
assert.equal(addBlock(l, "", "x"), l, "empty key ignored");
assert.equal(addBlock(l, "bb", "n".repeat(200))[1].name.length, 60, "names are capped");
assert.deepEqual(removeBlock(addBlock(l, "bb"), "aa").map((b) => b.pubkey), ["bb"]);
console.log("blocks checks passed");
process.exit(0);
