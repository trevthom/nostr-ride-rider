// ════════════════════════════════════════════════════════════
//  HOME (rider) — Picks the right screen for where the rider is:
//    a ride is open      → ActiveTrip (searching / choose / pay / on trip)
//    a trip just ended   → Receipt (pay the rest, rate, done)
//    otherwise           → PlanTrip (where to?)
// ════════════════════════════════════════════════════════════

import { useRider } from "../state/RiderContext.jsx";
import PlanTrip from "./PlanTrip.jsx";
import ActiveTrip from "./ActiveTrip.jsx";
import Receipt from "./Receipt.jsx";

export default function HomeScreen() {
  const { activeRide, receipt } = useRider();
  if (activeRide) return <ActiveTrip key={activeRide.pubkey + (activeRide.tags.find((t) => t[0] === "d") || [])[1]} request={activeRide} />;
  if (receipt) return <Receipt key={receipt.id} request={receipt} />;
  return <PlanTrip />;
}
