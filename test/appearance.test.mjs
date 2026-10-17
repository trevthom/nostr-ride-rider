// Dark mode: the choice is saved at once, applied to the page, and read back; the first-paint script reads the same key.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const R = new URL("../src", import.meta.url).pathname;

// A tiny stand-in for the browser: a storage, the <html> class list and the theme-color <meta>.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const classes = new Set();
const meta = { content: "#ffffff", setAttribute(n, v) { if (n === "content") this.content = v; } };
globalThis.document = {
  documentElement: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), add: (c) => classes.add(c), contains: (c) => classes.has(c) } },
  querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null),
};

const A = await import(`${R}/lib/appearance.js`);

assert.equal(A.isDark(), false, "light until the person turns dark on");
A.applyAppearance();
assert.equal(classes.has("dark"), false);

A.setDark(true);
assert.equal(store.get("nostrride_dark"), "true", "saved the moment it is flipped");
assert.equal(A.isDark(), true);
assert.equal(classes.has("dark"), true, "applied at once");
assert.equal(meta.content, A.BAR_COLORS.dark, "the phone's bar follows");

// The script that runs before the first paint (public/theme-init.js) must read the same key and give the same result.
// In the main repo each app has its own copy (apps/rider/public, apps/driver/public); an exported app repo has one (public/).
const scripts = ["../apps/rider/public/theme-init.js", "../apps/driver/public/theme-init.js", "../public/theme-init.js"]
  .map((p) => new URL(p, import.meta.url)).filter((u) => fs.existsSync(u));
assert.ok(scripts.length >= 1, "the first-paint script exists");
const runInit = (u) => vm.runInNewContext(fs.readFileSync(u, "utf8"), { document: globalThis.document, localStorage: globalThis.localStorage });
for (const u of scripts) {
  classes.clear(); meta.content = "#ffffff";
  runInit(u);
  assert.equal(classes.has("dark"), true, u.pathname + ": the first-paint script sets dark");
  assert.equal(meta.content, A.BAR_COLORS.dark);
}

A.setDark(false);
assert.equal(A.isDark(), false);
assert.equal(classes.has("dark"), false);
assert.equal(meta.content, A.BAR_COLORS.light);
classes.clear();
runInit(scripts[0]);
assert.equal(classes.has("dark"), false, "light: the first-paint script leaves the page alone");

// A blocked or broken storage must not stop the page.
store.set("nostrride_dark", "{not json");
runInit(scripts[0]);
assert.equal(classes.has("dark"), false);

console.log("appearance ok");
