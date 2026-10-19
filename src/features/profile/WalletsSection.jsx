// ════════════════════════════════════════════════════════════
//  WALLETS — Account → Wallets, in both apps: everything about money in ONE section, top to bottom:
//    1. Currency       the local currency every price is shown in
//    2. Ecash wallet   the balance with Add funds (Lightning or on-chain) and Send (an ecash token or a Lightning payment), the mint, ...
//       then, inside it (EcashSection takes them as children):
//    3. Cash out location   the Lightning address (`lud16` in the profile, kind 0). The profile is shared by the Rider and Driver apps,
//                           so an address saved in one app is the same in the other.
//    4. Lightning wallet    a Nostr Wallet Connect string, to pay an invoice in one tap
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { SubTitle } from "../../ui/Fold.jsx";
import CurrencySection from "./CurrencySection.jsx";
import LightningAddressSection from "./LightningAddressSection.jsx";
import WalletSection from "./WalletSection.jsx";
import { useSaveProfile } from "./ProfileParts.jsx";
import EcashSection from "../ecash/EcashSection.jsx";

export default function WalletsSection({ locked = false }) {
  const { user } = useApp();
  const save = useSaveProfile();
  return (
    <div className="space-y-6">
      <div>
        <SubTitle>Currency</SubTitle>
        <CurrencySection />
      </div>
      <div>
        <SubTitle>Ecash wallet</SubTitle>
        <EcashSection locked={locked}>
          <div className="mt-6">
            <SubTitle>Cash out location</SubTitle>
            <LightningAddressSection value={user.lud16 || ""} onSave={(lud16) => save({ lud16 })} />
          </div>
          <div className="mt-6">
            <SubTitle>Lightning wallet (NWC)</SubTitle>
            <WalletSection />
          </div>
        </EcashSection>
      </div>
    </div>
  );
}
