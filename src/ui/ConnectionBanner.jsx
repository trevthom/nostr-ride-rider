// ════════════════════════════════════════════════════════════
//  CONNECTION BANNER — A thin strip at the top when something is wrong
//  with the connection, so the app never looks fine while it is not:
//    • the device is offline
//    • no relay is reachable: shown only after EVERY relay has been disconnected for 20 s
//      and a separate test connection to each one has also failed. A relay that is merely
//      slow to connect, or reconnecting after a sleep, never raises the alarm (it used to,
//      and a reload then showed that the relays were fine)
//    • updates are waiting in the outbox: shown only when one has waited 20 s or more (a send that fails
//      once and succeeds on the first retry, a few seconds later, is not worth a warning)
//  It hides itself when all is well. useOutboxAge(id) tells a screen how long ONE event has been waiting.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { relay } from "../nostr/relay.js";
import { getRelays } from "../config/relays.js";

export const OUTBOX_WARN_MS = 20000; // how long an update must have been waiting before the banner says so
export const DOWN_AFTER_MS = 20000; // how long ALL relays must be disconnected before we say so

export function useConnection() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [, setTick] = useState(0);
  const [outbox, setOutbox] = useState(relay.outboxSize());
  const lostSince = useRef(null); // when we last saw zero connected relays, or null while at least one is connected
  const started = useRef(Date.now());
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const id = setInterval(() => setTick((t) => t + 1), 4000); // relay states change without events
    const unsub = relay.onOutbox(setOutbox);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(id); unsub(); };
  }, []);
  const urls = getRelays();
  const states = urls.map((u) => relay.relayState(u));
  const connected = states.filter((s) => s === "connected").length;
  const now = Date.now();
  if (connected > 0) lostSince.current = null;
  else if (lostSince.current == null) lostSince.current = Math.max(now, started.current);
  // Down = nothing connected for a while AND every test connection failed too.
  const down = urls.length > 0 && connected === 0 && now - lostSince.current >= DOWN_AFTER_MS && states.every((s) => s === "failed");
  return { online, connected, total: urls.length, outbox, down, outboxAge: relay.oldestOutboxAge() };
}

// How long (ms) the event with this id has been waiting in the outbox; 0 when it is not waiting.
export function useOutboxAge(id) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const unsub = relay.onOutbox(bump);
    const timer = setInterval(bump, 3000);
    return () => { unsub(); clearInterval(timer); };
  }, []);
  return id ? relay.outboxAge(id) : 0;
}

export default function ConnectionBanner() {
  const { online, outbox, down, outboxAge } = useConnection();
  let text = "";
  if (!online) text = "You're offline. We'll send your updates when you're back online.";
  else if (down) text = "Can't reach any relay. Check your connection or your relays in Account.";
  else if (outbox > 0 && outboxAge >= OUTBOX_WARN_MS) text = `${outbox} update${outbox === 1 ? " is" : "s are"} waiting to send.`;
  if (!text) return null;
  return (
    <div role="status" aria-live="polite" className="fixed top-0 inset-x-0 z-[10045] mx-auto max-w-md bg-amber-500 text-black text-[13px] font-semibold text-center px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]">
      {text}
    </div>
  );
}
