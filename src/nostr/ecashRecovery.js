// ════════════════════════════════════════════════════════════
//  ECASH RECOVERY — Joins the recovery phrase (lib/recovery.js, kept by nostr/seedbox.js) to the wallet (nostr/ecash.js).
//  It holds the phrase for this device, builds the mint adapters with the phrase's seed, and runs the recovery actions the
//  Account screen offers. No Cashu code here: the adapter maker is passed in (nostr/cashuMint.js).
//
//  The phrase is made the first time a wallet is opened on a device, BEFORE any coin exists, so every coin is under it from
//  the start. `backedUp()` turns true only after the person has written the words down and typed three of them back.
//
//    const recovery = makeRecovery({ box, newAdapter })      newAdapter(url, { seed, counters }) → mint adapter
//    new EcashWallet({ …, mintFor: recovery.mintFor });  recovery.attach(wallet)   → wallet.recovery
//
//    wallet.recovery.phrase()            the 12 words (show only on request; never log, never send)
//    wallet.recovery.backedUp()          true after confirmBackup()
//    wallet.recovery.confirmBackup()     the person has the words on paper; old coins are moved under the phrase
//    wallet.recovery.restore(text, urls) bring the ecash back from a phrase on a new device → [{ mint, found, added, rotated, error }]
//    wallet.recovery.rotateAll()         "I lost my phone": swap every coin for a fresh one so a copy is worth nothing
// ════════════════════════════════════════════════════════════

import { EcashError } from "./ecash.js";
import { loadOrCreate } from "./seedbox.js";
import { checkPhrase, seedOf, newPhrase } from "../lib/recovery.js";

export function makeRecovery({ box, newAdapter }) {
  const had = box.load();
  // If the browser cannot save (a private window), the wallet still works for this visit, but nothing can be recovered.
  let rec = had || loadOrCreate(box) || { v: 1, phrase: newPhrase(), backedUp: false, at: Date.now(), volatile: true };
  let seed = seedOf(rec.phrase);
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

    async restore(text, urls) {
      const c = checkPhrase(text);
      if (c.error) throw new EcashError("phrase", c.error, true);
      const list = [...new Set((urls || []).filter(Boolean))];
      if (!list.length) throw new EcashError("mint", "Add the address of at least one mint to look in.", true);
      if (c.phrase === rec.phrase) return wallet.restore(list);
      const empty = wallet.total() === 0 && wallet.pendingList().length === 0 && wallet.quotesList().length === 0;
      if (empty) {
        // A new device. First LOOK with the typed phrase, and change nothing: a phrase that finds no ecash (a typing slip that
        // still passes the checksum, someone else's words) must not replace this wallet's own phrase or be marked as written down.
        const other = seedOf(c.phrase);
        const probe = [];
        let any = false;
        for (const url of list) {
          try {
            const r = await newAdapter(url, { seed: other }).restore();
            const found = r.proofs.reduce((s, p) => s + Number(p.amount), 0);
            probe.push({ mint: url, found, added: 0, rotated: false, error: "" });
            if (r.proofs.length) any = true;
          } catch (e) {
            probe.push({ mint: url, found: 0, added: 0, rotated: false, error: e?.message || "The mint did not answer." });
          }
        }
        if (!any) return probe;
        // It found ecash, so these are the person's words: take them as this wallet's own. Nothing is lost, the wallet holds nothing.
        rec = { v: 1, phrase: c.phrase, backedUp: true, at: Date.now() };
        box.save(rec);
        seed = seedOf(rec.phrase);
        mints.clear();
        wallet.state.counters = {};
        wallet.state.legacy = [];
        wallet._save();
        return wallet.restore(list);
      }
      // This wallet already holds ecash under its own phrase: bring the other phrase's coins in and keep our own phrase.
      const other = seedOf(c.phrase);
      return wallet.restore(list, { source: (url) => newAdapter(url, { seed: other }) });
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
