// The pinned cash out address of the signed-in person (lib/cashoutto.js), as React state: { pinned, state, profile }. Re-renders when it changes.
import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { getCashOutTo, cashOutState, onCashOutToChange } from "../../lib/cashoutto.js";

export function useCashOutTo() {
  const { user } = useApp();
  const [, setTick] = useState(0);
  useEffect(() => onCashOutToChange(() => setTick((t) => t + 1)), []);
  const pinned = getCashOutTo(user.publicKey);
  return { pinned, profile: user.lud16 || "", state: cashOutState({ profile: user.lud16, pinned }) };
}
