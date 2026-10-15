// ════════════════════════════════════════════════════════════
//  SEED BOX — Where the recovery phrase (lib/recovery.js) is kept on this device: encrypted, never anywhere else.
//
//  The phrase is encrypted with NIP-44 under its own key (HKDF of the user's secret key with the label in
//  lib/recovery.js boxKey), so reading the saved text needs the user's key. It is never put in an event, never sent to
//  a relay and never logged. A device that is lost with the phrase on it gives a thief nothing without the key; a person
//  who lost the device restores with the 12 words they wrote down.
//
//    const box = makeSeedBox(user);
//    box.load()      → { v, phrase, backedUp, at } | null
//    box.save(rec)
//    box.erase()
//    loadOrCreate(box) → rec   the saved record, or a new phrase (saved at once, "not backed up yet")
// ════════════════════════════════════════════════════════════

import { nip44 } from "nostr-tools";
import { getSetting, setSetting } from "../config/relays.js";
import { boxKey, newPhrase, checkPhrase } from "../lib/recovery.js";

export function makeSeedBox(user) {
  const key = "ecashphrase_" + user.publicKey.slice(0, 16);
  return {
    load() {
      const sealed = getSetting(key, null);
      if (typeof sealed !== "string") return null;
      try {
        const rec = JSON.parse(nip44.decrypt(sealed, boxKey(user.sk)));
        return checkPhrase(rec?.phrase).phrase ? { v: 1, phrase: rec.phrase, backedUp: rec.backedUp === true, at: Number(rec.at) || 0 } : null;
      } catch { return null; }
    },
    save(rec) { setSetting(key, nip44.encrypt(JSON.stringify(rec), boxKey(user.sk))); },
    erase() { setSetting(key, null); },
  };
}

// The saved record, or a fresh phrase. The phrase is saved BEFORE any coin is made under it, then read back: if another
// tab of the same browser saved one in the same instant, the one that is stored wins, so there is only ever one.
export function loadOrCreate(box) {
  const have = box.load();
  if (have) return have;
  box.save({ v: 1, phrase: newPhrase(), backedUp: false, at: Date.now() });
  return box.load();
}
