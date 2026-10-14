// ════════════════════════════════════════════════════════════
//  STRIKE SECTION — The Account part for the optional Strike link, in both apps (lib/strike.js).
//    rider:  Strike SENDS the bitcoin. A ride is paid straight from the rider's Strike account (no ecash), and Add funds and
//            tips can be paid from it too. It pays from the Bitcoin balance or from dollars (Strike converts): the rider chooses.
//    driver: Strike RECEIVES. A ride is paid straight into the driver's Strike account (no ecash), and a cash out can go there
//            too. The driver chooses what Strike keeps it as: Bitcoin, or US dollars (Strike converts what arrives).
//  The person pastes their own API key. It is saved encrypted on this device; "Disconnect" erases it.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { IS_DRIVER_APP } from "../../config/app.js";
import { RIDER_SCOPES, DRIVER_SCOPES } from "../../lib/strike.js";
import { SectionLabel, Toggle, inputCls } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import CurrencyChoice from "../payments/CurrencyChoice.jsx";

export default function StrikeSection() {
  const { strike } = useApp();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const scopes = IS_DRIVER_APP ? DRIVER_SCOPES : RIDER_SCOPES;

  const connect = async () => {
    setBusy("connect");
    setError("");
    try {
      await strike.connect(key);
      setKey("");
    } catch (e) {
      setError(e.message || "Could not connect to Strike.");
    }
    setBusy("");
  };
  const refresh = async () => {
    setBusy("refresh");
    setError("");
    try { await strike.refresh(); } catch (e) { setError(e.message || "Could not read your Strike balance."); }
    setBusy("");
  };

  return (
    <section>
      <SectionLabel>Strike</SectionLabel>
      {!strike.connected ? (
        <div className="bg-neutral-100 rounded-xl border border-neutral-200 p-4">
          <p className="text-sm text-neutral-600 mb-2">
            {IS_DRIVER_APP
              ? "Link your Strike account to be paid for rides straight into it, with no ecash mint in between. You choose whether Strike keeps what you earn as Bitcoin or as US dollars. You can also cash out ecash into it."
              : "Link your Strike account to pay for rides straight from it, with no ecash to load first. Strike pays from your Bitcoin balance, or from your dollars and buys the bitcoin for you. It also adds funds and sends tips in one tap."}
          </p>
          <p className="text-xs text-neutral-500 mb-2">
            In Strike, open Developers and make an API key. Give it only {IS_DRIVER_APP ? "these permissions (the last is optional)" : "these permissions"}:
          </p>
          <ul className="text-xs font-mono text-neutral-600 mb-3 list-disc pl-5">{scopes.map((s) => <li key={s}>{s}</li>)}</ul>
          <input aria-label="Strike API key" type="password" autoComplete="off" value={key} onChange={(e) => { setKey(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && key && !busy) { e.preventDefault(); connect(); } }}
            placeholder="Paste your Strike API key" spellCheck={false} className={`${inputCls} !text-sm font-mono mb-2`} />
          {error && <p className="text-red-600 text-xs mb-2" role="alert">{error}</p>}
          <Button size="md" onClick={connect} disabled={!key.trim()} loading={busy === "connect"}>Connect Strike</Button>
          <p className="text-[11px] text-neutral-500 mt-2">The key stays on this device, encrypted with your Nostr key. Anyone with the key can spend from the permissions you gave it, so give it no more than the list above.</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-neutral-100 p-4">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-[15px] flex-1">Strike is connected{strike.sandbox ? " (sandbox)" : ""}</p>
            <button type="button" onClick={refresh} disabled={busy === "refresh"} className="text-blue-600 text-xs">{busy === "refresh" ? "Reading…" : "Refresh"}</button>
          </div>
          {!strike.balances && <p className="text-xs text-neutral-500 mt-1">Your balance is not shown. That is fine: this key may not read balances.</p>}

          {IS_DRIVER_APP ? (
            <div className="mt-3">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1">
                  <p className="font-medium text-[15px]">Be paid for rides straight into Strike</p>
                  <p className="text-xs text-neutral-500">Riders who use Strike pay you each mile and each minute. Keep this app open during the ride. Turn off to be paid in ecash only.</p>
                </div>
                <Toggle checked={strike.direct} onChange={strike.setDirect} label="Be paid for rides straight into Strike" />
              </div>
              <p className="font-medium text-[15px] mb-1">You receive as</p>
              <CurrencyChoice value={strike.receive} onChange={strike.setReceive} label="You receive as" balances={strike.balances}
                notes={{ BTC: "Exactly the sats of each payment.", USD: "Strike converts each payment to dollars when it arrives. The dollars are rounded to the cent." }} />
              <p className="text-xs text-neutral-500 mt-2">
                This applies to rides and to cash outs from this app, and is fixed for a ride once the rider picks you. Tips reach your Lightning address and follow your Strike account's own settings.
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1">
                  <p className="font-medium text-[15px]">Pay rides straight from Strike</p>
                  <p className="text-xs text-neutral-500">When your driver is paid in Strike, each mile and each minute is paid from your account. Turn off to pay rides with ecash.</p>
                </div>
                <Toggle checked={strike.direct} onChange={strike.setDirect} label="Pay rides straight from Strike" />
              </div>
              <p className="font-medium text-[15px] mb-1">Pay with</p>
              <CurrencyChoice value={strike.source} onChange={strike.setSource} label="Pay with" balances={strike.balances}
                notes={{ USD: "Strike buys the bitcoin for you." }} />
              <p className="text-xs text-neutral-500 mt-2">Funds and tips show their exact cost for you to confirm. A ride is paid as it runs: you confirm the driver once, before it starts.</p>
            </div>
          )}
          {error && <p className="text-red-600 text-xs mt-2" role="alert">{error}</p>}
          <button type="button" onClick={() => { strike.disconnect(); setError(""); }} className="text-red-600 text-sm font-semibold mt-4">Disconnect Strike</button>
          <p className="text-[11px] text-neutral-500 mt-1">This erases the key from this device. To cancel it everywhere, delete the key in Strike.</p>
        </div>
      )}
    </section>
  );
}
