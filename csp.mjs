// Content-Security-Policy for the BUILT pages (a <meta> tag added to every html page by `vite build`). The apps hold keys and
// money, so no script from another site may run in the page: scripts come from the app's own files only.
//   script-src 'self'           the app's own bundles and service worker; no inline script, no CDN
//   style-src 'self' 'unsafe-inline' + Google Fonts   inline style attributes (React, Leaflet) and the Inter font stylesheet
//   connect-src https: wss: …   relays, mints, Lightning servers, the geocoder and router are on addresses the person chooses
//   img-src                     map tiles, photos (data: / blob:), pictures from other Nostr apps
//   object-src / base-uri / form-action 'none'
// (frame-ancestors cannot be set from a <meta> tag: set it as a header on the host if the pages must not be framed.)
// The dev server is left alone: Vite injects an inline script for hot reload there.
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

export function cspPlugin() {
  return {
    name: "nostrride-csp",
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html;
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}
