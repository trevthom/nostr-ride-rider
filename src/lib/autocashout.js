// ════════════════════════════════════════════════════════════
//  AUTO CASH OUT — "Automatically cash out at: $" in Account → Wallets (driver app).
//  The driver names an amount. Once the ecash held at a mint is worth that much, the app cashes it out to the driver's
//  cash out location (a Lightning address) by itself. Pure rules and the saved choice; the runner is
//  features/ecash/useAutoCashOut.js, the money move is EcashWallet.cashOut.
//
//    getAutoCashOut(pk) / setAutoCashOut(pk, amount, code)   the saved choice: { amount, code } or null (off). Per account, per device
//    autoThresholdSats(choice, price)                        the amount in sats at the BTC price (in the choice's own currency)
//    autoCashOutDue({...})                                   should the app cash out this mint now?
//  Rules: it needs a PINNED cash out address (lib/cashoutto.js: confirmed on this device; the profile's address alone is not enough); it never runs while a ride is running (the wallet is busy with the ride);
//  a price must be known (never guess one); after a failure it waits AUTO_RETRY_MS before it tries again.
// ════════════════════════════════════════════════════════════

import { getSetting, setSetting } from "../config/relays.js";
import { satsFromFiat, isCurrency } from "./currency.js";

export const AUTO_RETRY_MS = 10 * 60000;
const key = (pk) => "autoCashOut_" + String(pk).slice(0, 16);

// Largest amount a person can type: keeps the maths far from overflow.
export const AUTO_MAX = 1000000;

export function getAutoCashOut(pk) {
  try {
    const v = getSetting(key(pk), null);
    const amount = Number(v?.amount);
    if (!v || !(amount > 0) || amount > AUTO_MAX || !isCurrency(v.code)) return null;
    return { amount, code: v.code };
  } catch { return null; }
}

// amount ≤ 0 or empty turns it off.
export function setAutoCashOut(pk, amount, code) {
  const n = Number(amount);
  if (!(n > 0) || n > AUTO_MAX || !isCurrency(code)) return setSetting(key(pk), null);
  setSetting(key(pk), { amount: n, code });
}

export function autoThresholdSats(choice, price) {
  if (!choice || !(price > 0)) return null;
  return Math.max(1, satsFromFiat(choice.amount, price));
}

// choice: the saved choice. price: BTC price in the choice's currency (null when unknown). balanceSats: what is held at ONE mint. to: the pinned address.
// failedAt: ms of the last failed try (0 for none). Returns true when the app should cash out now.
export function autoCashOutDue({ choice, price, balanceSats, to, locked = false, failedAt = 0, now = Date.now() }) {
  if (!choice || !to || locked) return false;
  const need = autoThresholdSats(choice, price);
  if (need == null || !(balanceSats >= need)) return false;
  if (failedAt && now - failedAt < AUTO_RETRY_MS) return false;
  return true;
}
