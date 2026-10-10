// ════════════════════════════════════════════════════════════
//  AUTH SCREEN — First screen of both apps. Ways to sign in:
//    1. Generate a brand-new Nostr keypair (then a key-backup step).
//    2. Paste an existing "nsec1..." secret key.
//    3. Unlock a key saved on this device (password, NIP-49).
//  "Remember me" saves the key encrypted with a password, so a reload
//  doesn't log the user out (nostr/keystore.js).
//  A new key publishes a fresh profile. An existing key keeps its
//  Nostr profile (we never overwrite it with a blank one).
//  The headline changes with the app (rider / driver).
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { generateKeypair, keypairFromNsec, keypairFromSecretKey } from "../../nostr/keys.js";
import { buildSignedEvent } from "../../nostr/events.js";
import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { getMetadata, getProfile } from "../../nostr/profiles.js";
import { getSavedKey, saveKey, unlockKey, MIN_PASSWORD } from "../../nostr/keystore.js";
import { myVehicle } from "../../lib/privacy.js";
import { useRelays, setRelays } from "../../config/relays.js";
import { IS_DRIVER_APP, APP_NAME } from "../../config/app.js";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import RelayEditor from "../../ui/RelayEditor.jsx";
import ConnectionBanner from "../../ui/ConnectionBanner.jsx";
import { Field, inputCls } from "../../ui/Parts.jsx";
import { UnlockView, BackupStep } from "./AuthSteps.jsx";

const DEFAULT_NAME = IS_DRIVER_APP ? "Anonymous Driver" : "Anonymous Rider";
const COPY = IS_DRIVER_APP
  ? { tagline: "Drive. Get paid in sats.", sub: "Set your own hours. Riders pay you directly over Lightning." }
  : { tagline: "Get there. No middleman.", sub: "Rides arranged peer to peer on Nostr, paid over Lightning." };

// Let React paint a "busy" label before slow, blocking work (scrypt).
const nextFrame = () => new Promise((r) => setTimeout(r, 30));

