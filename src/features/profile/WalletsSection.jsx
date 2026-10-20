// ════════════════════════════════════════════════════════════
//  WALLETS — Account → Wallets, in both apps: everything about money in ONE section, top to bottom:
//    1. Currency       the local currency every price is shown in
//    2. Ecash wallet   Create New Wallet or Restore (until there is a wallet on this device), then the balance with Add funds
//                      (Lightning or on-chain) and Send (an ecash token or a Lightning payment), the mint, ...
//       then, inside it (EcashSection takes it as a child):
//    3. Cash out location   the Lightning address (`lud16` in the profile, kind 0). It is the same in the Ride and Drive faces. Saving it here also
//                           PINS it on this device: money is sent only to the pinned address (lib/cashoutto.js, features/ecash/CashOutConfirm.jsx).
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { SubTitle } from "../../ui/Fold.jsx";
import CurrencySection from "./CurrencySection.jsx";
import LightningAddressSection from "./LightningAddressSection.jsx";
import { useSaveProfile } from "./ProfileParts.jsx";
import EcashSection from "../ecash/EcashSection.jsx";
import CashOutConfirm from "../ecash/CashOutConfirm.jsx";
import { setCashOutTo } from "../../lib/cashoutto.js";

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
            <LightningAddressSection value={user.lud16 || ""} onSave={(lud16) => { setCashOutTo(user.publicKey, lud16); save({ lud16 }); }} />
            <CashOutConfirm />
          </div>
        </EcashSection>
      </div>
    </div>
  );
}
