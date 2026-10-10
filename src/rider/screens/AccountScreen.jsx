// ════════════════════════════════════════════════════════════
//  ACCOUNT (rider) — Profile, Lightning wallet (to pay in one tap),
//  contact methods, relays, keys, log out.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { AccountHeader, ContactMethods, RelaysSection, BlockedSection, LogoutButton } from "../../features/profile/ProfileParts.jsx";
import WalletSection from "../../features/profile/WalletSection.jsx";
import SafetySection from "../components/SafetySection.jsx";
import KeysSection from "../../features/profile/KeysSection.jsx";

export default function AccountScreen() {
  const { user } = useApp();
  return (
    <Screen title="Account">
      <div className="space-y-7">
        <AccountHeader />
        <WalletSection />
        <SafetySection />
        <ContactMethods />
        <BlockedSection />
        <RelaysSection />
        <KeysSection user={user} />
        <LogoutButton />
      </div>
    </Screen>
  );
}
