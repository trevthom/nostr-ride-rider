// The built pages must refuse to be framed (a clickjacked button in this app moves money). A <meta> tag cannot carry
// frame-ancestors, so the build writes a `_headers` file too; this checks both halves.
// Run with: npm test
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { CSP, HEADERS, cspPlugin } = await import(new URL("../csp.mjs", import.meta.url).pathname);
const dir = mkdtempSync(join(tmpdir(), "nostrride-csp-"));
try {
  const plugin = cspPlugin();
  plugin.configResolved({ root: dir, build: { outDir: "dist/nostrride" } });
  const dev = plugin.transformIndexHtml("<head></head>", { server: {} });
  assert.equal(dev, "<head></head>", "the dev server keeps its inline hot-reload script");
  const built = plugin.transformIndexHtml("<head></head>", {});
  assert.ok(built.includes('http-equiv="Content-Security-Policy"'));
  assert.ok(built.includes(CSP), "the meta policy is the same policy");
  assert.ok(!CSP.includes("frame-ancestors"), "a meta tag cannot carry frame-ancestors (it would be ignored)");
  plugin.closeBundle();
  const headers = readFileSync(join(dir, "dist/nostrride/_headers"), "utf8");
  assert.equal(headers, HEADERS);
  assert.ok(headers.includes(CSP));
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Frame-Options: DENY/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("csp tests ok");
