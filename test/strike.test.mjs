// Strike (lib/strike.js, lib/strikekey.js) against a stand-in Strike server (test/helpers/localstrike.mjs), the REAL Cashu client and
// the local test mint:
//   • amounts: sats ↔ BTC strings, how an amount reads, how Strike words a payment's state
//   • the client: a bad key, a key without a permission, expired quotes, no money, an unreachable Strike
//   • RIDER: Strike pays the mint's funding invoice, from the Bitcoin balance and from dollars; the ecash arrives
//   • DRIVER: a cash out is paid into Strike as Bitcoin (exact sats) or as US dollars (cents); a wrong invoice is refused
//   • the key is saved only encrypted
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const S = await import(`${R}/lib/strike.js`);
const K = await import(`${R}/lib/strikekey.js`);
const Keys = await import(`${R}/nostr/keys.js`);
const { cashuMint, tokenInfo } = await import(`${R}/nostr/cashuMint.js`);
const { EcashWallet } = await import(`${R}/nostr/ecash.js`);
const { startLocalMint } = await import("./helpers/localmint.mjs");
const { startLocalStrike } = await import("./helpers/localstrike.mjs");
const { memStore } = await import("./helpers/fakemint.mjs");

// ── Amounts ──
assert.equal(S.satsToBtc(1), "0.00000001");
assert.equal(S.satsToBtc(1000), "0.00001000");
assert.equal(S.satsToBtc(123456789), "1.23456789");
assert.equal(S.satsToBtc(0), "0.00000000");
assert.throws(() => S.satsToBtc(-5), (e) => e.code === "amount");
assert.equal(S.btcToSats("0.00001000"), 1000);
assert.equal(S.btcToSats("1.5"), 150000000);
assert.equal(S.btcToSats("2"), 200000000);
assert.equal(S.btcToSats("0.123456789"), 12345678, "more than 8 decimals are cut, not rounded up");
assert.equal(S.btcToSats("abc"), null);
assert.equal(S.btcToSats("-1"), null);
for (const n of [1, 99, 1000, 4_999_999, 2_100_000_000_000_000]) assert.equal(S.btcToSats(S.satsToBtc(n)), n, "round trip " + n);
assert.equal(S.strikeAmountText({ currency: "BTC", amount: "0.00001000" }, "en-US"), "1,000 sats");
assert.equal(S.strikeAmountText({ currency: "BTC", amount: "0.00000001" }, "en-US"), "1 sat", "one sat, not 1 sats");
assert.equal(S.strikeAmountText({ currency: "USD", amount: "12.34" }, "en-US"), "$12.34");
assert.equal(S.balanceText("BTC", 0.0005, "en-US"), "50,000 sats");
assert.equal(S.balanceText("USD", 12.5, "en-US"), "$12.50");
assert.equal(S.paymentState({ state: "COMPLETED" }), "done");
assert.equal(S.paymentState({ state: "PENDING" }), "pending");
assert.equal(S.paymentState({ state: "FAILED" }), "failed");
assert.equal(S.paymentState({ state: "COMPLETED", result: "FAILED" }), "failed", "a failed result wins");
assert.equal(S.paymentState(null), "pending");

