// The installed nostr-tools takes ONE filter object in subscribeMany. An array reaches the relay as an
// invalid filter (a strict relay refuses it, so live subscriptions would be silently dead). This test
// reads the source so that mistake cannot come back.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("../src", import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(js|jsx)$/.test(f.name)) files.push(p);
  }
})(root);

let calls = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  // subscribeMany( <relays> , <filter> ...  — the second argument must not start with "["
  for (const m of text.matchAll(/subscribeMany(?:Eose)?\(\s*([^,]+?)\s*,\s*(\[?)/g)) {
    calls++;
    assert.notEqual(m[2], "[", `${path.relative(root, file)}: subscribeMany must get one filter object, not an array`);
  }
}
assert.ok(calls >= 4, "found the subscribe calls (" + calls + ")");

// And the installed version really has the one-filter signature.
const pool = fs.readFileSync(new URL("../node_modules/nostr-tools/lib/esm/pool.js", import.meta.url), "utf8");
assert.match(pool, /subscribeMany\(relays, filter, params\)/, "nostr-tools subscribeMany(relays, filter, params)");
console.log("pool api ok");
