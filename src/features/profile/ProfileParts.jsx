// ════════════════════════════════════════════════════════════
//  PROFILE PARTS — The Account-page pieces both apps share: the
//  header (photo, name, rating), contact methods, relay list, log out,
//  and useSaveProfile() which republishes the user's profile (kind 0).
// ════════════════════════════════════════════════════════════

import { useRef, useState, useCallback, useEffect } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { buildSignedEvent } from "../../nostr/events.js";
import { getMetadata } from "../../nostr/profiles.js";
import { shortNpub } from "../../nostr/keys.js";
import { sealVehicle } from "../../lib/privacy.js";
import { reputation } from "../../lib/rides.js";
import { resizeImage } from "../../lib/image.js";
import { useRelays, setRelays } from "../../config/relays.js";
import { CONTACT_PLATFORMS, } from "../../config/settings.js";
import { APP_NAME, IS_DRIVER_APP } from "../../config/app.js";
import Avatar from "../../ui/Avatar.jsx";
import { Rating } from "../../ui/Rating.jsx";
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
          {
            ...base,
            name: next.name,
            about: base.about ?? "NostrRide user",
            communication: next.comm || [],
            picture: next.picture || "",
            ...(next.lud16 !== undefined && { lud16: next.lud16 }),
            // Plate is sealed to ourselves; riders get it privately in offers.
            vehicle: sealVehicle(next.vehicle, next.sk, next.publicKey),
          },
          [],
          next.sk
        )
      );
      return next;
    },
    [setUser]
  );
}

// Photo, name (tap the pencil to edit), and the rating for this app's role.
export function AccountHeader({ photoRequired = false }) {
  const { user } = useApp();
  const save = useSaveProfile();
  const rep = reputation(user.publicKey);
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
    save({ name: draft.trim() || (IS_DRIVER_APP ? "Anonymous Driver" : "Anonymous Rider") });
    setEditing(false);
  };

  const role = IS_DRIVER_APP ? rep.driverReviews : rep.riderReviews;
  const trips = IS_DRIVER_APP ? rep.drives : rep.rides;

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
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Rating avg={role.avg} count={role.count} />
          <span>· {trips} trip{trips === 1 ? "" : "s"}</span>
        </div>
        {photoRequired && !user.picture && <p className="text-amber-700 text-xs mt-1">A face photo is required to drive.</p>}
        {err && <p className="text-red-600 text-xs mt-1">{err}</p>}
        {user.picture && (
          <button type="button" onClick={() => save({ picture: "" })} className="text-xs text-neutral-500 underline mt-1">Remove photo</button>
        )}
      </div>
      {lightbox && (
        <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/90" style={{ zIndex: 10060 }} onClick={() => setLightbox(false)}>
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
        Your {IS_DRIVER_APP ? "rider" : "driver"} can use these to reach you during a trip.
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

// People this user blocked, with Unblock.
export function BlockedSection() {
  const { blocked, unblockUser } = useApp();
  return (
    <div>
      <SectionLabel>Blocked people</SectionLabel>
      {blocked.length === 0 ? (
        <p className="text-neutral-500 text-sm">No one blocked. You can block someone from their profile or after a trip.</p>
      ) : (
        blocked.map((b) => (
          <div key={b.pubkey} className="flex items-center justify-between py-2 border-b border-neutral-100">
            <span className="text-[15px] truncate">{b.name || shortNpub(b.pubkey)}</span>
            <button type="button" onClick={() => unblockUser(b.pubkey)} className="text-sm font-medium underline">Unblock</button>
          </div>
        ))
      )}
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
  const { logout } = useApp();
  const [ask, setAsk] = useState(false);
  return (
    <div>
      <Button variant="secondary" onClick={() => setAsk(true)}>
        <Icon name="logout" size={18} /> Log out
      </Button>
      <p className="text-neutral-500 text-xs text-center mt-2">
        Logging out also removes your saved key from this device. Keep a copy of your nsec.
      </p>
      <ConfirmDialog
        open={ask}
        title="Log out of the app?"
        message={`This removes your saved key from this device. You need your nsec (or password) to get back into ${APP_NAME}.`}
        confirmLabel="Log out"
        cancelLabel="Stay logged in"
        danger
        onConfirm={() => { setAsk(false); logout(); }}
        onCancel={() => setAsk(false)}
      />
    </div>
  );
}