// ── The client ──
const strike = await startLocalStrike();
const mint = await startLocalMint();
const mintFor = (() => { const m = new Map(); return (url) => { if (!m.has(url)) m.set(url, cashuMint(url)); return m.get(url); }; })();
const wallet = () => new EcashWallet({ store: memStore(), mintFor, tokenInfo });
const client = (over = {}) => S.makeStrike({ apiKey: strike.apiKey, baseUrl: strike.url, sleep: async () => {}, ...over });
// When Strike pays a mint's funding invoice, the mint sees it as paid.
strike.onPay = (invoice) => { for (const q of mint.quotes.values()) if (q.request === invoice) mint.payQuote(q.quote); };
try {
  const c = client();
  assert.deepEqual(await c.balances(), { BTC: 0.01, USD: 500 });
  assert.deepEqual((await c.check()).balances, { BTC: 0.01, USD: 500 });
  await assert.rejects(() => client({ apiKey: "wrong-key-wrong-key-1" }).check(), (e) => e instanceof S.StrikeError && e.code === "key" && e.status === 401, "a bad key is refused");
  const noBalances = await startLocalStrike({ apiKey: strike.apiKey, scopes: [S.SCOPES.quote] });
  const limited = S.makeStrike({ apiKey: strike.apiKey, baseUrl: noBalances.url });
  assert.deepEqual(await limited.check(), { balances: null }, "a key that may not read balances still works");
  await assert.rejects(() => limited.execute("x"), (e) => e.code === "scope" && /partner\.payment-quote\.execute/.test(e.message), "the message names the missing permission");
  await noBalances.close();
  const gone = await startLocalStrike();
  const goneUrl = gone.url;
  await gone.close();
  await assert.rejects(() => S.makeStrike({ apiKey: "k", baseUrl: goneUrl }).balances(), (e) => e.code === "network" && /VITE_STRIKE_API_URL/.test(e.message), "an unreachable Strike is named, not blamed on the key");

  // ── RIDER: Strike pays the mint's funding invoice ──
  const rider = wallet();
  {
    const q = await rider.fundStart(mint.url, 2000);
    const quote = await c.payQuote(q.invoice, "BTC");
    assert.equal(quote.source, "BTC");
    assert.deepEqual(quote.total, { currency: "BTC", amount: S.satsToBtc(2001) }, "2,000 sats and a 1 sat network fee");
    assert.deepEqual(quote.fee, { currency: "BTC", amount: "0.00000001" });
    assert.ok(quote.validUntil > Date.now());
    assert.deepEqual(await rider.claim(q.id), { state: "UNPAID", sats: 0 }, "nothing is paid by a quote");
    assert.equal(strike.stats.payments.length, 0);
    const sent = await c.execute(quote.id);
    assert.equal(sent.state, "pending");
    assert.equal(await c.waitForPayment(sent.id), "done");
    assert.deepEqual(await rider.claim(q.id), { state: "ISSUED", sats: 2000 });
    assert.equal(rider.balance(mint.url), 2000, "the ecash arrived");
    assert.ok(Math.abs(strike.balances.BTC - (0.01 - 2001e-8)) < 1e-12, "the Bitcoin balance paid");
    await assert.rejects(() => c.execute(quote.id), (e) => e.code === "api" && /already/.test(e.message), "a quote is used once");
  }
  {
    // From dollars: Strike buys the bitcoin. 5,000 sats at $100,000 is $5.00, plus the fee and spread.
    const q = await rider.fundStart(mint.url, 5000);
    const quote = await c.payQuote(q.invoice, "USD");
    assert.equal(quote.total.currency, "USD");
    assert.equal(quote.total.amount, "5.03", "5,001 sats at $100,000 with a 0.5% spread, rounded up to the cent");
    assert.equal(S.strikeAmountText(quote.total, "en-US"), "$5.03");
    const sent = await c.execute(quote.id);
    assert.equal(await c.waitForPayment(sent.id), "done");
    assert.deepEqual(await rider.claim(q.id), { state: "ISSUED", sats: 5000 });
    assert.equal(rider.balance(mint.url), 7000);
    assert.ok(Math.abs(strike.balances.USD - 494.97) < 1e-9, "the dollar balance paid: " + strike.balances.USD);
    assert.equal(new Set(strike.stats.keys).size, strike.stats.keys.length, "every quote has its own idempotency key");
  }
  {
    // An expired quote, no money, and a payment that fails.
    const slow = await startLocalStrike({ quoteTtlMs: 1, balances: { BTC: 0, USD: 1 } });
    const sc = S.makeStrike({ apiKey: slow.apiKey, baseUrl: slow.url, sleep: async () => {} });
    const q = await rider.fundStart(mint.url, 1000);
    const quote = await sc.payQuote(q.invoice, "BTC");
    await new Promise((r) => setTimeout(r, 15));
    await assert.rejects(() => sc.execute(quote.id), (e) => e.code === "api" && /expired/.test(e.message), "Strike's own words come through");
    const q2 = await sc.payQuote(q.invoice, "BTC");
    slow.stats.quotes.length = 0;
    const slow2 = await startLocalStrike({ balances: { BTC: 0, USD: 1 } });
    const nc = S.makeStrike({ apiKey: slow2.apiKey, baseUrl: slow2.url, sleep: async () => {} });
    const poor = await nc.payQuote(q.invoice, "BTC");
    await assert.rejects(() => nc.execute(poor.id), (e) => /Not enough funds/.test(e.message));
    assert.ok(q2.id);
    const bad = await startLocalStrike({ failPayments: true });
    const bc = S.makeStrike({ apiKey: bad.apiKey, baseUrl: bad.url, sleep: async () => {} });
    const bq = await bc.payQuote(q.invoice, "BTC");
    const bs = await bc.execute(bq.id);
    assert.equal(await bc.waitForPayment(bs.id), "failed");
    assert.equal(await bc.waitForPayment(null), "unknown");
    await Promise.all([slow.close(), slow2.close(), bad.close()]);
  }

  // ── DRIVER: a cash out into Strike ──
  const driver = wallet();
  const fundDriver = async (sats) => { const q = await driver.fundStart(mint.url, sats); mint.payQuote(q.id); await driver.claim(q.id); };
  await fundDriver(5000);
  {
    // As Bitcoin: Strike gets exactly the sats the mint pays.
    const made = [];
    const r = await driver.cashOut(mint.url, async (sats) => { const inv = await c.receiveInvoice({ sats, currency: "BTC" }); made.push(inv); return inv.bolt11; });
    const inv = made.find((i) => i.sats === r.paidSats);
    assert.ok(inv, "the invoice that was paid is one Strike made");
    assert.deepEqual(inv.receive, { currency: "BTC", amount: S.satsToBtc(r.paidSats) }, "Strike credits exactly the sats that were paid");
    assert.equal(mint.stats.melted.at(-1), r.paidSats);
    // The test mint holds back 1% as a Lightning fee reserve and returns what the payment did not use, so about 50 sats come back.
    assert.ok(driver.balance(mint.url) >= 0 && driver.balance(mint.url) < 100, "only the fee reserve is left over: " + driver.balance(mint.url));
  }
  await fundDriver(5000);
  {
    // As US dollars: the invoice is in dollars (whole cents); the sats follow Strike's rate (here $100,000).
    const made = [];
    const r = await driver.cashOut(mint.url, async (sats) => { const inv = await c.receiveInvoice({ sats, currency: "USD", usdPerBtc: 100000 }); made.push(inv); return inv.bolt11; });
    const inv = made.find((i) => i.sats === r.paidSats);
    assert.ok(inv);
    assert.equal(inv.receive.currency, "USD");
    assert.match(inv.receive.amount, /^\d+\.\d\d$/);
    const dollars = Number(inv.receive.amount);
    assert.ok(Math.abs((dollars / 100000) * 1e8 - r.paidSats) <= 1, `$${dollars} is worth the ${r.paidSats} sats paid`);
    assert.equal(S.strikeAmountText(inv.receive, "en-US"), "$" + inv.receive.amount);
    assert.ok(driver.balance(mint.url) < 130, "the fee reserve and under a cent's worth of sats are left over: " + driver.balance(mint.url));
  }
  {
    // Refusals: Strike's invoice is for the wrong amount; no price; too little; a currency the account cannot invoice.
    const crooked = await startLocalStrike({ skew: 1.2 });
    const cc = S.makeStrike({ apiKey: crooked.apiKey, baseUrl: crooked.url });
    await assert.rejects(() => cc.receiveInvoice({ sats: 1000, currency: "BTC" }), (e) => e.code === "amount" && /Nothing was sent/.test(e.message), "bitcoin must match to the sat");
    await assert.rejects(() => cc.receiveInvoice({ sats: 1000, currency: "USD", usdPerBtc: 100000 }), (e) => e.code === "amount", "dollars must be within 5%");
    crooked.skew = 1.04;
    assert.equal((await cc.receiveInvoice({ sats: 1000, currency: "USD", usdPerBtc: 100000 })).sats, 1040, "a small rate difference is normal");
    const before = driver.balance(mint.url);
    await fundDriver(3000);
    await assert.rejects(() => driver.cashOut(mint.url, async (sats) => (await cc.receiveInvoice({ sats, currency: "BTC" })).bolt11), (e) => e.code === "amount");
    assert.equal(driver.balance(mint.url), before + 3000, "a refused invoice costs nothing: the ecash is still here");
    await crooked.close();
    await assert.rejects(() => c.receiveInvoice({ sats: 1000, currency: "USD" }), (e) => e.code === "amount" && /price/.test(e.message), "a missing price is never guessed");
    await assert.rejects(() => c.receiveInvoice({ sats: 5, currency: "USD", usdPerBtc: 100000 }), (e) => e.code === "amount" && /too little/.test(e.message));
    await assert.rejects(() => c.receiveInvoice({ sats: 1000, currency: "EUR" }), (e) => e.code === "amount");
    const btcOnly = await startLocalStrike({ invoiceable: ["BTC"] });
    await assert.rejects(() => S.makeStrike({ apiKey: btcOnly.apiKey, baseUrl: btcOnly.url }).receiveInvoice({ sats: 1000, currency: "USD", usdPerBtc: 100000 }), (e) => /cannot create invoices in USD/.test(e.message), "the account's own answer is shown");
    await btcOnly.close();
  }
} finally {
  await strike.close();
  await mint.close();
}

