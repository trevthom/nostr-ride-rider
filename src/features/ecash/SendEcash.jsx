// ════════════════════════════════════════════════════════════
//  SEND ECASH — Send money from the ecash balance to another wallet, two ways:
//    • "Ecash token": the app takes the amount out of the wallet as a token (text starting cashuB…). Give the text to the other
//      person; their Cashu wallet (or this app's "Add ecash you were sent") adds it. A token is cash: anyone who has the text can take it.
//      Until the person taps Done the token is still tracked, so "Take it back" can return the money if nobody has taken it yet.
//    • "Lightning": pay a Lightning invoice, or a Lightning address (name@domain) with an amount. The mint pays it and charges a small fee.
//  The amount can be typed in local money or sats (AmountInput). Shown in both apps; locked while a ride is running.
//
//    <SendEcash onClose={…} />
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { Modal, inputCls } from "../../ui/Parts.jsx";
import AmountInput from "../../ui/AmountInput.jsx";
import Button from "../../ui/Button.jsx";
import { moneyText } from "../../ui/Money.jsx";
import { mintLabel } from "../../lib/mints.js";
import { isLightningAddress, requestInvoice, invoiceAmountMsat } from "../../lib/lnurl.js";
import { getMyMint } from "./myMint.js";

const cleanInvoice = (s) => String(s || "").trim().replace(/^lightning:/i, "");
const isInvoice = (s) => /^ln(bc|tb|bcrt|sb)\d*[munp]?1[0-9a-z]+$/i.test(cleanInvoice(s));

