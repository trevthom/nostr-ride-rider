// ════════════════════════════════════════════════════════════
//  BLOCK BUTTON — "Block <name>" with a confirm step; shows "Unblock" when
//  the person is already blocked. Blocking is kept on this device (lib/blocks.js).
//  Driver app: a blocked rider's requests stop appearing.
//  Rider app:  a blocked driver's offers and car stop appearing.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { getProfile } from "../nostr/profiles.js";
import { IS_DRIVER_APP } from "../config/app.js";
import { ConfirmDialog } from "./Parts.jsx";
import Icon from "./Icon.jsx";

export default function BlockButton({ pubkey, className = "" }) {
  const { user, isBlockedPk, blockUser, unblockUser } = useApp();
  const [ask, setAsk] = useState(false);
  if (!pubkey || pubkey === user.publicKey) return null;
  const name = getProfile(pubkey)?.name || "this person";
  const blocked = isBlockedPk(pubkey);
  return (
    <>
      <button
        type="button"
        onClick={() => (blocked ? unblockUser(pubkey) : setAsk(true))}
        className={`inline-flex items-center gap-1.5 text-sm font-medium underline ${blocked ? "text-neutral-600" : "text-red-600"} ${className}`}
      >
        <Icon name="x" size={14} /> {blocked ? `Unblock ${name}` : `Block ${name}`}
      </button>
      <ConfirmDialog
        open={ask}
        title={`Block ${name}?`}
        message={IS_DRIVER_APP ? "Their ride requests will no longer appear for you. They are not told." : "Their offers and car will no longer appear for you. They are not told."}
        confirmLabel="Block"
        cancelLabel="Cancel"
        danger
        onConfirm={() => { setAsk(false); blockUser(pubkey, name === "this person" ? "" : name); }}
        onCancel={() => setAsk(false)}
      />
    </>
  );
}
