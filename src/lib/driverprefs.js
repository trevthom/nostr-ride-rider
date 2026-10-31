// ════════════════════════════════════════════════════════════
//  DRIVER PREFS — The two saved driver settings: the request radius and the new-request alerts. Both live on this
//  device (localStorage, `requestRadius` / `requestAlerts`) and are part of the encrypted backup.
//
//  The Drive face keeps them in DriverContext (online, presence and the request list read them live). The Account
//  screen shows every setting on BOTH faces, and on the Ride face there is no DriverContext mounted: it reads and
//  writes the same saved settings with this hook. A switch to Drive mounts DriverContext again, which reads them
//  fresh — so the two never disagree.
// ════════════════════════════════════════════════════════════

import { useCallback, useState } from "react";
import { getSetting, setSetting } from "../config/relays.js";
import { DEFAULT_REQUEST_RADIUS_MILES } from "../config/settings.js";

export function useDriverPrefs() {
  const [radius, setRadiusState] = useState(() => getSetting("requestRadius", DEFAULT_REQUEST_RADIUS_MILES));
  const [alerts, setAlertsState] = useState(() => getSetting("requestAlerts", true));
  const setRadius = useCallback((v) => { setRadiusState(v); setSetting("requestRadius", v); }, []);
  const setAlerts = useCallback((v) => { setAlertsState(v); setSetting("requestAlerts", v); }, []);
  return { radius, setRadius, alerts, setAlerts };
}
