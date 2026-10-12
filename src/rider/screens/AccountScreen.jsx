// ════════════════════════════════════════════════════════════
//  ACCOUNT (rider) — Profile, currency, the ecash wallet (rides are paid from it),
//  the Lightning wallet (to add funds in one tap), safety, contact methods, relays, keys, log out.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { AccountHeader, ContactMethods, RelaysSection, BlockedSection, LogoutButton } from "../../features/profile/ProfileParts.jsx";
import WalletSection from "../../features/profile/WalletSection.jsx";
import EcashSection from "../../features/ecash/EcashSection.jsx";
import CurrencySection from "../../features/profile/CurrencySection.jsx";
import SafetySection from "../components/SafetySection.jsx";
import KeysSection from "../../features/profile/KeysSection.jsx";

export default function AccountScreen() {
  const { user } = useApp();
  return (
    <Screen title="Account">
      <div className="space-y-7">
        <AccountHeader />
        <CurrencySection />
        <EcashSection />
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
