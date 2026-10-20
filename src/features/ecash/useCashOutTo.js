// The pinned cash out address of the signed-in person (lib/cashoutto.js), as React state: { pinned, state, profile }. Re-renders when it changes.
import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { getCashOutTo, cashOutState, onCashOutToChange, adoptProfileAddress } from "../../lib/cashoutto.js";

export function useCashOutTo() {
  const { user } = useApp();
  const [, setTick] = useState(0);
  useEffect(() => onCashOutToChange(() => setTick((t) => t + 1)), []);
  if (!getCashOutTo(user.publicKey) && user.lud16) adoptProfileAddress(user.publicKey, user.lud16); // no pin yet: take the profile's address, ask nothing
  const pinned = getCashOutTo(user.publicKey);
  return { pinned, profile: user.lud16 || "", state: cashOutState({ profile: user.lud16, pinned }) };
}
