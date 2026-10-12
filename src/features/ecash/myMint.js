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
