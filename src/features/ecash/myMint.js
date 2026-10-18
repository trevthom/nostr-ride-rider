// ════════════════════════════════════════════════════════════
//  MY MINT — The ecash mint this person chose in Account (saved on this device).
//  A driver is PAID at their mint (it goes into every offer, and is frozen for a ride
//  once the rider chooses them). A rider's choice is only where "Add funds" starts:
//  during a ride a rider pays at the mint of the driver they chose.
// ════════════════════════════════════════════════════════════

import { getSetting, setSetting } from "../../config/relays.js";
import { DEFAULT_MINT } from "../../config/services.js";
import { cleanMintUrl, isMintUrl } from "../../lib/mints.js";

export function getMyMint() {
  const saved = getSetting("ecashMint", DEFAULT_MINT);
  return isMintUrl(saved) ? saved : DEFAULT_MINT;
}

// Saves the mint; returns the cleaned URL, or null when the text is not a usable mint address.
export function setMyMint(input) {
  const url = cleanMintUrl(input);
  if (url) setSetting("ecashMint", url);
  return url;
}

// ── Mints the rider has chosen to trust ──
// A DRIVER names the mint they are paid at, and the rider pays there. A mint holds the money put into it, so a mint the rider
// has never used is not trusted on a driver's word: the confirm screen warns and asks first (rider/screens/ActiveTrip.jsx).
// A mint is known when it is the app's default, the one chosen in Account, one the rider already holds ecash at, or one the
// rider said yes to.
const TRUSTED = "trustedMints";
export function isKnownMint(url, ecash) {
  if (!url) return false;
  if (url === DEFAULT_MINT || url === getMyMint()) return true;
  const trusted = getSetting(TRUSTED, []);
  if (Array.isArray(trusted) && trusted.includes(url)) return true;
  return !!ecash && ecash.balance(url) > 0;
}
export function trustMint(url) {
  if (!isMintUrl(url)) return;
  const trusted = getSetting(TRUSTED, []);
  setSetting(TRUSTED, [...new Set([...(Array.isArray(trusted) ? trusted : []), url])].slice(-50));
}
