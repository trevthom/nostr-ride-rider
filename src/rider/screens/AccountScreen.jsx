// ════════════════════════════════════════════════════════════
//  ACCOUNT (ride face) — The SAME account screen as the Drive face: every setting is shown whichever face is on.
//  This wrapper only supplies what the shared screen cannot read here: whether a ride is running (the rates and the
//  wallet are frozen during one) and the saved driver settings (no DriverContext is mounted on this face).
//  See features/profile/AccountScreen.jsx.
// ════════════════════════════════════════════════════════════

import { useRider } from "../state/RiderContext.jsx";
import { useDriverPrefs } from "../../lib/driverprefs.js";
import Account from "../../features/profile/AccountScreen.jsx";

export default function AccountScreen() {
  const { activeRide } = useRider();
  const driving = useDriverPrefs();
  return <Account onRide={!!activeRide} driving={driving} />;
}
