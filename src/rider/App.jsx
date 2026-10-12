// ════════════════════════════════════════════════════════════
//  RIDER APP — The root. Wraps everything in the shared state, shows the
//  login screen until someone is signed in, then three tabs:
//    Ride (home) · Activity · Account
//  The tab bar is always visible. Tapping "Ride" while a ride is being planned
//  cancels the planning and shows the home screen.
// ════════════════════════════════════════════════════════════

import { AppProvider, useApp } from "../state/AppContext.jsx";
import { RiderProvider, useRider } from "./state/RiderContext.jsx";
import { AppFrame, TabBar } from "../ui/Layout.jsx";
import ErrorBoundary from "../ui/ErrorBoundary.jsx";
import UserModal from "../ui/UserModal.jsx";
import NoticeBanner from "../ui/NoticeBanner.jsx";
import ConnectionBanner from "../ui/ConnectionBanner.jsx";
import AuthScreen from "../features/auth/AuthScreen.jsx";
import HomeScreen from "./screens/HomeScreen.jsx";
import ActivityScreen from "./screens/ActivityScreen.jsx";
import AccountScreen from "./screens/AccountScreen.jsx";

const SCREENS = { home: HomeScreen, activity: ActivityScreen, account: AccountScreen };
const TABS = [
  { id: "home", label: "Ride", icon: "car" },
  { id: "activity", label: "Activity", icon: "clock" },
  { id: "account", label: "Account", icon: "user" },
];

function Shell() {
  const { view, setView } = useApp();
  const { activeRide, receipt, plan, resetPlan } = useRider();
  const Screen = SCREENS[view] || HomeScreen;
  const onTab = (id) => {
    if (id === "home" && view === "home" && !activeRide && !receipt && plan.step !== "idle") resetPlan();
    else setView(id);
  };
  return (
    <AppFrame>
      <ErrorBoundary resetKey={view}>
        <Screen />
      </ErrorBoundary>
      <TabBar items={TABS} active={view} onChange={onTab} />
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
