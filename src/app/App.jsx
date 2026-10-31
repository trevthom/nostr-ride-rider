// ════════════════════════════════════════════════════════════
//  RIDER APP — one face only: the three rider tabs.
//  Everything shared (key, profile, wallet, settings) is in AppProvider.
// ════════════════════════════════════════════════════════════

import { AppProvider, useApp } from "../state/AppContext.jsx";
import { RiderProvider, useRider } from "../rider/state/RiderContext.jsx";
import { AppFrame, TabBar } from "../ui/Layout.jsx";
import ErrorBoundary from "../ui/ErrorBoundary.jsx";
import UserModal from "../ui/UserModal.jsx";
import NoticeBanner from "../ui/NoticeBanner.jsx";
import ConnectionBanner from "../ui/ConnectionBanner.jsx";
import AuthScreen from "../features/auth/AuthScreen.jsx";
import HomeScreen from "../rider/screens/HomeScreen.jsx";
import ActivityScreen from "../rider/screens/ActivityScreen.jsx";
import AccountScreen from "../rider/screens/AccountScreen.jsx";
import { setAppRole } from "../config/app.js";
import { viewFor } from "../lib/mode.js";

setAppRole("rider");

const SCREENS = { home: HomeScreen, activity: ActivityScreen, account: AccountScreen };
const TABS = [
  { id: "home", label: "Ride", icon: "car" },
  { id: "activity", label: "Activity", icon: "clock" },
  { id: "account", label: "Account", icon: "user" },
];

function Shell() {
  const { view, setView } = useApp();
  const { activeRide, receipt, plan, resetPlan } = useRider();
  const shown = viewFor("ride", view);
  const Screen = SCREENS[shown];
  const onTab = (id) => {
    if (id === "home" && shown === "home" && !activeRide && !receipt && plan.step !== "idle") resetPlan();
    else setView(id);
  };
  return (
    <AppFrame>
      <ErrorBoundary resetKey={shown}>
        <Screen />
      </ErrorBoundary>
      <TabBar items={TABS} active={shown} onChange={onTab} />
      <UserModal />
      <ConnectionBanner />
      <NoticeBanner />
    </AppFrame>
  );
}

function Gate() {
  const { user, setUser } = useApp();
  if (!user) return <AuthScreen onLogin={setUser} />;
  return (
    <RiderProvider key={user.publicKey}>
      <Shell />
    </RiderProvider>
  );
}

export default function RiderApp() {
  return (
    <AppProvider initialView="home">
      <Gate />
    </AppProvider>
  );
}
