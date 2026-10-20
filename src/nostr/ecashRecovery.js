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
//    wallet.recovery.rotateAll()         "I lost my phone": swap every coin for a fresh one so a copy is worth nothing
//    wallet.recovery.disconnect({force}) remove the wallet from this device (swap, then erase the coins and the phrase here)
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

    // Remove the wallet from THIS device: the coins are swapped for new ones first (a copy taken earlier is then worth nothing), then the
    // coins, the counters and the recovery phrase are erased here. The money stays at the mint and comes back with the 12 words.
    // Refused while a payment is being sent, and refused while there is money and the words were not written down (it would be lost).
    // `force` goes on even if a mint could not be reached to swap the coins (a copy taken earlier could still be spent).
    async disconnect({ force = false } = {}) {
      await wallet.syncSpent().catch(() => {}); // coins that were moved elsewhere (a restore on another device) are not money here any more
      await wallet.recoverPending().catch(() => {}); // a token made but never published goes back into the wallet
      if (wallet.pendingList().length) throw new EcashError("busy", "A payment is still being sent. Try again in a minute.");
      const total = wallet.total();
      if (total > 0 && !rec.backedUp) throw new EcashError("phrase", "Write down your 12 words first (Recovery phrase). Without them, disconnecting would lose this money.", true);
      let swapped = 0;
      if (total > 0) {
        const failed = [];
        for (const row of await recovery.rotateAll()) {
          if (row.error) failed.push(row.mint); else swapped += row.sats || 0;
        }
        if (failed.length && !force) throw Object.assign(new EcashError("swap", `Could not swap the coins at ${failed.join(", ")}: the mint did not answer. Try again, or disconnect anyway (a copy of the old coins could still be spent).`), { failed });
      }
      wallet.wipe();
      box.erase?.();
      mints.clear();
      return { swapped };
    },

    async rotateAll() {
      const rows = [];
      for (const url of Object.keys(wallet.balances())) {
        try { rows.push({ mint: url, ...(await wallet.rotate(url)), error: "" }); }
        catch (e) { rows.push({ mint: url, sats: wallet.balance(url), error: e?.message || "The mint did not answer." }); }
      }
      return rows;
    },
  };
  return recovery;
}
