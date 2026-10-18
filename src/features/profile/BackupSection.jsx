// ════════════════════════════════════════════════════════════
//  BACKUP — Account → Backup: your vouches, blocked people and settings, kept on your relays as ONE note that only your
//  secret key (nsec) can open. Log in on a new phone with the same nsec and they come back. It is kept up to date by itself
//  (a few seconds after a change); the buttons are for peace of mind. Ecash is NOT in this backup: it has its own 12 words.
//  See lib/backup.js and state/useBackup.js.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { Toggle, ConfirmDialog } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";

const WORDS = { idle: "", checking: "Checking your relays…", saving: "Saving…", ok: "", none: "No backup yet.", error: "Something went wrong." };

export default function BackupSection() {
  const { backup } = useApp();
  const [ask, setAsk] = useState(false);
  const { enabled, setEnabled, status, at, message, backupNow, restoreNow } = backup;
  const when = at ? new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  return (
    <section>
      <p className="text-sm text-neutral-500 mb-3">
        Your vouches, blocked people and settings are saved on your relays, <strong>encrypted with your secret key</strong>. Only you can read them. A new phone that logs in with your nsec gets them back.
        Your ecash is not in this backup: it has its own 12 words (Recovery phrase).
      </p>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium">Keep it backed up</p>
          <p className="text-sm text-neutral-500">Saves a few seconds after each change.</p>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} label="Keep it backed up" />
      </div>
      <p className="text-sm mt-3" role="status" aria-label="Backup status">
        {WORDS[status]}{status === "ok" || status === "idle" ? (when ? `Last saved ${when}.` : "") : ""} {message}
      </p>
      <div className="flex gap-2 mt-3">
        <Button size="md" onClick={backupNow} loading={status === "saving"}>Back up now</Button>
        <Button size="md" variant="outline" onClick={() => setAsk(true)} loading={status === "checking"}>Restore</Button>
      </div>
      <ConfirmDialog open={ask} title="Restore from your backup?" confirmLabel="Restore" cancelLabel="Keep what I have"
        message="Your vouches, blocked people and settings on this phone are replaced by the saved copy."
        onConfirm={async () => { setAsk(false); await restoreNow(); }} onCancel={() => setAsk(false)} />
    </section>
  );
}