export default function SendEcash({ onClose }) {
  const { ecash, btcPrice } = useApp();
  const balances = ecash ? ecash.balances() : {};
  const mints = Object.keys(balances);
  const mine = getMyMint();
  const [mint, setMint] = useState(balances[mine] ? mine : mints.sort((a, b) => balances[b] - balances[a])[0] || "");
  const [how, setHow] = useState("token"); // "token" | "lightning"
  const [sats, setSats] = useState(null);
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState(null); // { id, token, sats }: made, not yet handed over
  const tokenRef = useRef(null);
  tokenRef.current = token;
  const walletRef = useRef(ecash);
  walletRef.current = ecash;
  // The token text is on screen and can be copied: while this dialog is open the wallet must not take the coins back
  // (recoverPending), or the same token could be handed over AND spent from the wallet. Closing without "Done" releases it
  // (the ref keeps the wallet even when the dialog is unmounted by a logout).
  useEffect(() => () => { if (tokenRef.current) walletRef.current?.holdOff(tokenRef.current.id); }, []);
  const [result, setResult] = useState(""); // a finished message
  const have = balances[mint] || 0;

  const invoice = isInvoice(dest);
  const address = !invoice && isLightningAddress(dest);
  const invoiceSats = invoice ? Math.round((invoiceAmountMsat(cleanInvoice(dest)) || 0) / 1000) : 0;
  const needsAmount = how === "token" || address;

  const run = async (fn) => {
    setBusy("go"); setError("");
    try { await fn(); } catch (e) { setError(e?.message || "That did not work. Your ecash is still here."); }
    setBusy("");
  };

  const makeToken = () => run(async () => {
    if (!sats) throw new Error("Enter an amount.");
    setToken(await ecash.pay(mint, sats, { hold: true }));
  });

  const sendLightning = () => run(async () => {
    let pr = cleanInvoice(dest);
    if (invoice) {
      if (!invoiceSats) throw new Error("That invoice has no amount. Ask for one with an amount.");
    } else if (address) {
      if (!sats) throw new Error("Enter an amount.");
      pr = (await requestInvoice(dest.trim(), sats, "NostrRide")).pr;
    } else {
      throw new Error("Paste a Lightning invoice, or a Lightning address like name@wallet.com.");
    }
    const r = await ecash.payInvoice(mint, pr);
    setResult(`Sent ${moneyText(r.paidSats, btcPrice)}. Mint fee: ${r.feeSats} sats.`);
  });

  const takeBack = () => run(async () => {
    const r = await ecash.reclaim(token.id);
    setToken(null);
    setResult(r === "back"
      ? "Nobody had taken it. The money is back in your wallet."
      : r === "taken"
        ? "The other person has already taken it."
        // Not a guess: this wallet does not hold that token any more. Saying "taken" would be a lie about money.
        : "This wallet no longer holds that token. If nobody took it, its money is back in your balance; treat the text as used either way.");
  });

  const done = () => { if (token) ecash.settle(token.id); onClose(); };

  if (token) {
    return (
      <Modal open title="Your ecash token" onClose={done}>
        <p className="text-sm text-neutral-600">
          This token is worth {moneyText(token.sats, btcPrice)}. Send the text below to the person. They paste it into their ecash wallet.
        </p>
        <p className="text-xs text-red-700 font-semibold mt-2">Keep it secret until then. Anyone with this text can take the money.</p>
        <p className="mt-3 bg-neutral-100 rounded-xl p-3 text-[11px] font-mono break-all max-h-40 overflow-y-auto" data-testid="ecash-token">{token.token}</p>
        {error && <p className="text-sm text-red-600 mt-2" role="alert">{error}</p>}
        <div className="flex gap-2 mt-4">
          <Button size="md" onClick={() => navigator.clipboard?.writeText(token.token)}>Copy</Button>
          <Button size="md" variant="secondary" onClick={takeBack} loading={!!busy}>Take it back</Button>
        </div>
        <button type="button" onClick={done} className="w-full text-center text-sm font-semibold underline mt-4">Done</button>
      </Modal>
    );
  }

  return (
    <Modal open title="Send ecash" onClose={onClose}>
      {result ? (
        <>
          <p className="text-[15px]" role="status">{result}</p>
          <Button className="mt-4" onClick={onClose}>Done</Button>
        </>
      ) : !mints.length ? (
        <p className="text-sm text-neutral-600">There is no ecash in your wallet to send yet.</p>
      ) : (
        <>
          <div className="flex gap-2" role="group" aria-label="How to send">
            {[["token", "Ecash token"], ["lightning", "Lightning"]].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={how === id} onClick={() => { setHow(id); setError(""); }}
                className={`flex-1 py-2.5 rounded-full text-sm font-semibold ${how === id ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            {how === "token"
              ? "Makes a token you give to the other person. Works with any Cashu wallet."
              : "Pays a Lightning invoice or a Lightning address from your ecash. The mint charges a small fee."}
          </p>

          {mints.length > 1 && (
            <label className="block mt-3 text-sm">
              <span className="text-neutral-500 text-xs">From</span>
              <select value={mint} onChange={(e) => setMint(e.target.value)} className={`${inputCls} !text-sm`} aria-label="Send from this mint">
                {mints.map((u) => <option key={u} value={u}>{mintLabel(u)} · {balances[u].toLocaleString()} sats</option>)}
              </select>
            </label>
          )}

          {how === "lightning" && (
            <input aria-label="Lightning invoice or address" value={dest} onChange={(e) => { setDest(e.target.value); setError(""); }}
              placeholder="lnbc… or name@wallet.com" spellCheck={false} autoCapitalize="none" className={`${inputCls} mt-3 !text-sm font-mono`} />
          )}

          {needsAmount ? (
            <div className="mt-4">
              <AmountInput sats={sats} rate={btcPrice} min={1} max={have} onChange={setSats} label="Amount to send" />
            </div>
          ) : invoice ? (
            <p className="mt-4 text-center text-lg font-bold">{invoiceSats ? moneyText(invoiceSats, btcPrice) : "No amount in this invoice"}</p>
          ) : null}

          <p className="text-xs text-neutral-500 text-center mt-2">You have {moneyText(have, btcPrice)} here. The mint's fee comes on top.</p>
          {error && <p className="text-sm text-red-600 mt-2" role="alert">{error}</p>}
          <Button className="mt-4" onClick={how === "token" ? makeToken : sendLightning} loading={!!busy}
            disabled={how === "token" ? !sats : !(invoice ? invoiceSats : address && sats)}>
            {how === "token" ? "Make token" : "Send"}
          </Button>
        </>
      )}
    </Modal>
  );
}
