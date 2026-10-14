// ════════════════════════════════════════════════════════════
//  ECASH SECTION — The Account part for the ecash wallet, in both apps.
//  A ride is paid tick by tick in ecash (lib/ticks.js): the rider pays
//  from this wallet, the driver is paid into it.
//    • balance, per mint;  Add funds (Lightning → ecash)
//    • the mint:  a driver is paid at it; a rider starts "Add funds" there
//    • paste an ecash token to add it to the wallet
//    • back up the wallet as tokens (ecash is cash: whoever holds a token owns it)
//    • driver: cash out to their Lightning address, or into their Strike account as Bitcoin or US dollars (the driver chooses)
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
import { requestInvoice } from "../../lib/lnurl.js";
import { strikeAmountText } from "../../lib/strike.js";
import CurrencyChoice from "../payments/CurrencyChoice.jsx";
import AddFunds from "../payments/AddFunds.jsx";
import { getMyMint, setMyMint } from "./myMint.js";

export default function EcashSection({ locked = false }) {
  const { ecash, user, btcPrice, usdPrice, strike, pushNotice } = useApp();
  const strikeOut = IS_DRIVER_APP && strike.connected; // a driver can cash out into Strike
  const [confirmOut, setConfirmOut] = useState(null); // the mint whose balance is about to go to Strike
  const [mint, setMint] = useState(getMyMint());
  const [draft, setDraft] = useState(mint);
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [backup, setBackup] = useState("");
  const draftUrl = cleanMintUrl(draft);
  const balances = ecash ? ecash.balances() : {};
  const total = ecash ? ecash.total() : 0;

  const saveMint = () => {
    const url = setMyMint(draft);
    if (!url) return setMsg("That is not a mint address. It must start with https://");
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
      pushNotice("Cash out sent to your Lightning address.");
    } catch (e) {
      setMsg(e.message || "The cash out failed. Your ecash is still here.");
    }
    setBusy("");
  };

  // Into Strike: it makes the invoice in the currency the driver chose (lib/strike.js receiveInvoice), the mint pays it.
  const cashOutStrike = async (url) => {
    setConfirmOut(null);
    setBusy("out");
    setMsg("");
    try {
      const made = [];
      const r = await ecash.cashOut(url, async (sats) => {
        const inv = await strike.client.receiveInvoice({ sats, currency: strike.receive, usdPerBtc: usdPrice });
        made.push(inv);
        return inv.bolt11;
      });
      const inv = made.find((i) => i.sats === r.paidSats);
      setMsg(`Sent ${moneyText(r.paidSats, btcPrice)} to Strike${inv ? `. Strike received ${strikeAmountText(inv.receive)}` : ""}. Mint fee: ${r.feeSats} sats.`);
      pushNotice("Cash out sent to Strike.");
      strike.refresh().catch(() => {});
    } catch (e) {
      setMsg(e.message || "The cash out failed. Your ecash is still here.");
    }
    setBusy("");
  };
  // What a Strike cash out of this balance is worth, as a guess to show before the driver confirms.
  const guess = (sats) => (strike.receive === "USD"
    ? (usdPrice ? `about ${strikeAmountText({ currency: "USD", amount: ((sats * usdPrice) / 1e8).toFixed(2) })} in US dollars` : "in US dollars at Strike's rate")
    : `${sats.toLocaleString()} sats as Bitcoin, less the mint's fee`);

  return (
    <section>
      <SectionLabel>Ecash wallet</SectionLabel>
      <p className="text-sm text-neutral-500 mb-3">
        {IS_DRIVER_APP
          ? "Riders pay you in ecash while the ride runs: your base rate when it starts, then every mile and every minute. It is yours the moment it arrives."
          : "You pay your driver in ecash while the ride runs: the base rate when it starts, then every mile and every minute. Add money here with Lightning before you ride."}
      </p>
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
                {strikeOut && (
                  <button type="button" onClick={() => setConfirmOut(url)} disabled={busy === "out" || locked} className="text-xs font-semibold underline disabled:text-neutral-400">
                    {busy === "out" ? "Sending…" : "Cash out to Strike"}
                  </button>
                )}
                {IS_DRIVER_APP && user.lud16 && (
                  <button type="button" onClick={() => cashOut(url)} disabled={busy === "out" || locked} className="text-xs font-semibold underline disabled:text-neutral-400">
                    {busy === "out" ? "Sending…" : strikeOut ? "To my address" : "Cash out"}
                  </button>
                )}
              </div>
            ))}
            <div className="flex gap-2 mt-4">
              <Button size="md" onClick={() => setAdding(true)}><Icon name="zap" size={16} /> Add funds</Button>
            </div>
            {IS_DRIVER_APP && total > 0 && !user.lud16 && !strikeOut && <p className="text-xs text-amber-700 mt-2">Set a Lightning address, or link Strike, to cash out.</p>}
            {strikeOut && total > 0 && (
              <div className="mt-3">
                <p className="text-xs text-neutral-500 mb-1">Cash out to Strike as</p>
                <CurrencyChoice value={strike.receive} onChange={strike.setReceive} label="Cash out to Strike as" disabled={locked || busy === "out"} />
              </div>
            )}
            {IS_DRIVER_APP && locked && <p className="text-xs text-neutral-500 mt-2">Cash out is paused while a ride is running.</p>}
          </div>

          <div className="mt-4">
            <p className="font-medium text-[15px]">{IS_DRIVER_APP ? "The mint you are paid at" : "Mint for adding funds"}</p>
            <p className="text-xs text-neutral-500 mb-2">
              A mint holds the money behind ecash, so use one you trust.
              {IS_DRIVER_APP ? " Riders pay you at this mint. It cannot change for a ride that has started." : " During a ride you pay at the mint of the driver you choose."}
            </p>
            <div className="flex gap-2">
              <input aria-label="Ecash mint address" value={draft} onChange={(e) => { setDraft(e.target.value); setMsg(""); }} disabled={locked}
                placeholder="https://mint.example.com" spellCheck={false} className={`${inputCls} min-w-0 !text-sm`} />
              <Button size="md" full={false} className="px-4" onClick={saveMint} disabled={locked || !draftUrl || draftUrl === mint}>Save</Button>
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
          {msg && <p className="text-sm text-neutral-700 mt-3" role="status">{msg}</p>}
          <p className="text-xs text-neutral-500 mt-3">
            Your ecash is saved on this device, encrypted with your key. Keep a copy of your nsec and back up large amounts. Logging out keeps it here.
          </p>
        </>
      )}
      <ConfirmDialog open={!!confirmOut} title="Cash out to Strike?" confirmLabel="Cash out" cancelLabel="Keep"
        message={confirmOut ? `${(balances[confirmOut] || 0).toLocaleString()} sats go to your Strike account: ${guess(balances[confirmOut] || 0)}. Strike's own rate decides the final amount.` : ""}
        onConfirm={() => cashOutStrike(confirmOut)} onCancel={() => setConfirmOut(null)} />
      {adding && <AddFunds mint={mint} onClose={() => setAdding(false)} />}
    </section>
  );
}
