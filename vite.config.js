import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The rider app of NostrRide, as its own project (generated; see scripts/export-apps.mjs in nostr-ride).
// `__APP_ROLE__` is read in src/config/app.js. `base: "./"` lets the built
// files work from any folder or sub-path (GitHub Pages, Netlify, a plain server).
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { __APP_ROLE__: JSON.stringify("rider") },
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
