// ════════════════════════════════════════════════════════════
//  WALLET START — What Account → Wallets shows while this device has NO ecash wallet. Nothing makes a wallet by itself. The person picks:
//    • Create New Wallet    a new, empty wallet with new 12 words. A warning comes first (the words are the only way to get the money back);
//                           the write-down screen (RecoverySection) opens as soon as the wallet exists.
//    • Restore my wallet    the 12 words of a wallet they already have (RestoreWallet.jsx). The typed words become this phone's words.
//  A ride needs a wallet: until there is one a rider cannot choose a driver and a driver cannot go online.
//
//    <WalletStart />      the two choices and their dialogs
//    <WalletPrompt />     a short notice with a button that opens Account → Wallets (for the ride and drive screens)
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { IS_DRIVER_APP } from "../../config/app.js";
import { ConfirmDialog } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import { openFold } from "../../ui/Fold.jsx";
import RestoreWallet from "./RestoreWallet.jsx";
import { startRecoverySetup } from "./RecoverySection.jsx";

export default function WalletStart() {
  const { createEcash } = useApp();
  const [asking, setAsking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const create = () => {
    setAsking(false);
    createEcash();
    startRecoverySetup(); // the 12 words appear as soon as the wallet is made
  };
  return (
    <div>
      <p className="text-sm text-neutral-500 mb-3">
        You have no ecash wallet on this phone yet.
        {IS_DRIVER_APP ? " You need one to go online and be paid." : " You need one to choose a driver and pay for a ride."}
      </p>
      <div className="space-y-2">
        <Button onClick={() => setAsking(true)}>Create New Wallet</Button>
        <Button variant="secondary" onClick={() => setRestoring(true)}>Restore my wallet</Button>
      </div>
      <p className="text-xs text-neutral-500 mt-3">
        Already have a wallet from another phone? Restore it with its 12 words. Otherwise create a new one.
      </p>
      <ConfirmDialog open={asking} title="Create a new wallet?" confirmLabel="Create wallet" cancelLabel="Not now"
        message="Your wallet is kept on this phone. Its 12 words are the only way to get your money back if you lose the phone, clear the browser or delete the app. You will see the words next. Write them on paper before you add money."
        onConfirm={create} onCancel={() => setAsking(false)} />
      {restoring && <RestoreWallet onClose={() => setRestoring(false)} />}
    </div>
  );
}

// For the ride and drive screens: say what is missing and take the person to the place that fixes it.
export function WalletPrompt({ className = "" }) {
  const { ecashOff, setView } = useApp();
  if (!ecashOff) return null;
  const go = () => { openFold("ecash"); setView("account"); };
  return (
    <div className={`rounded-xl bg-amber-50 text-amber-800 px-3 py-2 ${className}`} role="alert">
      <p className="text-sm font-semibold">You have no ecash wallet on this phone.</p>
      <p className="text-xs mt-0.5">{IS_DRIVER_APP ? "Create or restore one to go online and be paid." : "Create or restore one to choose a driver and pay for a ride."}</p>
      <button type="button" onClick={go} className="text-sm font-semibold underline mt-1">Set up my wallet</button>
    </div>
  );
}
