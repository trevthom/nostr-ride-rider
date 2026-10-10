// ════════════════════════════════════════════════════════════
//  SERVICES — The three outside map services the apps use. Each has a free
//  public default (fine for development, not for real traffic). To switch
//  to your own servers, set these in a `.env` file at the repo root, then
//  rebuild (see .env.example and docs/index.md, "Self-hosting map services"):
//    VITE_TILE_URL          e.g. https://tiles.example.com/tile/{z}/{x}/{y}.png
//    VITE_TILE_ATTRIBUTION  credit line shown on the map
//    VITE_PHOTON_URL        base URL of a Photon geocoder
//    VITE_OSRM_URL          base URL of an OSRM routing server
// ════════════════════════════════════════════════════════════

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const clean = (u) => String(u).replace(/\/+$/, "");

export const TILE_URL = env.VITE_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = env.VITE_TILE_ATTRIBUTION || "© OpenStreetMap contributors";
export const PHOTON_URL = clean(env.VITE_PHOTON_URL || "https://photon.komoot.io");
export const OSRM_URL = clean(env.VITE_OSRM_URL || "https://router.project-osrm.org");
