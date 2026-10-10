// ════════════════════════════════════════════════════════════
//  CONNECTION BANNER — A thin strip at the top when something is wrong
//  with the connection, so the app never looks fine while it is not:
//    • the device is offline
//    • no relay is reachable (after a short grace period)
//    • updates are waiting in the outbox to be sent
//  It hides itself when all is well.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { relay } from "../nostr/relay.js";
import { getRelays } from "../config/relays.js";

const GRACE_MS = 8000; // relays need a moment to connect after the page opens

export function useConnection() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [, setTick] = useState(0);
  const [outbox, setOutbox] = useState(relay.outboxSize());
  const [since] = useState(Date.now());
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const id = setInterval(() => setTick((t) => t + 1), 4000); // relay states change without events
    const unsub = relay.onOutbox(setOutbox);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(id); unsub(); };
  }, []);
  const urls = getRelays();
  const connected = urls.filter((u) => relay.relayState(u) === "connected").length;
  return { online, connected, total: urls.length, outbox, settled: Date.now() - since > GRACE_MS };
}

export default function ConnectionBanner() {
  const { online, connected, total, outbox, settled } = useConnection();
  let text = "";
  if (!online) text = "You're offline. We'll send your updates when you're back online.";
  else if (settled && total > 0 && connected === 0) text = "Can't reach any relay. Check your connection or your relays in Account.";
  else if (outbox > 0) text = `${outbox} update${outbox === 1 ? " is" : "s are"} waiting to send.`;
  if (!text) return null;
  return (
    <div role="status" aria-live="polite" className="fixed top-0 inset-x-0 z-[10045] mx-auto max-w-md bg-amber-500 text-black text-[13px] font-semibold text-center px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]">
      {text}
    </div>
  );
}
