// ════════════════════════════════════════════════════════════
//  USE AUTO CASH OUT — Runs in the driver app (DriverContext). When the ecash held at a mint is worth at least the amount the
//  driver chose (Account → Wallets → "Automatically cash out at"), it is sent to the driver's cash out location by itself.
//  Rules (lib/autocashout.js): needs a cash out location; waits while a ride is running; after a failure waits 10 minutes
//  and tells the driver once. Checks when the wallet changes, every 30 s, and when the setting is saved (AUTO_EVENT).
//  The money move is EcashWallet.cashOut: one move at a time, and a failed payment keeps the ecash.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { requestInvoice } from "../../lib/lnurl.js";
import { getAutoCashOut, autoCashOutDue } from "../../lib/autocashout.js";
import { moneyText } from "../../ui/Money.jsx";

export const AUTO_EVENT = "nostrride-autocashout";

export function useAutoCashOut({ locked = false } = {}) {
  const { ecash, ecashOff, user, priceFor, btcPrice, pushNotice } = useApp();
  const latest = useRef({});
  latest.current = { locked, user, priceFor, btcPrice, pushNotice };
  const running = useRef(false);
  const failedAt = useRef(0);
  const told = useRef(false);

  useEffect(() => {
    if (!ecash || ecashOff) return undefined;
    const check = async () => {
      if (running.current) return;
      const { locked: busy, user: u, priceFor: price, btcPrice: shown, pushNotice: notify } = latest.current;
      const choice = getAutoCashOut(u.publicKey);
      if (!choice) return;
      for (const [url, sats] of Object.entries(ecash.balances())) {
        if (!autoCashOutDue({ choice, price: price(choice.code), balanceSats: sats, lud16: u.lud16, locked: busy, failedAt: failedAt.current })) continue;
        running.current = true;
        try {
          const r = await ecash.cashOut(url, async (amount) => (await requestInvoice(u.lud16, amount, "NostrRide cash out")).pr);
          failedAt.current = 0; told.current = false;
          notify(`Cashed out ${moneyText(r.paidSats, shown)} to ${u.lud16}.`);
        } catch (e) {
          failedAt.current = Date.now();
          if (!told.current) { told.current = true; notify(`Automatic cash out did not work: ${e?.message || "unknown error"} Your ecash is still here. The app will try again.`); }
        } finally {
          running.current = false;
        }
        return; // one cash out per check; the next check looks at the other mints
      }
    };
    check();
    const off = ecash.onChange(check);
    const id = setInterval(check, 30000);
    window.addEventListener(AUTO_EVENT, check);
    return () => { off(); clearInterval(id); window.removeEventListener(AUTO_EVENT, check); };
  }, [ecash, ecashOff]);
}
