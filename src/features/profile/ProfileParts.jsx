// ════════════════════════════════════════════════════════════
//  PROFILE PARTS — The Account-page pieces both apps share: the
//  header (photo, name, trip count), contact methods, relay list, log out,
//  and useSaveProfile() which republishes the user's profile (kind 0).
// ════════════════════════════════════════════════════════════

import { useRef, useState, useCallback, useEffect } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { buildSignedEvent } from "../../nostr/events.js";
import { getMetadata } from "../../nostr/profiles.js";
import { shortNpub } from "../../nostr/keys.js";
import { profileContent } from "../../lib/profilecontent.js";
import { parsePubkey } from "../../lib/vouches.js";
import { tripCounts } from "../../lib/rides.js";
import { useUnits, formatDistance } from "../../lib/units.js";
import { resizeImage } from "../../lib/image.js";
import { useRelays, setRelays } from "../../config/relays.js";
import { CONTACT_PLATFORMS, } from "../../config/settings.js";
import { APP_NAME, BUILD_ID, IS_DRIVER_APP } from "../../config/app.js";
import Avatar from "../../ui/Avatar.jsx";
import Icon from "../../ui/Icon.jsx";
import Button from "../../ui/Button.jsx";
import RelayEditor from "../../ui/RelayEditor.jsx";
import { SectionLabel, inputCls, ConfirmDialog } from "../../ui/Parts.jsx";

// Merge a patch into the user and republish the full profile (kind 0) so
// other users see the latest name/photo/vehicle. Kind 0 is shared with every
// Nostr app, so start from the newest one we have and keep fields we don't
// manage (about, lud16, nip05, banner…).
export function useSaveProfile() {
  const { user, setUser } = useApp();
  const ref = useRef(user);
  useEffect(() => { ref.current = user; }, [user]);
  return useCallback(
    (patch) => {
      const next = { ...ref.current, ...patch };
      ref.current = next; // two quick saves must not overwrite each other
      setUser(next);
      const base = getMetadata(next.publicKey) || {};
      relay.publish(
        buildSignedEvent(
          EVENT_KINDS.METADATA,
          profileContent(base, next, patch), // only what this save changes; the rest is the newest profile (shared with the other app)
          [],
          next.sk
        )
      );
      return next;
    },
    [setUser]
  );
}