// ── The key is kept only encrypted ──
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const me = Keys.generateKeypair(), other = Keys.generateKeypair();
  const key = "STRK-live-0123456789abcdef-0123456789";
  assert.equal(K.cleanStrikeKey("  Bearer  " + key + "\n"), key, "a pasted Bearer prefix and spaces are dropped");
  assert.equal(K.looksLikeKey(key), true);
  assert.equal(K.looksLikeKey("short"), false);
  assert.equal(K.loadStrikeKey(me), null);
  K.saveStrikeKey(me, key);
  assert.equal(K.loadStrikeKey(me), key);
  assert.ok(![...store.values()].some((v) => v.includes(key)), "the key is not stored in the clear");
  // Someone else's key cannot open it, even if they copy the blob into their own slot.
  const [name, blob] = [...store.entries()].find(([k]) => k.startsWith("nostrride_strike_"));
  store.set("nostrride_strike_" + other.publicKey.slice(0, 16), blob);
  assert.equal(K.loadStrikeKey(other), null);
  K.eraseStrikeKey(me);
  assert.equal(K.loadStrikeKey(me), null, "Disconnect erases it");
  // The two choices.
  assert.equal(K.getStrikeSource(), "BTC");
  K.setStrikeSource("USD");
  assert.equal(K.getStrikeSource(), "USD");
  K.setStrikeSource("EUR");
  assert.equal(K.getStrikeSource(), "USD", "only Bitcoin or US dollars");
  K.setStrikeReceive("USD");
  assert.equal(K.getStrikeReceive(), "USD");
  assert.ok(name);
  delete globalThis.localStorage;
}
console.log("strike: ok");
