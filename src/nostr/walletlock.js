// ════════════════════════════════════════════════════════════
//  WALLET LOCK — One window at a time may hold a person's ecash wallet. The wallet keeps its state in memory and writes the whole
//  state to the browser's storage after every change. Two windows (two tabs, or an installed app next to a browser tab) of the same
//  account would each write their own picture of it, and the later write would erase coins the other window had just received.
//
//  So a window takes a Web Lock (navigator.locks) named after the account before it opens the wallet, and keeps it until the window
//  closes. A second window waits in line: it shows "open in another window" and opens the wallet, from the fresh saved state, when
//  the first window lets go. Without the Web Locks API (an old browser, or a page that is not a secure context) there is no lock
//  and the window opens the wallet at once, as before.
//
//    const hold = holdWalletLock("nostrride-wallet-" + pk16, { onWait })
//    hold.ready     resolves when this window holds the lock (at once if nobody does)
//    hold.release() gives the lock up, or stops waiting for it
// ════════════════════════════════════════════════════════════

export function holdWalletLock(name, { onWait } = {}) {
  const locks = typeof navigator !== "undefined" ? navigator.locks : null;
  if (!locks || typeof locks.request !== "function") return { ready: Promise.resolve(), release() {} };
  const stop = new AbortController();
  let done = null;
  const ready = new Promise((resolve) => {
    const keep = () => new Promise((release) => { done = release; resolve(); });
    locks.request(name, { ifAvailable: true }, (lock) => {
      if (lock) return keep();
      try { onWait?.(); } catch { /* the notice is optional */ }
      return locks.request(name, { signal: stop.signal }, keep).catch(() => {});
    }).catch(() => resolve()); // the browser refuses locks here: open the wallet without one
  });
  return { ready, release() { stop.abort(); if (done) done(); } };
}
