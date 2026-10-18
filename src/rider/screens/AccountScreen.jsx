// ════════════════════════════════════════════════════════════
//  ACCOUNT (rider) — Profile, currency, the ecash wallet (rides are paid from it),
//  the Lightning wallet (to add funds in one tap), safety, contact methods, relays, keys, log out.
//  Every setting is a Fold (ui/Fold.jsx): tap its title to open or close it.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { AccountHeader, ContactMethods, RelaysSection, BlockedSection, LogoutButton } from "../../features/profile/ProfileParts.jsx";
import WalletSection from "../../features/profile/WalletSection.jsx";
import VouchesSection from "../../features/profile/VouchesSection.jsx";
import EcashSection from "../../features/ecash/EcashSection.jsx";
import CurrencySection from "../../features/profile/CurrencySection.jsx";
import AppearanceSection from "../../features/profile/AppearanceSection.jsx";
import SafetySection from "../components/SafetySection.jsx";
import KeysSection from "../../features/profile/KeysSection.jsx";
import Fold from "../../ui/Fold.jsx";
import BackupSection from "../../features/profile/BackupSection.jsx";
import UnitsSection from "../../features/profile/UnitsSection.jsx";
import { RecoveryFold, RecoveryNotice } from "../../features/ecash/RecoverySection.jsx";

export default function AccountScreen() {
  const { user } = useApp();
  const { activeRide } = useRider();
  return (
    <Screen title="Account">
      <div className="space-y-7">
        <AccountHeader />
        <RecoveryNotice />
        <div>
          <Fold id="appearance" title="Appearance"><AppearanceSection /></Fold>
          <Fold id="currency" title="Currency"><CurrencySection /></Fold>
          <Fold id="units" title="Units"><UnitsSection /></Fold>
          <Fold id="ecash" title="Ecash wallet"><EcashSection locked={!!activeRide} /></Fold>
          <RecoveryFold />
          <Fold id="backup" title="Backup"><BackupSection /></Fold>
          <Fold id="wallet" title="Lightning wallet"><WalletSection /></Fold>
          <Fold id="safety" title="Trusted contacts"><SafetySection /></Fold>
          <Fold id="contacts" title="Contact methods"><ContactMethods /></Fold>
          <Fold id="vouches" title="Your vouches"><VouchesSection /></Fold>
          <Fold id="blocked" title="Blocked people"><BlockedSection /></Fold>
          <Fold id="relays" title="Nostr relays"><RelaysSection /></Fold>
          <Fold id="keys" title="Your keys"><KeysSection user={user} /></Fold>
        </div>
        <LogoutButton />
      </div>
    </Screen>
  );
}
