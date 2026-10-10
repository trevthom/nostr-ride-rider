// ════════════════════════════════════════════════════════════
//  WALLET SECTION — Connect a Nostr Wallet Connect string, then
//  show the REAL balance + transactions fetched from your wallet,
//  and send / receive sats. Nothing is faked: if the wallet can't
//  be reached you see an error, not invented numbers.
// ════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { useApp } from "../../state/AppContext.jsx";
import {
  parseNwcUri,
  emptyWalletState,
  getBalance,
  listTransactions,
  payInvoice,
  makeInvoice,
  isInvoiceSettled,
} from "../../nostr/wallet.js";
import QRCode from "../../ui/QRCode.jsx";

export default function WalletSection() {
  const { wallet, setWallet, btcUsd } = useApp();
  const [uri, setUri] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const [balance, setBalance] = useState(null); // null = not loaded yet
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [panel, setPanel] = useState(null); // null | "send" | "receive"

  // Fetch real balance + transactions from the connected wallet.
  const refresh = useCallback(async () => {
    if (!wallet.connected) return;
    setLoading(true);
    setLoadError("");
    try {
      const [bal, history] = await Promise.all([getBalance(wallet), listTransactions(wallet)]);
      setBalance(bal);
      setTxns(history);
    } catch (e) {
      setLoadError(e.message || "Couldn't reach the wallet.");
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConnect = async () => {
    setError("");
    const parsed = parseNwcUri(uri);
    if (!parsed) {
      setError("That doesn't look like a valid NWC string (nostr+walletconnect://...).");
      return;
    }
    setConnecting(true);
    try {
      await getBalance(parsed); // probe: only connect if the wallet actually answers
      setWallet(parsed);
      setUri("");
    } catch (e) {
      setError(e.message || "Couldn't reach the wallet with that string.");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    setWallet(emptyWalletState());
    setBalance(null);
    setTxns([]);
    setPanel(null);
  };

  // ── Not connected: connect form ──
  if (!wallet.connected) {
    return (
      <div>
        <p className="text-neutral-500 text-xs uppercase tracking-wider font-semibold mb-2">Lightning Wallet</p>
        <div className="bg-neutral-100 rounded-xl border border-neutral-200 p-4">
          <p className="text-neutral-500 text-xs mb-3">
            Paste your Nostr Wallet Connect string to pay and get paid in sats. We read your real
            balance directly from your wallet.
          </p>
          <input aria-label="Nostr Wallet Connect string"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && uri && !connecting) { e.preventDefault(); handleConnect(); } }}
            placeholder="nostr+walletconnect://..."
            spellCheck={false}
            className="w-full bg-neutral-100 border border-neutral-200 rounded-lg px-3 py-2 text-black text-xs font-mono placeholder-neutral-500 focus:outline-none focus:border-black mb-2"
          />
          {error && <p className="text-red-600 text-xs mb-2">{error}</p>}
          <button
            onClick={handleConnect}
            disabled={!uri || connecting}
            className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-black disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            {connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        </div>
      </div>
    );
  }

  // ── Connected: real balance, actions, history ──
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-neutral-500 text-xs uppercase tracking-wider font-semibold">Lightning Wallet</p>
        <div className="flex gap-3">
          <button onClick={refresh} className="text-blue-600 text-xs">Refresh</button>
          <button onClick={disconnect} className="text-red-600 text-xs">Disconnect</button>
        </div>
      </div>

      <div
        className="rounded-2xl bg-neutral-100 p-5 mb-3"
      >
        <p className="text-neutral-500 text-xs">Balance</p>
        {loading && balance === null ? (
          <p className="text-neutral-500 text-lg">Loading…</p>
        ) : loadError ? (
          <p className="text-red-600 text-sm">{loadError}</p>
        ) : (
          <p className="text-black text-3xl font-bold">
            {(balance ?? 0).toLocaleString()} <span className="text-amber-700 text-base">sats</span>
          </p>
        )}
        {balance != null && btcUsd && (
          <p className="text-neutral-500 text-sm mt-0.5">≈ ${(balance * 1e-8 * btcUsd).toFixed(2)}</p>
        )}
        <div className="flex gap-2 mt-4">
          <ActionBtn onClick={() => setPanel(panel === "send" ? null : "send")} active={panel === "send"}>↑ Send</ActionBtn>
          <ActionBtn onClick={() => setPanel(panel === "receive" ? null : "receive")} active={panel === "receive"}>↓ Receive</ActionBtn>
        </div>
      </div>

      {panel === "send" && <SendPanel wallet={wallet} onSent={() => { setPanel(null); refresh(); }} />}
      {panel === "receive" && <ReceivePanel wallet={wallet} onSettled={refresh} />}

      <p className="text-neutral-500 text-xs uppercase tracking-widest mt-4 mb-2">Transactions</p>
      <div className="space-y-2">
        {loading && <p className="text-neutral-500 text-xs">Loading…</p>}
        {!loading && txns.length === 0 && (
          <p className="text-neutral-500 text-xs">No transactions yet.</p>
        )}
        {txns.map((tx) => (
          <div key={tx.id} className="flex items-center justify-between bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
            <div>
              <p className="text-neutral-700 text-sm">{tx.memo}</p>
              <p className="text-neutral-500 text-[11px]">{tx.ts ? new Date(tx.ts).toLocaleString() : ""}</p>
            </div>
            <span className={`text-sm font-medium ${tx.type === "received" ? "text-green-700" : "text-red-600"}`}>
              {tx.type === "received" ? "+" : "−"}{tx.amountSats.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionBtn({ children, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${
        active ? "bg-neutral-200 text-black border-neutral-300" : "bg-neutral-100 text-neutral-700 border-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

// ── Send: pay a real BOLT11 invoice ──
function SendPanel({ wallet, onSent }) {
  const [invoice, setInvoice] = useState("");
  const [status, setStatus] = useState(""); // "", "sending", error text
  const [done, setDone] = useState(false);

  const send = async () => {
    setStatus("sending");
    try {
      await payInvoice(wallet, invoice.trim());
      setDone(true);
      setTimeout(onSent, 1200);
    } catch (e) {
      setStatus(e.message || "Payment failed.");
    }
  };

  if (done) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-1 text-center">
        <p className="text-green-700 text-sm font-medium">✓ Payment sent</p>
      </div>
    );
  }

  return (
    <div className="bg-neutral-100 border border-neutral-200 rounded-xl p-4 mb-1 space-y-2">
      <input aria-label="Lightning invoice to pay"
        value={invoice}
        onChange={(e) => setInvoice(e.target.value)}
        placeholder="Paste a Lightning invoice (lnbc...)"
        spellCheck={false}
        className="w-full bg-neutral-100 border border-neutral-200 rounded-lg px-3 py-2 text-black text-xs font-mono placeholder-neutral-500 focus:outline-none focus:border-black"
      />
      {status && status !== "sending" && <p className="text-red-600 text-xs">{status}</p>}
      <button
        onClick={send}
        disabled={!invoice || status === "sending"}
        className="w-full py-2 rounded-lg text-sm font-semibold text-white bg-black disabled:bg-neutral-200 disabled:text-neutral-400"
      >
        {status === "sending" ? "Paying…" : "Pay Invoice"}
      </button>
      <p className="text-neutral-500 text-[11px]">Tip: in a live build, the camera scans a QR to fill this in.</p>
    </div>
  );
}

// ── Receive: ask the wallet for a real invoice; show string + QR, then
//    watch it (lookup_invoice) and refresh the balance once it's paid ──
function ReceivePanel({ wallet, onSettled }) {
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [invoice, setInvoice] = useState("");
  const [status, setStatus] = useState(""); // "", "creating", error text
  const [paid, setPaid] = useState(false);
  const [canWatch, setCanWatch] = useState(true); // false if the wallet can't look invoices up

  // Check every 3 s for up to 10 min; stop if the wallet can't tell us.
  useEffect(() => {
    if (!invoice || paid) return;
    let stop = false;
    let checking = false;
    const started = Date.now();
    const id = setInterval(async () => {
      if (checking) return;
      if (Date.now() - started > 600000) { clearInterval(id); return; }
      checking = true;
      try {
        if (await isInvoiceSettled(wallet, invoice)) {
          clearInterval(id);
          if (!stop) { setPaid(true); onSettled?.(); }
        }
      } catch {
        clearInterval(id);
        if (!stop) setCanWatch(false);
      }
      checking = false;
    }, 3000);
    return () => { stop = true; clearInterval(id); };
  }, [invoice, paid]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    const sats = parseInt(amount, 10);
    if (!(sats > 0)) { setStatus("Enter an amount above 0 sats."); return; }
    setStatus("creating");
    try {
      const inv = await makeInvoice(wallet, sats, memo);
      setInvoice(inv);
      setStatus("");
    } catch (e) {
      setStatus(e.message || "Couldn't create an invoice.");
    }
  };

  return (
    <div className="bg-neutral-100 border border-neutral-200 rounded-xl p-4 mb-1 space-y-2">
      {!invoice ? (
        <>
          <input aria-label="Amount in sats"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (sats)"
            className="w-full bg-neutral-100 border border-neutral-200 rounded-lg px-3 py-2 text-black text-sm placeholder-neutral-500 focus:outline-none focus:border-black"
          />
          <input aria-label="Memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Memo (optional)"
            className="w-full bg-neutral-100 border border-neutral-200 rounded-lg px-3 py-2 text-black text-sm placeholder-neutral-500 focus:outline-none focus:border-black"
          />
          {status && status !== "creating" && <p className="text-red-600 text-xs">{status}</p>}
          <button
            onClick={create}
            disabled={!amount || status === "creating"}
            className="w-full py-2 rounded-lg text-sm font-semibold text-white bg-black disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            {status === "creating" ? "Creating…" : "Generate Invoice"}
          </button>
        </>
      ) : (
        <div className="text-center">
          <div className="flex justify-center mb-3">
            <QRCode value={invoice} size={170} />
          </div>
          <p className="text-neutral-500 text-[11px] font-mono break-all bg-neutral-100 rounded-lg p-2">{invoice}</p>
          <button onClick={() => navigator.clipboard?.writeText(invoice)} className="text-blue-600 text-xs mt-2">
            Copy invoice
          </button>
          <p className={`text-xs mt-2 ${paid ? "text-green-700" : "text-neutral-500"}`} role="status">
            {paid ? "✓ Received" : canWatch ? "Waiting for payment…" : "Your wallet can't confirm payments here. Tap Refresh to check your balance."}
          </p>
        </div>
      )}
    </div>
  );
}
