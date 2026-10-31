// Content-Security-Policy for the BUILT pages (a <meta> tag added to every html page by `vite build`). The apps hold keys and
// money, so no script from another site may run in the page: scripts come from the app's own files only.
//   script-src 'self'           the app's own bundles and service worker; no inline script, no CDN
//   style-src 'self' 'unsafe-inline' + Google Fonts   inline style attributes (React, Leaflet) and the Inter font stylesheet
//   connect-src https: wss: …   relays, mints, Lightning servers, the geocoder and router are on addresses the person chooses
//   img-src                     map tiles, photos (data: / blob:), pictures from other Nostr apps
//   object-src / base-uri / form-action 'none'
// (frame-ancestors cannot be set from a <meta> tag: the build also writes a `_headers` file, which Cloudflare Pages, Netlify
// and other static hosts send as real headers. A host that ignores it still gets the meta policy and the frame guard in
// main.jsx, so the app refuses to run inside a frame.)
// The dev server is left alone: Vite injects an inline script for hot reload there.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// What a static host reads: the same policy, expressed as a header, with the two directives a meta tag cannot carry.
export const HEADERS = [
  "/*",
  `  Content-Security-Policy: ${CSP}; frame-ancestors 'none'`,
  "  X-Frame-Options: DENY",
  "  Referrer-Policy: no-referrer",
  "  X-Content-Type-Options: nosniff",
  "",
].join("\n");

export function cspPlugin() {
  let outDir = "dist";
  return {
    name: "nostrride-csp",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html;
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
    // Runs after `vite build`. A host that reads `_headers` (Cloudflare Pages, Netlify, …) then refuses to frame the app,
    // so a button that spends money can never be clicked through an invisible layer on someone else's page.
    closeBundle() {
      try {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(resolve(outDir, "_headers"), HEADERS);
      } catch { /* the meta tag and the frame guard still apply */ }
    },
  };
}
