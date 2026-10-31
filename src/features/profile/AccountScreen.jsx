// ════════════════════════════════════════════════════════════
//  ACCOUNT — The rider's account screen. Every setting a rider has is here: the same person, the same wallet, the same
//  profile. The home screen is a list of rows, and each row opens its own screen with a back arrow in the top left; a
//  setting is never hidden behind an accordion.
//
//    Appearance          Dark Mode (application), Dark Mode (map), Units
//    Wallets             Currency, the ecash wallet (+ cash out location), the recovery phrase
//    People & Privacy    Contact methods and Trusted contacts (right here), then Your vouches and Blocked users (screens)
//    Nostr relays
//    Your keys
//
//  The screens of the faces are thin wrappers: they pass what this shared screen cannot read itself — `onRide` (the
//  wallet is frozen during a ride). The Account screen last open is remembered for this tab (lib/session.js), so a
//  reload stays on it.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { ModeSwitch } from "../../ui/ModeSwitch.jsx";
import { Row } from "../../ui/Parts.jsx";
import { ScreenBody } from "../../ui/Fold.jsx";
import { useRelays } from "../../config/relays.js";
import { loadAccountPage, saveAccountPage } from "../../lib/session.js";
import { AccountHeader, ContactMethods, RelaysSection, BlockedSection, LogoutButton } from "./ProfileParts.jsx";
import SafetySection from "./SafetySection.jsx";
import VouchesSection from "./VouchesSection.jsx";
import WalletsSection from "./WalletsSection.jsx";
import AppearanceSection from "./AppearanceSection.jsx";
import KeysSection from "./KeysSection.jsx";
import { RecoveryNotice, startRecoverySetup } from "../ecash/RecoverySection.jsx";

// Where the back arrow goes: the screen the person came from (Your vouches and Blocked users sit inside People & Privacy).
const PARENT = { vouches: "people", blocked: "people" };

export default function AccountScreen({ onRide = false }) {
  const { user } = useApp();
  const [page, setPage] = useState(() => loadAccountPage()); // home | appearance | wallets | …
  const relays = useRelays();
  const go = (next) => { setPage(next); saveAccountPage(next); };
  const back = () => go(PARENT[page] || "home");

  if (page !== "home") {
    const pages = {
      appearance: { title: "Appearance", body: <ScreenBody><AppearanceSection /></ScreenBody> },
      wallets: { title: "Wallets", body: <WalletsSection locked={onRide} /> },
      people: { title: "People & Privacy", body: <PeoplePage onOpen={go} /> },
      vouches: { title: "Your vouches", body: <ScreenBody><VouchesSection /></ScreenBody> },
      blocked: { title: "Blocked users", body: <ScreenBody><BlockedSection /></ScreenBody> },
      relays: { title: "Nostr relays", body: <ScreenBody><RelaysSection /></ScreenBody> },
      keys: { title: "Your keys", body: <ScreenBody><KeysSection user={user} /></ScreenBody> },
    };
    const found = pages[page];
    if (found) {
      return <Screen title={found.title} onBack={back}>{found.body}</Screen>;
    }
    // A screen that no longer exists (an old saved page): show the list again.
  }

  return (
    <Screen title="Account" right={<ModeSwitch />}>
      <div className="space-y-7">
        <AccountHeader />
        <RecoveryNotice onOpen={() => { go("wallets"); startRecoverySetup(); }} />
        <div className="border-t border-neutral-200 divide-y divide-neutral-100">
          <Row icon="sun" title="Appearance" subtitle="Dark mode, units" onClick={() => go("appearance")} />
          <Row icon="wallet" title="Wallets" subtitle="Currency, ecash, recovery phrase" onClick={() => go("wallets")} />
          <Row icon="shield" title="People & Privacy" subtitle="Contacts, vouches, blocked users" onClick={() => go("people")} />
          <Row icon="zap" title="Nostr relays" subtitle={`${relays.length} relay${relays.length === 1 ? "" : "s"}`} onClick={() => go("relays")} />
          <Row icon="eye" title="Your keys" subtitle="Your npub and nsec" onClick={() => go("keys")} />
        </div>
        <LogoutButton />
      </div>
    </Screen>
  );
}

// Contact methods and Trusted contacts are shown right here, as they were when their section was open. The other two
// open their own screens.
function PeoplePage({ onOpen }) {
  return (
    <div className="space-y-7">
      <ContactMethods />
      <SafetySection />
      <div className="border-t border-neutral-200 divide-y divide-neutral-100">
        <Row icon="star" title="Your vouches" subtitle="People you know and trust" onClick={() => onOpen("vouches")} />
        <Row icon="eye-off" title="Blocked users" subtitle="People who cannot see you or your rides" onClick={() => onOpen("blocked")} />
      </div>
    </div>
  );
}