// Photo, name (tap the pencil to edit), and the trip count for this app's role.
export function AccountHeader({ photoRequired = false }) {
  const { user } = useApp();
  const save = useSaveProfile();
  const rep = tripCounts(user.publicKey);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user.name);
  const [lightbox, setLightbox] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    try {
      save({ picture: await resizeImage(file, 220, 0.6) });
    } catch {
      setErr("Couldn't process that image.");
    }
  };
  const commit = () => {
    save({ name: draft.trim() || "Anonymous" });
    setEditing(false);
  };

  const [units] = useUnits();
  const miles = user.stats?.miles || 0;

  return (
    <div className="flex items-center gap-4 py-2">
      <input ref={fileRef} type="file" accept="image/*" onChange={onPick} className="sr-only" aria-label="Profile photo" />
      <div className="relative">
        <Avatar src={user.picture} name={user.name} size={76} onClick={user.picture ? () => setLightbox(true) : () => fileRef.current?.click()} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={user.picture ? "Change photo" : "Add photo"}
          className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-black text-white flex items-center justify-center border-2 border-white"
        >
          <Icon name="camera" size={14} />
        </button>
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex gap-2 items-center">
            <input
              aria-label="Display name"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setEditing(false); }}
              className={`${inputCls} !py-2`}
            />
            <button type="button" onClick={commit} className="text-sm font-semibold">Save</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold truncate">{user.name}</h2>
            <button type="button" onClick={() => { setDraft(user.name); setEditing(true); }} aria-label="Edit name" className="p-1 text-neutral-500">
              <Icon name="edit" size={16} />
            </button>
          </div>
        )}
        <p className="text-sm text-neutral-500">
          {rep.rides} ride{rep.rides === 1 ? "" : "s"} · {rep.drives} drive{rep.drives === 1 ? "" : "s"}
          {miles > 0 && ` · ${formatDistance(miles, { unit: units })} driven`}
        </p>
        {photoRequired && !user.picture && <p className="text-amber-700 text-xs mt-1">A face photo is required to drive.</p>}
        {err && <p className="text-red-600 text-xs mt-1">{err}</p>}
        {user.picture && (
          // A driver must have a photo, so offer a change; a rider may remove it.
          <button type="button" onClick={() => (photoRequired ? fileRef.current?.click() : save({ picture: "" }))} className="text-xs text-neutral-500 underline mt-1">
            {photoRequired ? "Change photo" : "Remove photo"}
          </button>
        )}
      </div>
      {lightbox && (
        <div className="fixed inset-0 flex items-center justify-center p-4 bg-[#000]/90" style={{ zIndex: 10060 }} onClick={() => setLightbox(false)}>
          <img src={user.picture} alt="Your photo" className="max-w-[92vw] max-h-[85vh] object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}

// Ways for the other person to reach you (shown on the ride screens).
export function ContactMethods() {
  const { user } = useApp();
  const save = useSaveProfile();
  const comm = user.comm || [];
  const [platform, setPlatform] = useState(CONTACT_PLATFORMS[0]);
  const [handle, setHandle] = useState("");
  const add = () => {
    if (!handle.trim()) return;
    save({ comm: [...comm, { platform, handle: handle.trim() }] });
    setHandle("");
  };
  return (
    <div>
      <SectionLabel>Contact methods</SectionLabel>
      <p className="text-neutral-500 text-sm mb-3">
        The other person can use these to reach you during a trip.
      </p>
      {comm.map((c, i) => (
        <div key={i} className="flex items-center justify-between py-2 border-b border-neutral-100">
          <span className="text-[15px]">{c.platform}: <span className="text-neutral-600">{c.handle}</span></span>
          <button type="button" onClick={() => save({ comm: comm.filter((_, j) => j !== i) })} className="text-sm text-red-600 font-medium">Remove</button>
        </div>
      ))}
      <div className="flex gap-2 mt-3">
        <select
          value={platform}
          aria-label="Contact platform"
          onChange={(e) => setPlatform(e.target.value)}
          className={`${inputCls} !w-[7.5rem] !px-3`}
        >
          {CONTACT_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input
          aria-label="Contact handle or number"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Handle or number"
          className={`${inputCls} min-w-0`}
        />
        <Button size="md" full={false} onClick={add} disabled={!handle.trim()} className="px-4">Add</Button>
      </div>
    </div>
  );
}

// People this user blocked: add one by npub (or from their profile), keep a private note, unblock.
export function BlockedSection() {
  const { user, blocked, blockUser, unblockUser, setBlockNote } = useApp();
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    setError("");
    const r = parsePubkey(text);
    if (r.error) return setError(r.error);
    if (r.pubkey === user.publicKey) return setError("That is your own key. You cannot block yourself.");
    if (blocked.some((b) => b.pubkey === r.pubkey)) return setError("This person is already blocked.");
    setText("");
    relay.fetchProfile(r.pubkey); // their name, when a relay has it
    blockUser(r.pubkey, "");
  };

  return (
    <div>
      <SectionLabel>Blocked users</SectionLabel>
      <p className="text-neutral-500 text-sm mb-3">
        Add someone by npub, or from their profile. Blocking is saved on this device and the other person is not told.
      </p>
      <div className="flex gap-2">
        <input
          aria-label="npub of a person to block"
          value={text}
          onChange={(e) => { setText(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); add(); } }}
          placeholder="npub1…"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          className={`${inputCls} min-w-0 !text-sm font-mono`}
        />
        <Button size="md" full={false} className="px-4" onClick={add} disabled={!text.trim()}>Add</Button>
      </div>
      {error && <p className="text-red-600 text-xs mt-2" role="alert">{error}</p>}
      {blocked.length === 0 ? (
        <p className="text-neutral-500 text-sm mt-3">No one blocked.</p>
      ) : (
        <ul className="mt-2" aria-label="Blocked people">
          {blocked.map((b) => {
            const name = b.name || shortNpub(b.pubkey);
            return (
              <li key={b.pubkey} className="py-3 border-b border-neutral-100">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] truncate">{name}</span>
                  <button type="button" onClick={() => unblockUser(b.pubkey)} className="text-sm font-medium underline shrink-0">Unblock</button>
                </div>
                <BlockNote name={name} note={b.note || ""} onSave={(note) => setBlockNote(b.pubkey, note)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// A note the person keeps about someone they blocked. It stays with the block list (and the encrypted settings backup),
// and is saved when the field loses focus or Enter is pressed.
function BlockNote({ name, note, onSave }) {
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
        placeholder="Add a note (only you can see it)"
        rows={1}
        maxLength={300}
        className="w-full bg-neutral-100 rounded-lg px-3 py-2 text-sm text-black placeholder-neutral-500 border border-transparent focus:outline-none focus:border-black focus:bg-white resize-y"
      />
      {saved && <p className="text-xs text-neutral-500 mt-1" role="status">Saved</p>}
    </div>
  );
}

export function RelaysSection() {
  const relays = useRelays();
  return (
    <div>
      <SectionLabel>Nostr relays</SectionLabel>
      <p className="text-neutral-500 text-sm mb-3">
        Rides travel over these relays. Saved on this device; changes apply right away.
      </p>
      <RelayEditor relays={relays} onChange={setRelays} />
    </div>
  );
}

export function LogoutButton() {
  const { logout, ecash } = useApp();
  const [ask, setAsk] = useState(false);
  const holds = ecash ? ecash.total() : 0;
  return (
    <div>
      <Button variant="secondary" onClick={() => setAsk(true)}>
        <Icon name="logout" size={18} /> Log out
      </Button>
      <p className="text-neutral-500 text-xs text-center mt-2">
        Logging out also removes your saved key from this device. Keep a copy of your nsec.
      </p>
      <p className="text-neutral-400 text-xs text-center mt-4" aria-label="App version">{APP_NAME} · version {BUILD_ID}</p>
      <ConfirmDialog
        open={ask}
        title="Log out of the app?"
        message={`This removes your saved key from this device. You need your nsec (or password) to get back into ${APP_NAME}.${holds > 0 ? ` Your ecash (${holds.toLocaleString()} sats) stays on this device, locked with your key. Without your nsec you cannot open it.` : ""}${!IS_DRIVER_APP ? " Any ride request still waiting for a driver, including a reservation, is closed." : ""}`}
        confirmLabel="Log out"
        cancelLabel="Stay logged in"
        danger
        onConfirm={() => { setAsk(false); logout(); }}
        onCancel={() => setAsk(false)}
      />
    </div>
  );
}
