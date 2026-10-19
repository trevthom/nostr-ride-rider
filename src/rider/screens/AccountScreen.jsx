// ════════════════════════════════════════════════════════════
//  ACCOUNT (rider) — Profile, Wallets (currency, the ecash wallet that rides are paid from, the cash out location, the Lightning
//  wallet to add funds in one tap), safety, contact methods, vouches, relays, keys, log out.
//  Every setting is a Fold (ui/Fold.jsx): tap its title to open or close it. Settings are saved to the person's relays by themselves
//  (state/useBackup.js): there is no Backup section.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { useRider } from "../state/RiderContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { AccountHeader, ContactMethods, RelaysSection, BlockedSection, LogoutButton } from "../../features/profile/ProfileParts.jsx";
import VouchesSection from "../../features/profile/VouchesSection.jsx";
import WalletsSection from "../../features/profile/WalletsSection.jsx";
import AppearanceSection from "../../features/profile/AppearanceSection.jsx";
import SafetySection from "../components/SafetySection.jsx";
import KeysSection from "../../features/profile/KeysSection.jsx";
import Fold from "../../ui/Fold.jsx";
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
          <Fold id="units" title="Units"><UnitsSection /></Fold>
          <Fold id="ecash" title="Wallets"><WalletsSection locked={!!activeRide} /></Fold>
          <RecoveryFold />
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
