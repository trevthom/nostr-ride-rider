// ════════════════════════════════════════════════════════════
//  CASH OUT CONFIRM — Under the cash out location (Account → Wallets): where this device sends money when you cash out (lib/cashoutto.js).
//    • confirmed on this device → one quiet line with the address
//    • the profile has an address this device never confirmed (a new phone, an older version) → "Yes, it is mine"
//    • the profile was changed elsewhere → the old address stays in use; choose the new one, or put the old one back
//  Nothing else can change the pinned address: not the relays, not the settings backup.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { setCashOutTo } from "../../lib/cashoutto.js";
import { useSaveProfile } from "../profile/ProfileParts.jsx";
import { useCashOutTo } from "./useCashOutTo.js";

export default function CashOutConfirm() {
  const { user } = useApp();
  const save = useSaveProfile();
  const { pinned, profile, state } = useCashOutTo();
  if (state === "none") return null;
  if (state === "ok") return <p className="text-xs text-neutral-500 mt-2">Cash outs from this device go to {pinned}.</p>;
  const useNew = () => setCashOutTo(user.publicKey, profile);
  const putBack = () => save({ lud16: pinned });
  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
      {state === "unconfirmed" ? (
        <>
          <p>Your profile has the cash out location <span className="font-semibold break-all">{profile}</span>. This device has not confirmed it. Money is sent there only after you do.</p>
          <button type="button" onClick={useNew} className="mt-2 font-semibold underline">Yes, it is mine</button>
        </>
      ) : (
        <>
          <p>Your cash out location was changed outside this device. It is now <span className="font-semibold break-all">{profile}</span>. Cash outs from this device still go to <span className="font-semibold break-all">{pinned}</span>, and automatic cash out is paused.</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" onClick={useNew} className="font-semibold underline">Yes, use the new one</button>
            <button type="button" onClick={putBack} className="font-semibold underline">No, put the old one back</button>
          </div>
        </>
      )}
    </div>
  );
}
