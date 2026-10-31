// ════════════════════════════════════════════════════════════
//  MODE — Which face of the one app a person uses on this device: "ride" (a passenger) or "drive" (a driver).
//  Saved per account (`nostrride_mode_<first 16 hex of the key>`), so the same phone can serve two people. It is NOT part
//  of the settings backup: a person may ride on one phone and drive on another. A new account starts in "ride".
//
//    getMode(pk)            "ride" | "drive"
//    saveMode(pk, mode)     remember it
//    roleOf(mode)           "rider" | "driver"  (what src/config/app.js calls it)
//    TABS[mode]             the tab ids of each face; FIRST[mode] is where a switch lands
// ════════════════════════════════════════════════════════════

import { getSetting, setSetting } from "../config/relays.js";

const key = (pk) => "mode_" + String(pk).slice(0, 16);
export const getMode = (pk) => (pk && getSetting(key(pk), "ride") === "drive" ? "drive" : "ride");
export const saveMode = (pk, mode) => { if (pk) setSetting(key(pk), mode === "drive" ? "drive" : "ride"); };
export const roleOf = (mode) => (mode === "drive" ? "driver" : "rider");

export const TABS = { ride: ["home", "activity", "account"], drive: ["drive", "earnings", "account"] };
export const FIRST = { ride: "home", drive: "drive" };
// The view to show after a switch: the same tab when both faces have it (Account), else the first tab of the new face.
export const viewFor = (mode, view) => (TABS[mode].includes(view) ? view : FIRST[mode]);
