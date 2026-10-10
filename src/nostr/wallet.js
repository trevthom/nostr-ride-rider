// ════════════════════════════════════════════════════════════
//  WALLET — REAL Nostr Wallet Connect (NIP-47) client.
//
//  Nothing here is faked. We connect to the relay in the user's NWC
//  string and exchange encrypted requests with their wallet to read
//  the REAL balance + transactions and to send/receive sats.
//
//  Flow per request:
//    1. encrypt {method, params} to the wallet pubkey (NIP-04)
//    2. publish a kind-23194 request signed with the NWC secret
//    3. wait for the wallet's kind-23195 response, decrypt, parse
//
//  If the wallet can't be reached, calls reject with an error — the
//  UI shows that error instead of inventing numbers.
// ════════════════════════════════════════════════════════════

import { Relay } from "nostr-tools/relay";
import { finalizeEvent, getPublicKey, nip04 } from "nostr-tools";

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

// Parse "nostr+walletconnect://<walletPubkey>?relay=..&secret=..".
// Returns the connection or null if it isn't a valid NWC string.
export function parseNwcUri(uri) {
  try {
    const trimmed = uri.trim();
    if (!trimmed.startsWith("nostr+walletconnect://")) return null;
    const url = new URL(trimmed.replace("nostr+walletconnect://", "http://"));
    const walletPubkey = url.hostname;
    const relayUrl = url.searchParams.get("relay") || "";
    const secretHex = url.searchParams.get("secret") || "";
    if (walletPubkey.length !== 64 || !relayUrl || secretHex.length !== 64) return null;
    return { connected: true, walletPubkey, relayUrl, secretHex, uri: trimmed };
  } catch {
    return null;
  }
}

export function emptyWalletState() {
  return { connected: false, walletPubkey: "", relayUrl: "", secretHex: "", uri: "" };
}

// Send one NIP-47 request and resolve with its `result` (or reject).
async function nip47Request(conn, method, params = {}, timeoutMs = 15000) {
  const sk = hexToBytes(conn.secretHex);
  const content = await nip04.encrypt(sk, conn.walletPubkey, JSON.stringify({ method, params }));
  const request = finalizeEvent(
    { kind: 23194, created_at: Math.floor(Date.now() / 1000), tags: [["p", conn.walletPubkey]], content },
    sk
  );

  const relay = await Relay.connect(conn.relayUrl);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sub.close(); } catch { /* ignore */ }
      try { relay.close(); } catch { /* ignore */ }
      fn(arg);
    };

    const timer = setTimeout(
      () => finish(reject, new Error("Wallet didn't respond (timed out). Check the relay/connection.")),
      timeoutMs
    );

    const sub = relay.subscribe(
      [{ kinds: [23195], authors: [conn.walletPubkey], "#e": [request.id] }],
      {
        async onevent(ev) {
          try {
            const decrypted = await nip04.decrypt(sk, conn.walletPubkey, ev.content);
            const parsed = JSON.parse(decrypted);
            if (parsed.error) finish(reject, new Error(parsed.error.message || parsed.error.code || "Wallet error"));
            else finish(resolve, parsed.result);
          } catch (e) {
            finish(reject, e);
          }
        },
      }
    );

    relay.publish(request).catch((e) => finish(reject, e));
  });
}

// Real balance in sats (wallet returns millisats).
export async function getBalance(conn) {
  const result = await nip47Request(conn, "get_balance");
  return Math.floor((result?.balance || 0) / 1000);
}

// Real transaction history. Returns [] if the wallet doesn't support it.
export async function listTransactions(conn) {
  let result;
  try {
    result = await nip47Request(conn, "list_transactions", { limit: 20 });
  } catch {
    return []; // some wallets don't implement list_transactions
  }
  const txns = result?.transactions || [];
  return txns.map((t) => ({
    id: t.payment_hash || `${t.created_at}-${t.amount}`,
    type: t.type === "incoming" ? "received" : "sent",
    amountSats: Math.floor((t.amount || 0) / 1000),
    memo: t.description || (t.type === "incoming" ? "Received" : "Sent"),
    ts: (t.settled_at || t.created_at || 0) * 1000,
  }));
}

// Pay a BOLT11 invoice with the connected wallet. Payments can take a
// while to route, so wait longer than for a balance check.
export async function payInvoice(conn, invoice) {
  return nip47Request(conn, "pay_invoice", { invoice }, 60000);
}

// Has an invoice WE created been paid? (NIP-47 lookup_invoice.) Throws if
// the wallet doesn't support the method.
export async function isInvoiceSettled(conn, invoice) {
  const r = await nip47Request(conn, "lookup_invoice", { invoice });
  return !!(r?.settled_at || r?.state === "settled");
}

// Ask the wallet to create an invoice; returns the BOLT11 string.
export async function makeInvoice(conn, amountSats, description) {
  const result = await nip47Request(conn, "make_invoice", {
    amount: amountSats * 1000,
    description: description || "",
  });
  return result?.invoice || "";
}
