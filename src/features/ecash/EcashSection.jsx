// ════════════════════════════════════════════════════════════
//  ECASH SECTION — The ecash part of Account → Wallets (WalletsSection.jsx), in both faces. `children` (the cash out location)
//  is drawn after the balance, so the Wallets section reads top to bottom as one.
//  A ride is paid tick by tick in ecash (lib/ticks.js): the rider pays
//  from this wallet, the driver is paid into it.
//    • balance, per mint;  Add funds (Lightning or on-chain → ecash) and Send, side by side
//    • the mint:  a driver is paid at it; a rider starts "Add funds" there
//    • paste an ecash token to add it to the wallet
//    • back up the wallet as tokens (ecash is cash: whoever holds a token owns it)
//    (the 12-word recovery phrase that brings the ecash back on a new phone is its own Account part: RecoverySection.jsx)
//    • Cash out to the Lightning address (the cash out location, below the balance) in both apps; the driver also has "Automatically cash out at: $" (AutoCashOutField, runs in useAutoCashOut)
//    • Send ecash (SendEcash): a token for another ecash wallet, or a Lightning invoice / address
//    • Disconnect ecash from this device: the coins are swapped for new ones (a copy taken earlier is then worth nothing), then the coins
//      and the recovery phrase are erased HERE; the money stays at the mint and comes back with the 12 words.
//    • While this device has NO wallet (a new phone, or after Disconnect) this part shows WalletStart: Create New Wallet or Restore my wallet.
//  The ecash is saved on this device, encrypted to your key. Logging out keeps it.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { IS_DRIVER_APP } from "../../config/app.js";
import { SectionLabel, ConfirmDialog, inputCls } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import { cleanMintUrl, mintLabel } from "../../lib/mints.js";
import { requestInvoice, isLightningAddress } from "../../lib/lnurl.js";
import AddFunds from "../payments/AddFunds.jsx";
import SendEcash from "./SendEcash.jsx";
import AutoCashOutField from "./AutoCashOutField.jsx";
import { getMyMint, setMyMint } from "./myMint.js";
import WalletStart from "./WalletStart.jsx";

