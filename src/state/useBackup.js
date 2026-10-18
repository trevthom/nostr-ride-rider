// ════════════════════════════════════════════════════════════
//  USE BACKUP — Keeps the encrypted backup (lib/backup.js) in step. Mounted once by AppProvider for the signed-in person.
//    1. At login it looks for the person's backup note on the relays. If it is NEWER than what this device last saw, the
//       settings, the block list and the vouch list are put back (the screens are then drawn again with them: `onRestored`).
//       Nothing is ever SENT before that check is done, so a fresh phone can never overwrite the backup with its empty state.
//    2. While `enabled`, a change to any saved setting (a few seconds later) or to the vouch list (checked every minute) sends
//       a new backup, but only when the content really changed.
//  `backupNow()` sends one at once; `restoreNow()` puts the relay copy back even if it is older (the person asked).
//  State: { enabled, setEnabled, status: "idle" | "checking" | "saving" | "ok" | "none" | "error", at (ms of the last backup), message }.
// ════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { getRelays, getSetting, setSetting, onSettingWrite } from "../config/relays.js";
import { allowedKey, applyBackup, backupDigest, backupEvent, backupVouches, collectBackup, openBackup, sealBackup } from "../lib/backup.js";
import { vouchEvent, vouchList } from "../lib/vouches.js";

const DEBOUNCE_MS = 4000;
const POLL_MS = 60000;

export function useBackup({ user, publish, onRestored }) {
  const me = user?.publicKey;
  const [enabled, setEnabledState] = useState(() => getSetting("backupOn", true) !== false);
  const [status, setStatus] = useState("idle");
  const [at, setAt] = useState(() => getSetting("backupAt", 0));
  const [message, setMessage] = useState("");
  const ready = useRef(false);
  const last = useRef("");
  const timer = useRef(null);
  const live = useRef({});
  live.current = { user, publish, onRestored, enabled };

  const setEnabled = useCallback((on) => { setSetting("backupOn", !!on); setEnabledState(!!on); }, []);

  // The newest backup note this person has on the relays, opened (or null).
  const fetchRemote = useCallback(async () => {
    const u = live.current.user;
    const events = await relay.pool.querySync(getRelays(), { kinds: [EVENT_KINDS.SETTINGS_BACKUP], authors: [u.publicKey] });
    for (const e of events.sort((a, b) => b.created_at - a.created_at)) {
      let sealed = null;
      try { sealed = JSON.parse(e.content).sealed; } catch { /* not ours */ }
      const data = sealed ? openBackup(sealed, u.sk, u.publicKey) : null;
      if (data) return data;
    }
    return null;
  }, []);

  const restore = useCallback(async (data) => {
    applyBackup(data);
    // A vouch list that exists only in the backup (the public one is gone) is published again.
    const vouches = backupVouches(data);
    const { user: u, publish: pub } = live.current;
    if (vouches.length && !vouchList(u.publicKey).length) { const ev = vouchEvent(vouches); await pub(ev.kind, ev.content, ev.tags); }
    setSetting("backupAt", data.at);
    setAt(data.at);
    last.current = backupDigest(collectBackup(u.publicKey));
    live.current.onRestored?.();
  }, []);

  const push = useCallback(async (force = false) => {
    const { user: u, publish: pub, enabled: on } = live.current;
    if (!u || !(ready.current && (on || force))) return false;
    const data = collectBackup(u.publicKey);
    const digest = backupDigest(data);
    if (!force && digest === last.current) return false;
    setStatus("saving");
    try {
      const ev = backupEvent(sealBackup(data, u.sk, u.publicKey));
      const ok = await pub(ev.kind, ev.content, ev.tags);
      last.current = digest;
      setSetting("backupAt", data.at);
      setAt(data.at);
      setStatus("ok");
      setMessage(ok ? "" : "Saved here. It will be sent as soon as a relay answers.");
      return true;
    } catch (e) {
      setStatus("error");
      setMessage(e?.message || "The backup could not be saved.");
      return false;
    }
  }, []);

  // 1. At login: look first, send later.
  useEffect(() => {
    if (!me) return undefined;
    let alive = true;
    ready.current = false;
    setStatus("checking");
    (async () => {
      try {
        const remote = await fetchRemote();
        if (!alive) return;
        if (remote && remote.at > getSetting("backupAt", 0)) { await restore(remote); setStatus("ok"); }
        else { last.current = backupDigest(collectBackup(me)); setStatus(remote ? "ok" : "none"); }
      } catch { if (alive) setStatus("error"); }
      if (!alive) return;
      ready.current = true;
      if (!last.current) last.current = backupDigest(collectBackup(me));
      push(); // a device that has settings the relays do not have yet
    })();
    return () => { alive = false; ready.current = false; };
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Changes: a few seconds after a saved setting, and every minute for the vouch list.
  useEffect(() => {
    if (!me) return undefined;
    const off = onSettingWrite((key) => {
      if (!allowedKey(key) && key !== "relays") return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => push(), DEBOUNCE_MS);
    });
    const id = setInterval(() => push(), POLL_MS);
    return () => { off(); clearInterval(id); clearTimeout(timer.current); };
  }, [me, push]);

  const backupNow = useCallback(() => push(true), [push]);
  const restoreNow = useCallback(async () => {
    setStatus("checking");
    try {
      const remote = await fetchRemote();
      if (!remote) { setStatus("none"); setMessage("There is no backup for this key on your relays yet."); return false; }
      await restore(remote);
      setStatus("ok"); setMessage("");
      return true;
    } catch { setStatus("error"); setMessage("The relays did not answer."); return false; }
  }, [fetchRemote, restore]);

  return { enabled, setEnabled, status, at, message, backupNow, restoreNow };
}
