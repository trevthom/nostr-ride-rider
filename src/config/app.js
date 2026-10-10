// ════════════════════════════════════════════════════════════
//  APP — Which of the two apps this bundle is: "rider" or "driver".
//  Vite sets it at build time (vite.config.js `define`). Node tests
//  have no such constant, so they get "rider".
// ════════════════════════════════════════════════════════════

/* global __APP_ROLE__ */
export const APP_ROLE = typeof __APP_ROLE__ !== "undefined" ? __APP_ROLE__ : "rider";
export const IS_DRIVER_APP = APP_ROLE === "driver";
export const APP_NAME = IS_DRIVER_APP ? "NostrRide Driver" : "NostrRide";
