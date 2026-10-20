// Funding the ecash wallet with an on-chain payment (NUT-30), with the REAL Cashu client and a local mint that checks the NUT-20 signature:
//   • a mint that does not list on-chain minting is refused BEFORE anyone sends bitcoin to it
//   • the mint gives an address; the same address is used again; nothing is minted until the payment is confirmed
//   • a confirmed payment becomes ecash once; a second payment to the same address becomes more
//   • the address is also kept as a plain setting (the backup carries it), and a wallet that lost its state still claims it
//   • the 12 words are enough: a NEW device that types the phrase claims a deposit that was never turned into ecash
//   • a wallet that does not hold the key cannot claim someone else's deposit (and claimAll does not stop at it)
// Run with: npm test
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
const R = new URL("../src", import.meta.url).pathname;
const { cashuMint, tokenInfo } = await import(`${R}/nostr/cashuMint.js`);
const { EcashWallet, EcashError, makeStore } = await import(`${R}/nostr/ecash.js`);
const { makeRecovery } = await import(`${R}/nostr/ecashRecovery.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const B = await import(`${R}/lib/backup.js`);
const { startLocalMint } = await import("./helpers/localmint.mjs");

const memBox = () => { let saved = null; return { load: () => saved && { ...saved }, save: (r) => { saved = { ...r }; }, erase: () => { saved = null; } }; };
// One device with its own phrase. A store that is ALSO the real makeStore (so the plain setting that the backup carries is written).
function device(user, phrase = null) {
  const box = memBox();
  if (phrase) box.save({ v: 1, phrase, backedUp: true, at: 1 }); // a device that was given the person's 12 words (Restore)
  const recovery = makeRecovery({ box, newAdapter: cashuMint });
  const wallet = new EcashWallet({ store: makeStore(user), mintFor: recovery.mintFor, tokenInfo });
  recovery.attach(wallet);
  return { wallet, recovery };
}
const note = (t) => console.log("  " + t);
const withChain = await startLocalMint({ onchain: true });
const plainMint = await startLocalMint({});
try {
  const me = generateKeypair();
  const A = device(me);

  note("a mint without on-chain minting is refused before any bitcoin is sent");
  await assert.rejects(() => A.wallet.onchainStart(plainMint.url), (e) => e instanceof EcashError && e.code === "onchain" && e.definitive === true);
  assert.deepEqual(A.wallet.onchainList(), [], "nothing was recorded");

  note("the mint gives an address, and the same one is used again");
  const q1 = await A.wallet.onchainStart(withChain.url);
  assert.match(q1.address, /^bcrt1q/);
  assert.equal(q1.mint, withChain.url);
  const q1b = await A.wallet.onchainStart(withChain.url);
  assert.equal(q1b.id, q1.id, "one address per mint until it expires");
  assert.equal(withChain.onchainQuotes.size, 1);

  note("nothing is minted until a payment is confirmed");
  assert.deepEqual(await A.wallet.claimOnchain(q1.id), { state: "UNPAID", sats: 0, paid: 0 });
  assert.equal(A.wallet.balance(withChain.url), 0);

  note("a confirmed payment becomes ecash once; a second payment becomes more");
  withChain.depositOnchain(q1.address, 5000);
  assert.deepEqual(await A.wallet.claimOnchain(q1.id), { state: "ISSUED", sats: 5000, paid: 5000 });
  assert.equal(A.wallet.balance(withChain.url), 5000);
  assert.deepEqual(await A.wallet.claimOnchain(q1.id), { state: "ISSUED", sats: 0, paid: 5000 }, "once");
  assert.equal(A.wallet.balance(withChain.url), 5000);
  withChain.depositOnchain(q1.id, 3000);
  assert.equal(await A.wallet.claimAll(), 3000, "claimAll collects what was paid while the app was closed");
  assert.equal(A.wallet.balance(withChain.url), 8000);
  assert.deepEqual(await A.wallet.claimOnchain("nope"), { state: "NONE", sats: 0, paid: 0 });

  note("the address is kept as a plain setting that the backup carries (no key, no coin in it)");
  const mirror = [...mem.entries()].find(([k]) => k.startsWith("nostrride_onchain_"));
  assert.ok(mirror, "the deposit address is saved apart from the wallet");
  assert.ok(B.allowedKey(mirror[0].slice("nostrride_".length)), "and the backup may carry it");
  const flat = mirror[1];
  assert.ok(flat.includes(q1.address) && !/secret|"C"|privkey|seed|proofs/i.test(flat), "ids and numbers only");
  assert.equal(JSON.parse(flat)[0].index, q1.index);

  note("a wallet that lost its saved state still finds the address (same phrase) and claims");
  withChain.depositOnchain(q1.id, 2000);
  A.wallet.state.onchain = []; // the encrypted wallet file is gone, the plain setting is not
  assert.equal(A.wallet.onchainList().length, 1);
  assert.equal((await A.wallet.claimOnchain(q1.id)).sats, 2000);

  note("a new device with only the 12 words claims a deposit that was never turned into ecash");
  const q2 = await A.wallet.onchainStart(withChain.url); // same address
  withChain.depositOnchain(q2.id, 7000); // paid, but this device is lost before it claims
  const phraseA = A.recovery.phrase();
  const NEW = device(generateKeypair(), phraseA); // another phone that was given the 12 words (Restore my wallet)
  assert.equal(NEW.wallet.total(), 0);
  // The backup note was restored on the new phone: the plain setting with the address is there.
  NEW.wallet.store.saveOnchain(A.wallet.onchainList());
  const rows = await NEW.wallet.restore([withChain.url]);
  assert.equal(rows[0].error, "");
  await NEW.wallet.claimAll(); // the deposit that was paid while the old phone was gone
  assert.equal(NEW.wallet.balance(withChain.url), 7000 + (A.wallet.balance(withChain.url)), "the unspent coins AND the unclaimed deposit are now in the new wallet");
  assert.equal((await withChain.onchainQuotes.get(q2.id).amount_issued) - 0 >= 7000, true, "the mint counts the deposit as issued");

  note("a wallet without the key cannot claim someone else's deposit, and claimAll does not stop at it");
  const other = device(generateKeypair());
  other.wallet.store.saveOnchain(A.wallet.onchainList()); // an address it does not hold the key for
  const own = await other.wallet.onchainStart(withChain.url); // it makes its OWN address: another phrase's address is never handed out
  assert.notEqual(own.id, q2.id);
  withChain.depositOnchain(q2.id, 1000);
  await assert.rejects(() => other.wallet.claimOnchain(q2.id), (e) => e.code === "onchain", "another phrase's address is not claimed here");
  withChain.depositOnchain(own.id, 400);
  assert.equal(await other.wallet.claimAll(), 400, "its own deposit is still collected");
  assert.equal(other.wallet.balance(withChain.url), 400);
  console.log("onchain ok");
} finally {
  await withChain.close(); await plainMint.close();
}
process.exit(0);
