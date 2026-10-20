// ════════════════════════════════════════════════════════════
//  USE AUTO CASH OUT — Runs in the driver app (DriverContext). When the ecash held at a mint is worth at least the amount the
//  driver chose (Account → Wallets → "Automatically cash out at"), it is sent to the driver's cash out location by itself.
//  The money goes to the address PINNED on this device (lib/cashoutto.js), never to a profile address that was changed elsewhere: a changed or
//  unconfirmed address pauses it and the person is told once. Runs in the Ride and the Drive face.
//  Rules (lib/autocashout.js): needs a pinned cash out address; waits while a ride is running; after a failure waits 10 minutes
//  and tells the driver once. Checks when the wallet changes, every 30 s, and when the setting is saved (AUTO_EVENT).
//  The money move is EcashWallet.cashOut: one move at a time, and a failed payment keeps the ecash.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { requestInvoice } from "../../lib/lnurl.js";
import { getAutoCashOut, autoCashOutDue } from "../../lib/autocashout.js";
import { getCashOutTo, cashOutState, onCashOutToChange, adoptProfileAddress } from "../../lib/cashoutto.js";
import { moneyText } from "../../ui/Money.jsx";

export const AUTO_EVENT = "nostrride-autocashout";

export function useAutoCashOut({ locked = false } = {}) {
  const { ecash, ecashOff, user, priceFor, btcPrice, pushNotice } = useApp();
  const latest = useRef({});
  latest.current = { locked, user, priceFor, btcPrice, pushNotice };
  const running = useRef(false);
  const failedAt = useRef(0);
  const told = useRef(false);
  const paused = useRef(false);

  useEffect(() => {
    if (!ecash || ecashOff) return undefined;
    const check = async () => {
      if (running.current) return;
      const { locked: busy, user: u, priceFor: price, btcPrice: shown, pushNotice: notify } = latest.current;
      const choice = getAutoCashOut(u.publicKey);
      if (!choice) return;
      const to = adoptProfileAddress(u.publicKey, u.lud16); // the pinned address; a device with none takes the profile's
      const st = cashOutState({ profile: u.lud16, pinned: to });
      if (st === "changed" || !to) {
        // The address was changed elsewhere (or there is none): no money moves until the person decides (Account → Wallets).
        if (!paused.current) { paused.current = true; if (st === "changed") notify("Your cash out location was changed outside this device. Automatic cash out is paused. Open Account → Wallets to decide."); }
        return;
      }
      paused.current = false;
      for (const [url, sats] of Object.entries(ecash.balances())) {
        if (!autoCashOutDue({ choice, price: price(choice.code), balanceSats: sats, to, locked: busy, failedAt: failedAt.current })) continue;
        running.current = true;
        try {
          const r = await ecash.cashOut(url, async (amount) => (await requestInvoice(to, amount, "NostrRide cash out")).pr);
          failedAt.current = 0; told.current = false;
          notify(`Cashed out ${moneyText(r.paidSats, shown)} to ${to}.`);
        } catch (e) {
          failedAt.current = Date.now();
          if (!told.current) { told.current = true; notify(e?.code === "pending" || e?.code === "storage" ? e.message : `Automatic cash out did not work: ${e?.message || "unknown error"} Your ecash is still here. The app will try again.`); }
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
    const offPin = onCashOutToChange(check);
    return () => { off(); offPin(); clearInterval(id); window.removeEventListener(AUTO_EVENT, check); };
  }, [ecash, ecashOff]);
}
