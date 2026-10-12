// ════════════════════════════════════════════════════════════
//  REACHABLE — Can this relay be reached right now? A throwaway WebSocket opens to the
//  relay and closes at once. It never touches the app's own relay connections, so a slow or
//  failed test cannot break a working (or still connecting) one.
//
//    probeRelay(url, timeoutMs) → Promise<boolean>   true when the socket opened in time
//
//  Without a WebSocket in this environment nothing can be tested, so the answer is true
//  (the app must not claim an outage it cannot see).
// ════════════════════════════════════════════════════════════

export function probeRelay(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (typeof WebSocket === "undefined") return resolve(true);
    let ws = null;
    let done = false;
    let timer = null;
    const end = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (ws) { ws.onopen = ws.onerror = ws.onclose = null; ws.close(); } } catch { /* already closed */ }
      resolve(ok);
    };
    timer = setTimeout(() => end(false), timeoutMs);
    try { ws = new WebSocket(url); } catch { return end(false); }
    ws.onopen = () => end(true);
    ws.onerror = () => end(false);
    ws.onclose = () => end(false);
  });
}
