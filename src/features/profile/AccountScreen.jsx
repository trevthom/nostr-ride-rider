// ════════════════════════════════════════════════════════════
//  ACCOUNT — ONE account screen for both faces of the app. Every setting is here whichever face is showing (Ride or
//  Drive): the same person, the same wallet, the same profile. The home screen is a list of rows, and each row opens
//  its own screen with a back arrow in the top left; a setting is never hidden behind an accordion.
//
//    Appearance          Dark Mode (application), Dark Mode (map), Units
//    Wallets             Currency, the ecash wallet (+ cash out location), the recovery phrase
//    Driver settings     Vehicle & plate and Your rates (required to drive), then Requests (radius, alerts) and Gender (optional)
//    People & Privacy    Contact methods and Trusted contacts (right here), then Your vouches and Blocked users (screens)
//    Nostr relays
//    Your keys
//
//  The screens of the two faces are thin wrappers: they pass what this shared screen cannot read itself — `onRide`
//  (the rates and the wallet are frozen during a ride) and `driving` (the live radius/alerts: DriverContext on the
//  Drive face, the saved settings on the Ride face). The Account screen last open is remembered for this tab
//  (lib/session.js), so a reload stays on it.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { ModeSwitch } from "../../ui/ModeSwitch.jsx";
import Icon from "../../ui/Icon.jsx";
import { Row, Toggle, SectionLabel, inputCls } from "../../ui/Parts.jsx";
import { ScreenBody } from "../../ui/Fold.jsx";
import { useRelays } from "../../config/relays.js";
import { driveGaps } from "../../lib/profile.js";
import { useUnits, distanceIn, milesFrom } from "../../lib/units.js";
import { loadAccountPage, saveAccountPage } from "../../lib/session.js";
import { AccountHeader, ContactMethods, RelaysSection, BlockedSection, LogoutButton, useSaveProfile } from "./ProfileParts.jsx";
import SafetySection from "./SafetySection.jsx";
import VouchesSection from "./VouchesSection.jsx";
import WalletsSection from "./WalletsSection.jsx";
import AppearanceSection from "./AppearanceSection.jsx";
import VehicleSection from "./VehicleSection.jsx";
import TypicalFareSection from "./TypicalFareSection.jsx";
import KeysSection from "./KeysSection.jsx";
import { RecoveryNotice, startRecoverySetup } from "../ecash/RecoverySection.jsx";

const GENDERS = [["", "Not set"], ["female", "Female"], ["male", "Male"]];

// Where the back arrow goes: the screen the person came from (Your vouches and Blocked users sit inside People & Privacy).
const PARENT = { vouches: "people", blocked: "people" };

export default function AccountScreen({ onRide = false, driving }) {
  const { user } = useApp();
  const [page, setPage] = useState(() => loadAccountPage()); // home | appearance | wallets | …
  const relays = useRelays();
  const go = (next) => { setPage(next); saveAccountPage(next); };
  const back = () => go(PARENT[page] || "home");

  if (page !== "home") {
    const pages = {
      appearance: { title: "Appearance", body: <ScreenBody><AppearanceSection /></ScreenBody> },
      wallets: { title: "Wallets", body: <WalletsSection locked={onRide} /> },
      driver: { title: "Driver settings", body: <DriverSettings locked={onRide} {...driving} /> },
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

  const gaps = driveGaps(user);
  return (
    <Screen title="Account" right={<ModeSwitch />}>
      <div className="space-y-7">
        <AccountHeader photoRequired={!!(user.vehicle?.make || user.vehicle?.plateNumber)} />
        <RecoveryNotice onOpen={() => { go("wallets"); startRecoverySetup(); }} />
        <div className="border-t border-neutral-200 divide-y divide-neutral-100">
          <Row icon="sun" title="Appearance" subtitle="Dark mode, units" onClick={() => go("appearance")} />
          <Row icon="wallet" title="Wallets" subtitle="Currency, ecash, recovery phrase" onClick={() => go("wallets")} />
          <Row
            icon="car"
            title="Driver settings"
            subtitle={gaps.length ? "Vehicle & plate, your rates · setup needed" : "Vehicle & plate, your rates"}
            right={
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 whitespace-nowrap">Required to drive</span>
                <Icon name="chevron-right" size={18} className="text-neutral-400" />
              </span>
            }
            onClick={() => go("driver")}
          />
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

// The driver's setup — this is what makes someone able to drive. The vehicle and the rates are the required parts (both
// are frozen for a running ride, `locked`); the request radius, the alerts and the gender are optional.
function DriverSettings({ locked, radius, setRadius, alerts, setAlerts }) {
  const { user } = useApp();
  const save = useSaveProfile();
  const gaps = driveGaps(user);
  return (
    <div className="space-y-7">
      <VehicleSection
        vehicle={user.vehicle}
        ready={gaps.length === 0}
        onSave={(vehicle) => save({ vehicle })}
        gapsFor={(vehicle) => driveGaps({ ...user, vehicle })}
      />
      <TypicalFareSection rates={user.rates} onSave={(rates) => save({ rates })} locked={locked} />
      <RequestSettings radius={radius} setRadius={setRadius} alerts={alerts} setAlerts={setAlerts} />
      <GenderSetting />
    </div>
  );
}

// Request radius and new-request alerts. They were the "Driving" screen; there is no separate Driving section any more.
function RequestSettings({ radius, setRadius, alerts, setAlerts }) {
  const [units] = useUnits();
  return (
    <section>
      <SectionLabel>Requests</SectionLabel>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="font-medium">Request radius</p>
            <p className="text-sm text-neutral-500">Only show pickups this close.</p>
          </div>
          <input
            aria-label={`Request radius in ${units === "km" ? "kilometers" : "miles"}`}
            type="number"
            min="1"
            max={units === "km" ? 160 : 100}
            value={Math.round(distanceIn(radius, units))}
            onChange={(e) => setRadius(Math.min(100, Math.max(1, Math.round(milesFrom(parseInt(e.target.value, 10) || 1, units)))))}
            className={`${inputCls} !w-20 text-center`}
          />
          <span className="text-sm text-neutral-500">{units}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="font-medium">New request alerts</p>
            <p className="text-sm text-neutral-500">Banner and notification while you are online.</p>
          </div>
          <Toggle checked={alerts} onChange={setAlerts} label="New request alerts" />
        </div>
      </div>
    </section>
  );
}

function GenderSetting() {
  const { user } = useApp();
  const save = useSaveProfile();
  return (
    <section>
      <SectionLabel>Gender (optional)</SectionLabel>
      <p className="text-sm text-neutral-500 mb-3">
        Some riders ask to see drivers of one gender first. This only changes the order of their list. Nobody is hidden, and you can leave it unset.
      </p>
      <div className="flex gap-2" role="group" aria-label="Gender">
        {GENDERS.map(([id, label]) => (
          <button
            key={id || "none"}
            type="button"
            aria-pressed={(user.gender || "") === id}
            onClick={() => save({ gender: id })}
            className={`flex-1 py-2.5 rounded-full text-sm font-semibold ${(user.gender || "") === id ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
