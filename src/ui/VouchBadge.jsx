// ════════════════════════════════════════════════════════════
//  VOUCH BADGE — "2 of your vouches know and trust this person". Shown under a person's name on their card (a driver in
//  the rider app, a rider in the driver app) and in their profile. It is about YOUR vouches (Account → Your vouches, see
//  lib/vouches.js): nothing is shown when none of the people you vouch for knows them. Tap it to see who.
//
//    <VouchBadge pubkey={hex} />
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { getProfile } from "../nostr/profiles.js";
import { shortNpub } from "../nostr/keys.js";
import { trustFor, trustHeadline, trustDetail } from "../lib/vouches.js";
import Icon from "./Icon.jsx";

export default function VouchBadge({ pubkey }) {
  const { user, liveTick } = useApp();
  const [open, setOpen] = useState(false);
  void liveTick; // the lists arrive from the relays after the card is shown
  const trust = pubkey && user ? trustFor(pubkey, user.publicKey) : null;
  if (!trust) return null;
  const nameOf = (p) => getProfile(p)?.name || shortNpub(p);
  const detail = trustDetail(trust, nameOf);
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={detail ? open : undefined}
        onClick={() => detail && setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#e6f4ec] text-[#05683a] text-xs font-semibold px-2.5 py-1 text-left"
      >
        <Icon name="shield" size={13} /> {trustHeadline(trust)}
      </button>
      {open && detail && <p className="text-xs text-neutral-600 mt-1">{detail}</p>}
    </div>
  );
}