export default function EcashSection({ locked = false, children = null }) {
  const { ecash, ecashOff, disconnectEcash, user, btcPrice, pushNotice } = useApp();
  const [mint, setMint] = useState(getMyMint());
  const [draft, setDraft] = useState(mint);
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [backup, setBackup] = useState("");
  const [askOff, setAskOff] = useState(false);
  const [swapFailed, setSwapFailed] = useState(false);
  const draftUrl = cleanMintUrl(draft);
  const balances = ecash ? ecash.balances() : {};
  const total = ecash ? ecash.total() : 0;

  const saveMint = async () => {
    const url = cleanMintUrl(draft);
    if (!url) return setMsg("That is not a mint address. It must start with https://");
    setBusy("mint");
    setMsg("Checking the mint…");
    try {
      await ecash.checkMint(url); // a website that is not a mint is refused here, before anyone adds money to it
    } catch (e) {
      setBusy("");
      return setMsg(e.message || "That address did not answer as a mint.");
    }
    setBusy("");
    setMyMint(url);
    setMint(url);
    setDraft(url);
    setMsg(`Saved. ${IS_DRIVER_APP ? "New offers use" : "Add funds starts at"} ${mintLabel(url)}.`);
  };

  const redeem = async () => {
    setBusy("redeem");
    setMsg("");
    try {
      const r = await ecash.redeem(token.trim());
      setToken("");
      setMsg(`Added ${moneyText(r.sats, btcPrice)} from ${mintLabel(r.mint)}.`);
    } catch (e) {
      setMsg(e.message || "That token could not be redeemed.");
    }
    setBusy("");
  };

  const cashOut = async (url) => {
    setBusy("out");
    setMsg("");
    try {
      const r = await ecash.cashOut(url, async (sats) => (await requestInvoice(user.lud16, sats, "NostrRide cash out")).pr);
      setMsg(`Sent ${moneyText(r.paidSats, btcPrice)} to ${user.lud16}. Mint fee: ${r.feeSats} sats.`);
      pushNotice("Cash out sent.");
    } catch (e) {
      setMsg(e.message || "The cash out failed. Your ecash is still here.");
    }
    setBusy("");
  };

  // Take the wallet off this device. Refused (with the reason) while a payment is being sent, or while there is money and the 12 words are
  // not written down. If a mint cannot be reached to swap the coins, the person may go on anyway.
  const askDisconnect = () => {
    setMsg(""); setSwapFailed(false);
    if (total > 0 && !ecash.recovery.backedUp()) return setMsg("Write down your 12 words first (Recovery phrase). Without them, disconnecting would lose this money.");
    setAskOff(true);
  };
  const disconnect = async (force = false) => {
    setAskOff(false); setBusy("off"); setMsg("");
    try {
      await disconnectEcash({ force });
      pushNotice("Ecash was disconnected from this device.");
    } catch (e) {
      setSwapFailed(e.code === "swap");
      setMsg(e.message || "The wallet could not be disconnected.");
    }
    setBusy("");
  };

  if (ecashOff) {
    return (
      <section>
        <SectionLabel>Ecash wallet</SectionLabel>
        <WalletStart />
        {children}
      </section>
    );
  }

  return (
    <section>
      <SectionLabel>Ecash wallet</SectionLabel>
      <p className="text-sm text-neutral-500 mb-3">Add ecash here before you ride.</p>
      {!ecash && <p className="text-sm text-neutral-500" role="status">Loading your wallet…</p>}
      {ecash && (
        <>
          <div className="rounded-2xl bg-neutral-100 p-5">
            <p className="text-neutral-500 text-xs">Balance</p>
            <Money sats={total} stacked className="text-3xl font-bold" />
            {Object.entries(balances).map(([url, sats]) => (
              <div key={url} className="flex items-center gap-2 mt-3 text-sm">
                <span className="flex-1 min-w-0 truncate text-neutral-600">{mintLabel(url)}</span>
                <span className="font-semibold tabular-nums">{sats.toLocaleString()} sats</span>
                {user.lud16 && (
                  <button type="button" onClick={() => cashOut(url)} disabled={busy === "out" || locked} className="text-xs font-semibold underline disabled:text-neutral-400">
                    {busy === "out" ? "Sending…" : "Cash out"}
                  </button>
                )}
              </div>
            ))}
            <div className="flex gap-2 mt-4">
              <Button size="md" onClick={() => setAdding(true)}><Icon name="zap" size={16} /> Add funds</Button>
              <Button size="md" variant="outline" onClick={() => setSending(true)} disabled={locked || total <= 0}>Send</Button>
            </div>
            {total > 0 && !user.lud16 && <p className="text-xs text-amber-700 mt-2">Set a cash out location (a Lightning address) below to cash out.</p>}
            {locked && <p className="text-xs text-neutral-500 mt-2">Cash out and sending are paused while a ride is running.</p>}
          </div>

          {IS_DRIVER_APP && <AutoCashOutField />}

          {children}

          <div className="mt-4">
            <p className="font-medium text-[15px]">{IS_DRIVER_APP ? "The mint you are paid at" : "Mint for adding funds"}</p>
            <p className="text-xs text-neutral-500 mb-2">
              A mint holds the money behind ecash, so use one you trust.
              {IS_DRIVER_APP ? " Riders pay you at this mint. It cannot change for a ride that has started." : " During a ride you pay at the mint of the driver you choose."}
            </p>
            <div className="flex gap-2">
              <input aria-label="Ecash mint address" value={draft} onChange={(e) => { setDraft(e.target.value); setMsg(""); }} disabled={locked}
                placeholder="https://mint.example.com" spellCheck={false} className={`${inputCls} min-w-0 !text-sm`} />
              <Button size="md" full={false} className="px-4" onClick={saveMint} loading={busy === "mint"} disabled={locked || !draftUrl || draftUrl === mint}>Save</Button>
            </div>
            {locked && <p className="text-xs text-neutral-500 mt-1">Locked while a ride or an offer is open.</p>}
          </div>

          <div className="mt-4">
            <p className="font-medium text-[15px]">Add ecash you were sent</p>
            <div className="flex gap-2 mt-1">
              <input aria-label="Ecash token" value={token} onChange={(e) => { setToken(e.target.value); setMsg(""); }} placeholder="cashuB…" spellCheck={false} className={`${inputCls} min-w-0 !text-sm font-mono`} />
              <Button size="md" full={false} className="px-4" onClick={redeem} disabled={!token.trim()} loading={busy === "redeem"}>Add</Button>
            </div>
          </div>

          {total > 0 && (
            <div className="mt-4">
              {backup ? (
                <div className="bg-neutral-100 rounded-xl p-3">
                  <p className="text-xs text-red-700 font-semibold mb-1">Keep this secret. Anyone with it can take your ecash.</p>
                  <p className="text-[11px] font-mono break-all text-neutral-600 max-h-32 overflow-y-auto">{backup}</p>
                  <div className="flex gap-4 mt-2">
                    <button type="button" onClick={() => navigator.clipboard?.writeText(backup)} className="text-sm font-semibold underline">Copy</button>
                    <button type="button" onClick={() => setBackup("")} className="text-sm font-semibold underline">Hide</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setBackup(ecash.exportTokens().map((t) => t.token).join("\n\n"))} className="text-sm font-semibold underline">Back up my ecash as tokens</button>
              )}
            </div>
          )}
          <div className="mt-4">
            <button type="button" onClick={askDisconnect} disabled={locked || busy === "off"} className="text-sm font-semibold underline text-red-600 disabled:text-neutral-400">
              {busy === "off" ? "Disconnecting…" : "Disconnect ecash from this device"}
            </button>
            <p className="text-xs text-neutral-500 mt-1">{locked ? "Not while a ride is running." : "Use this on a phone you are about to lose, sell or stop trusting. The money stays at the mint. Restore my wallet brings it back with your 12 words."}</p>
            {swapFailed && <Button variant="danger" size="md" className="mt-2" onClick={() => disconnect(true)}>Disconnect anyway</Button>}
          </div>
          {msg && <p className="text-sm text-neutral-700 mt-3" role="status">{msg}</p>}
          <p className="text-xs text-neutral-500 mt-3">
            Your ecash is saved on this device, encrypted with your key. If you lose the phone, your 12 recovery words bring it back (Restore my wallet). Logging out keeps it here.
          </p>
        </>
      )}
      {adding && <AddFunds mint={mint} onClose={() => setAdding(false)} />}
      {sending && <SendEcash onClose={() => setSending(false)} />}
      <ConfirmDialog open={askOff} title="Disconnect ecash from this device?" confirmLabel="Swap coins and disconnect" cancelLabel="Keep it"
        message={`Your coins are swapped for new ones first, so a copy of the old coins is worth nothing. Then the wallet and its 12 words are erased from this device.${total > 0 ? ` ${moneyText(total, btcPrice)} stays at the mint: you get it back with your 12 words.` : ""}`}
        onConfirm={() => disconnect(false)} onCancel={() => setAskOff(false)} />
    </section>
  );
}