export default function AuthScreen({ onLogin }) {
  const [saved] = useState(getSavedKey);
  const [stage, setStage] = useState(saved ? "unlock" : "form"); // "unlock" | "form" | "backup"
  const [mode, setMode] = useState("new"); // "new" | "import"
  const [name, setName] = useState("");
  const [nsec, setNsec] = useState("");
  const [remember, setRemember] = useState(true);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(null); // new keys waiting for the backup step
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRelays, setShowRelays] = useState(false); // collapsed by default
  const relays = useRelays();

  // Enter the app; save the key (encrypted) first if asked to.
  const enter = async (u, { save = remember } = {}) => {
    if (save) {
      setBusy(true);
      await nextFrame();
      saveKey(u.sk, password, { name: u.name });
      setBusy(false);
    }
    onLogin(u);
  };

  // A brand-new key: publish its first profile.
  const enterNew = (keys) => {
    const displayName = name.trim() || DEFAULT_NAME;
    relay.publish(
      buildSignedEvent(EVENT_KINDS.METADATA, { name: displayName, about: "NostrRide user", communication: [] }, [], keys.sk)
    );
    enter({ ...keys, name: displayName, comm: [] });
  };

  // An existing key. Kind 0 is shared by every Nostr app: publishing a
  // fresh one would wipe the user's real name, photo, and other fields on
  // every relay. So load what exists and keep it; only write when the user
  // typed a new name (merged into the old profile).
  const enterExisting = async (keys, { save } = {}) => {
    setBusy(true);
    await relay.fetchProfile(keys.publicKey);
    setBusy(false);
    const existing = getMetadata(keys.publicKey);
    const typed = name.trim();
    if (!existing) {
      if (typed) return enterNew(keys);
      return enter({ ...keys, name: saved?.name || DEFAULT_NAME, comm: [] }, { save });
    }
    const p = getProfile(keys.publicKey);
    if (typed && typed !== p.name) {
      relay.publish(buildSignedEvent(EVENT_KINDS.METADATA, { ...existing, name: typed }, [], keys.sk));
    }
    enter(
      { ...keys, name: typed || p.name || DEFAULT_NAME, comm: p.comm, picture: p.picture, lud16: p.lud16, vehicle: myVehicle(keys.publicKey, keys.sk) },
      { save }
    );
  };

  const passwordOk = () => {
    if (remember && password.length < MIN_PASSWORD) {
      setError(`Use a password of at least ${MIN_PASSWORD} characters, or turn off "Remember me".`);
      return false;
    }
    return true;
  };

  const handleGenerate = () => {
    setError("");
    if (!passwordOk()) return;
    setPending(generateKeypair());
    setStage("backup");
  };

  const handleImport = () => {
    if (busy) return;
    setError("");
    if (!passwordOk()) return;
    let keys;
    try {
      keys = keypairFromNsec(nsec);
    } catch (e) {
      setError(e.message || "Invalid nsec key.");
      return;
    }
    enterExisting(keys);
  };

  const handleUnlock = async (pw) => {
    setError("");
    setBusy(true);
    await nextFrame();
    let keys;
    try {
      keys = keypairFromSecretKey(unlockKey(pw));
    } catch (e) {
      setBusy(false);
      setError(e.message);
      return;
    }
    enterExisting(keys, { save: false }); // already saved
  };

  // Pressing Enter in a field triggers the screen's primary action.
  const submit = () => {
    if (mode === "new") handleGenerate();
    else if (nsec) handleImport();
  };
  const onEnter = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };

  return (
    <div className="h-[100dvh] overflow-y-auto bg-white mx-auto max-w-md sm:border-x sm:border-neutral-200">
      <ConnectionBanner />
      {/* Brand header */}
      <div className="bg-black text-white px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-10">
        <div className="w-12 h-12 rounded-xl bg-white text-black flex items-center justify-center mb-6">
          <Icon name="zap" size={26} fill="currentColor" strokeWidth={1.5} />
        </div>
        <h1 className="text-[32px] leading-9 font-bold tracking-tight">{APP_NAME}</h1>
        <p className="text-xl font-semibold mt-3">{COPY.tagline}</p>
        <p className="text-white/70 text-[15px] mt-1">{COPY.sub}</p>
      </div>

      <div className="px-6 py-6">
        {stage === "unlock" && (
          <UnlockView
            saved={saved}
            busy={busy}
            error={error}
            onUnlock={handleUnlock}
            onSwitch={() => { setStage("form"); setError(""); }}
          />
        )}

        {stage === "backup" && pending && <BackupStep nsec={pending.nsec} onContinue={() => enterNew(pending)} />}

        {stage === "form" && (
          <div className="space-y-4">
            {/* Mode switch */}
            <div className="flex bg-neutral-100 p-1 rounded-full" role="tablist">
              <Tab active={mode === "new"} onClick={() => { setMode("new"); setError(""); }}>Create account</Tab>
              <Tab active={mode === "import"} onClick={() => { setMode("import"); setError(""); }}>I have a key</Tab>
            </div>

            <Field label="Display name">
              <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} placeholder="Your name or alias" className={inputCls} />
            </Field>

            {mode === "import" && (
              <Field label="Secret key (nsec)">
                <input
                  value={nsec}
                  onChange={(e) => setNsec(e.target.value)}
                  onKeyDown={onEnter}
                  placeholder="nsec1..."
                  spellCheck={false}
                  autoComplete="off"
                  className={`${inputCls} text-xs font-mono`}
                />
              </Field>
            )}

            {/* Remember me: key saved encrypted with this password */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[15px] cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-black" checked={remember} onChange={(e) => { setRemember(e.target.checked); setError(""); }} />
                Remember me on this device
              </label>
              {remember && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  onKeyDown={onEnter}
                  placeholder={`Password to unlock (${MIN_PASSWORD}+ characters)`}
                  autoComplete="new-password"
                  aria-label="Password"
                  className={inputCls}
                />
              )}
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            {mode === "new" ? (
              <Button onClick={handleGenerate} disabled={busy}>Create account</Button>
            ) : (
              <Button onClick={handleImport} disabled={!nsec} loading={busy}>{busy ? "Loading your profile…" : "Continue"}</Button>
            )}

            <p className="text-neutral-500 text-xs text-center leading-relaxed">
              Your key is a real Nostr key made on this device. Nothing is sent to a server. “Remember me” saves it
              here only, encrypted with your password.
            </p>

            {/* Relays — collapsed by default */}
            <div className="border-t border-neutral-200 pt-3">
              <button
                type="button"
                onClick={() => setShowRelays((v) => !v)}
                aria-expanded={showRelays}
                className="w-full flex items-center justify-between text-neutral-500 text-xs font-semibold uppercase tracking-wider"
              >
                <span>Relays ({relays.length})</span>
                <Icon name={showRelays ? "chevron-up" : "chevron-down"} size={16} />
              </button>
              {showRelays && (
                <div className="mt-3">
                  <RelayEditor relays={relays} onChange={setRelays} />
                  <p className="text-neutral-500 text-xs mt-2">These are the Nostr relays the app connects to. Changes are saved on this device.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      type="button"
      role="tab"
      onClick={onClick}
      aria-selected={active}
      className={`flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${active ? "bg-black text-white" : "text-neutral-600"}`}
    >
      {children}
    </button>
  );
}
