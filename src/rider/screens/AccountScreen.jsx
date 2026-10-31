// ════════════════════════════════════════════════════════════
//  ACCOUNT (ride face) — The shared account screen. This wrapper only supplies what the shared screen cannot read
//  here: whether a ride is running (the wallet is frozen during one). There are no driver settings on this face.
//  See features/profile/AccountScreen.jsx.
// ════════════════════════════════════════════════════════════

import { useRider } from "../state/RiderContext.jsx";
import Account from "../../features/profile/AccountScreen.jsx";

export default function AccountScreen() {
  const { activeRide } = useRider();
  return <Account onRide={!!activeRide} />;
}
