// ════════════════════════════════════════════════════════════
//  YOUR VOUCHES — The Account part where a person lists the people they KNOW AND TRUST, by npub (lib/vouches.js). It is
//  the only kind of reputation in the app. A vouch is for the person, whether they ride or drive. When someone you vouch
//  for also vouches for a driver or a rider, you see "N of your vouches know and trust this person" on their card.
//  The list is public on Nostr (anyone can see who you vouch for), and you can change it at any time.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { getProfile } from "../../nostr/profiles.js";
import { shortNpub } from "../../nostr/keys.js";
import { parsePubkey, vouchEvent, vouchList, MAX_VOUCHES } from "../../lib/vouches.js";
import { SectionLabel, inputCls } from "../../ui/Parts.jsx";
import Avatar from "../../ui/Avatar.jsx";
import Button from "../../ui/Button.jsx";

export default function VouchesSection() {
  const { user, publish, refreshVouches, liveTick } = useApp();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  void liveTick; // the names arrive from the relays after the list is shown
  const list = vouchList(user.publicKey);

  const save = async (next) => {
    setBusy(true);
    const ev = vouchEvent(next);
    await publish(ev.kind, ev.content, ev.tags); // the cache has it at once; the relays follow (or the outbox sends it later)
    await refreshVouches();
    setBusy(false);
  };
  const add = async () => {
    setError("");
    const r = parsePubkey(text);
    if (r.error) return setError(r.error);
    if (r.pubkey === user.publicKey) return setError("That is your own key. Add someone else.");
    if (list.includes(r.pubkey)) return setError("You already vouch for this person.");
    if (list.length >= MAX_VOUCHES) return setError(`You can vouch for up to ${MAX_VOUCHES} people.`);
    setText("");
    relay.fetchProfile(r.pubkey);
    await save([...list, r.pubkey]);
  };

  return (
    <section>
      <SectionLabel>Your vouches</SectionLabel>
      <p className="text-sm text-neutral-500">
        Add the npub of people you know and trust, whether they ride or drive. See the documentation to understand how they work.
      </p>
      <p className="text-xs text-neutral-500 mt-1 mb-3">Your list is public: anyone can see who you vouch for.</p>
      <div className="flex gap-2">
        <input aria-label="npub of a person you know and trust" value={text} onChange={(e) => { setText(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim() && !busy) { e.preventDefault(); add(); } }}
          placeholder="npub1…" spellCheck={false} autoComplete="off" className={`${inputCls} min-w-0 !text-sm font-mono`} />
        <Button size="md" full={false} className="px-4" onClick={add} disabled={!text.trim() || busy}>Add</Button>
      </div>
      {error && <p className="text-red-600 text-xs mt-2" role="alert">{error}</p>}
      {list.length === 0 ? (
        <p className="text-neutral-500 text-sm mt-3">You do not vouch for anyone yet.</p>
      ) : (
        <ul className="mt-2" aria-label="People you vouch for">
          {list.map((pk) => {
            const p = getProfile(pk);
            const name = p?.name || shortNpub(pk);
            return (
              <li key={pk} className="flex items-center gap-3 py-2 border-b border-neutral-100">
                <Avatar src={p?.picture} name={name} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium truncate">{name}</p>
                  {p?.name && <p className="text-[11px] text-neutral-500 font-mono truncate">{shortNpub(pk)}</p>}
                </div>
                <button type="button" aria-label={`Remove ${name}`} disabled={busy} onClick={() => save(list.filter((x) => x !== pk))} className="text-sm font-medium underline disabled:text-neutral-400">Remove</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
