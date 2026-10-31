// ════════════════════════════════════════════════════════════
//  APP — The one NostrRide app has two faces, Ride and Drive. A person switches between them (src/ui/ModeSwitch.jsx);
//  `APP_ROLE` is the face on screen right now: "rider" or "driver". It moves with setAppRole(), which the app calls
//  BEFORE it draws a face (src/app/App.jsx), so a screen that reads `IS_DRIVER_APP` while it draws always sees the
//  right one. These are live bindings: read them when you draw, never copy them into a constant at module level.
//  `IS_DRIVER_APP` = the person is PAID in this face (the Drive face). Node tests never call setAppRole, so they get "rider".
// ════════════════════════════════════════════════════════════

/* global __BUILD_ID__ */
// When and from which commit this bundle was built (shown in Account, so a person can tell which version is running).
export const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "development";
export const APP_NAME = "NostrRide";

export let APP_ROLE = "rider";
export let IS_DRIVER_APP = false;
export function setAppRole(role) {
  APP_ROLE = role === "driver" ? "driver" : "rider";
  IS_DRIVER_APP = APP_ROLE === "driver";
}
