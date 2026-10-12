import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// "2026-10-12 21:30 UTC": the build time (shown in Account, so a person can tell which version is running).
const buildId = () => new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

// The rider app of NostrRide, as its own project (generated; see scripts/export-apps.mjs in nostr-ride).
// `__APP_ROLE__` is read in src/config/app.js. `base: "./"` lets the built
// files work from any folder or sub-path (GitHub Pages, Netlify, a plain server).
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { __APP_ROLE__: JSON.stringify("rider"), __BUILD_ID__: JSON.stringify(buildId()) },
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    // The map library (Leaflet) is large; give it its own file.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        track: fileURLToPath(new URL("./track.html", import.meta.url)),
      },
      output: { manualChunks: { leaflet: ["leaflet"] } },
    },
  },
});
