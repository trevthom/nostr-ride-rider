// ════════════════════════════════════════════════════════════
//  ECASH RECOVERY — Joins the recovery phrase (lib/recovery.js, kept by nostr/seedbox.js) to the wallet (nostr/ecash.js).
//  It holds the phrase for this device, builds the mint adapters with the phrase's seed, and runs the recovery actions the
//  Account screen offers. No Cashu code here: the adapter maker is passed in (nostr/cashuMint.js).
//
//  The phrase is made when the person taps Create New Wallet, BEFORE any coin exists, so every coin is under it from
//  the start. (Restore does not come through here: nostr/cashuMint.js restoreWallet saves the typed words as this device's phrase, then
//  the wallet opens with them.) `backedUp()` turns true only after the person has written the words down and typed three of them back.
//
//    const recovery = makeRecovery({ box, newAdapter })      newAdapter(url, { seed, counters }) → mint adapter
//    new EcashWallet({ …, mintFor: recovery.mintFor });  recovery.attach(wallet)   → wallet.recovery
//
//    wallet.recovery.phrase()            the 12 words (show only on request; never log, never send)
//    wallet.recovery.backedUp()          true after confirmBackup()
//    wallet.recovery.confirmBackup()     the person has the words on paper; old coins are moved under the phrase
//    wallet.recovery.disconnect()        remove the wallet from this device (erase the coins and the phrase here; no swap)
// ════════════════════════════════════════════════════════════

import { EcashError } from "./ecash.js";
import { loadOrCreate } from "./seedbox.js";
import { seedOf, newPhrase } from "../lib/recovery.js";

export function makeRecovery({ box, newAdapter }) {
  const had = box.load();
  // If the browser cannot save (a private window), the wallet still works for this visit, but nothing can be recovered.
  let rec = had || loadOrCreate(box) || { v: 1, phrase: newPhrase(), backedUp: false, at: Date.now(), volatile: true };
  const seed = seedOf(rec.phrase);
  let wallet = null;
  const mints = new Map();

  const recovery = {
    mintFor(url) {
      if (!mints.has(url)) mints.set(url, newAdapter(url, { seed, counters: wallet.counterSource() }));
      return mints.get(url);
    },

    attach(w) {
      wallet = w;
      w.recovery = recovery;
      if (!had) {
        // Ecash made before the wallet had a phrase has random secrets. List those mints: they are swapped once the phrase is safe.
        const old = Object.keys(w.balances());
        if (old.length) { w.state.legacy = [...new Set([...(w.state.legacy || []), ...old])]; w._save(); }
      } else if (rec.backedUp) {
        w.migrate().catch(() => {});
      }
    },

    phrase: () => rec.phrase,
    backedUp: () => rec.backedUp === true,
    volatile: () => rec.volatile === true,

    confirmBackup() {
      rec = { ...rec, backedUp: true };
      box.save(rec);
      wallet._save(); // screens re-read
      return wallet.migrate();
    },

    // Remove the wallet from THIS device: the coins, the counters and the recovery phrase are erased here, and nothing else happens (no swap at the
    // mint). The money stays at the mint and comes back with the 12 words (Restore my wallet).
    // Refused while a payment is being sent, and refused while there is money and the words were not written down (it would be lost).
    async disconnect() {
      await wallet.syncSpent().catch(() => {}); // coins that were moved elsewhere (a restore on another device) are not money here any more
      await wallet.recoverPending().catch(() => {}); // a token made but never published goes back into the wallet
      if (wallet.pendingList().length) throw new EcashError("busy", "A payment is still being sent. Try again in a minute.");
      if (wallet.total() > 0 && !rec.backedUp) throw new EcashError("phrase", "Write down your 12 words first (Recovery phrase). Without them, disconnecting would lose this money.", true);
      wallet.wipe();
      box.erase?.();
      mints.clear();
    },
  };
  return recovery;
}
