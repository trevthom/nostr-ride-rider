// ════════════════════════════════════════════════════════════
//  PRIVATE NOTE — A note only the person can see, shown under a blocked user or a vouch. It is saved with the
//  local list/settings (and the encrypted settings backup), never published on Nostr, and saved when the field
//  loses focus or Enter is pressed. Shift+Enter adds a line.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";

export default function PrivateNote({ name, note, onSave, placeholder = "Add a note (only you can see it)" }) {
  const [draft, setDraft] = useState(note);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(note), [note]);
  const save = () => {
    const next = draft.trim();
    if (next === note) return;
    onSave(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div className="mt-2">
      <textarea
        aria-label={`Note about ${name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } }}
        placeholder={placeholder}
        rows={1}
        maxLength={300}
        className="w-full bg-neutral-100 rounded-lg px-3 py-2 text-sm text-black placeholder-neutral-500 border border-transparent focus:outline-none focus:border-black focus:bg-white resize-y"
      />
      {saved && <p className="text-xs text-neutral-500 mt-1" role="status">Saved</p>}
    </div>
  );
}
