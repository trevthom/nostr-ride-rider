// ════════════════════════════════════════════════════════════
//  LNURL — Pay a Lightning address (name@domain, LUD-16).
//
//  The driver's profile (kind 0) carries a standard `lud16` Lightning
//  address. To pay it we ask the address's server for an invoice
//  (LNURL-pay, LUD-06), CHECK that the invoice is for the exact amount
//  (a bad server could ask for more), and pay it from any wallet.
//  If the server supports LUD-21 it also gives a `verify` URL, which
//  lets the app see when the invoice is paid.
// ════════════════════════════════════════════════════════════

const ADDRESS_RE = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function isLightningAddress(s) {
  return typeof s === "string" && ADDRESS_RE.test(s.trim());
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Lightning address server error (${res.status}).`);
  const data = await res.json();
  if (data?.status === "ERROR") throw new Error(data.reason || "Lightning address server error.");
  return data;
}

// Look up the address's pay parameters. Throws if it isn't a working
// Lightning address.
export async function resolveAddress(address) {
  if (!isLightningAddress(address)) throw new Error("That isn't a Lightning address (name@domain).");
  const [name, domain] = address.trim().toLowerCase().split("@");
  const params = await getJson(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`);
  if (params?.tag !== "payRequest" || !params.callback) throw new Error("That Lightning address can't receive payments.");
  const cb = new URL(params.callback);
  if (cb.protocol !== "https:") throw new Error("That Lightning address uses an insecure server.");
  return params;
}

// The amount a BOLT11 invoice asks for, in millisats (null if it has none).
export function invoiceAmountMsat(pr) {
  const inv = String(pr || "").trim().toLowerCase().replace(/^lightning:/, "");
  const sep = inv.lastIndexOf("1");
  const m = /^ln(?:bcrt|bc|tbs|tb|sb)(\d+)([munp]?)$/.exec(inv.slice(0, sep));
  if (!m) return null;
  const n = BigInt(m[1]);
  const msat = { "": n * 100000000000n, m: n * 100000000n, u: n * 100000n, n: n * 100n, p: n / 10n }[m[2]];
  return Number(msat);
}

// Get an invoice for `amountSats` from a Lightning address.
// Returns { pr, verify } — `verify` is a LUD-21 URL or null.
export async function requestInvoice(address, amountSats, comment = "") {
  const params = await resolveAddress(address);
  const msat = Math.round(amountSats) * 1000;
  if (msat < params.minSendable || msat > params.maxSendable) {
    throw new Error(
      `The driver's wallet takes ${Math.ceil(params.minSendable / 1000)}–${Math.floor(params.maxSendable / 1000)} sats per payment.`
    );
  }
  const url = new URL(params.callback);
  url.searchParams.set("amount", String(msat));
  if (comment && params.commentAllowed > 0) url.searchParams.set("comment", comment.slice(0, params.commentAllowed));
  const data = await getJson(url.toString());
  if (!data?.pr) throw new Error("The driver's wallet didn't return an invoice.");
  if (invoiceAmountMsat(data.pr) !== msat) throw new Error("The driver's wallet returned an invoice for the wrong amount.");
  return { pr: data.pr, verify: typeof data.verify === "string" ? data.verify : null };
}

// LUD-21: the invoice's status. { settled, preimage } — the preimage (hex) is
// present once the invoice is paid, and is proof of payment.
export async function invoiceStatus(verifyUrl) {
  const data = await getJson(verifyUrl);
  const preimage = typeof data?.preimage === "string" && /^[0-9a-f]{64}$/i.test(data.preimage) ? data.preimage.toLowerCase() : null;
  return { settled: data?.settled === true, preimage };
}

// LUD-21: has the invoice been paid? Returns true / false.
export async function isInvoicePaid(verifyUrl) {
  return (await invoiceStatus(verifyUrl)).settled;
}
