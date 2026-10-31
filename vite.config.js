import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { cspPlugin } from "./csp.mjs";

// "2026-10-12 21:30 UTC · rider": the build time (shown in Account).
const buildId = () => new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC · rider";

// The rider app of NostrRide, as its own project.
// One face only: src/app/App.jsx mounts the rider shell. base "./" lets the built files work from any sub-path.
export default defineConfig({
  base: "./",
  envDir: ".",
  plugins: [react(), cspPlugin()],
  css: { postcss: { plugins: [tailwindcss(fileURLToPath(new URL("./tailwind.config.js", import.meta.url))), autoprefixer()] } },
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
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
