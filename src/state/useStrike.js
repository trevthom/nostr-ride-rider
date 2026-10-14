// ════════════════════════════════════════════════════════════
//  USE STRIKE — The optional Strike connection, as app state (AppContext exposes it as `strike`).
//    strike.connected         a key is saved for this user
//    strike.client            makeStrike(...) for the key, or null (components call its methods; none gives the key back)
//    strike.balances          { BTC, USD } as last read, or null (unknown / the key may not read balances)
//    strike.source / .receive "BTC" | "USD": the rider's paying balance / the driver's receiving currency
//    strike.direct            rides are paid straight from / into Strike with no ecash mint (when both people allow it)
//    strike.connect(key) → throws StrikeError if Strike refuses the key;  strike.disconnect();  strike.refresh()
//  The key is restored from its encrypted copy when the user logs in (lib/strikekey.js) and dropped from memory at logout.
// ════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeStrike, StrikeError } from "../lib/strike.js";
import {
  cleanStrikeKey, looksLikeKey, saveStrikeKey, loadStrikeKey, eraseStrikeKey,
  getStrikeSource, setStrikeSource, getStrikeReceive, setStrikeReceive, getStrikeDirect, setStrikeDirect,
} from "../lib/strikekey.js";

export default function useStrike(user) {
  const [state, setState] = useState({ connected: false, balances: null });
  const [source, setSource] = useState(getStrikeSource);
  const [receive, setReceive] = useState(getStrikeReceive);
  const [direct, setDirect] = useState(getStrikeDirect);
  const client = useRef(null);
  const pk = user?.publicKey;

  // On login: open the saved key. On logout (or another user): forget it.
  useEffect(() => {
    client.current = null;
    setState({ connected: false, balances: null });
    if (!user?.sk) return undefined;
    const key = loadStrikeKey(user);
    if (!key) return undefined;
    const c = makeStrike({ apiKey: key });
    client.current = c;
    setState({ connected: true, balances: null });
    let alive = true;
    c.balances().then((b) => { if (alive && client.current === c) setState({ connected: true, balances: b }); }).catch(() => {});
    return () => { alive = false; };
  }, [pk]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(async (raw) => {
    const key = cleanStrikeKey(raw);
    if (!looksLikeKey(key)) throw new StrikeError("key", "That does not look like a Strike API key. Paste the whole key.");
    const c = makeStrike({ apiKey: key });
    const { balances } = await c.check(); // throws if Strike does not accept the key
    saveStrikeKey(user, key);
    client.current = c;
    // A first choice that fits the account: dollars if that is all there is.
    if (balances && !(balances.BTC > 0) && balances.USD > 0) { setStrikeSource("USD"); setSource("USD"); }
    setState({ connected: true, balances });
    return { balances, sandbox: c.sandbox };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnect = useCallback(() => {
    if (user?.sk) eraseStrikeKey(user);
    client.current = null;
    setState({ connected: false, balances: null });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    const c = client.current;
    if (!c) return null;
    const b = await c.balances();
    setState({ connected: true, balances: b });
    return b;
  }, []);

  const pickSource = useCallback((v) => { setStrikeSource(v); setSource(getStrikeSource()); }, []);
  const pickReceive = useCallback((v) => { setStrikeReceive(v); setReceive(getStrikeReceive()); }, []);
  const pickDirect = useCallback((on) => { setStrikeDirect(on); setDirect(getStrikeDirect()); }, []);

  return useMemo(() => ({
    connected: state.connected, balances: state.balances, client: client.current,
    sandbox: !!client.current?.sandbox,
    source, receive, direct, setSource: pickSource, setReceive: pickReceive, setDirect: pickDirect, connect, disconnect, refresh,
  }), [state, source, receive, direct, pickSource, pickReceive, pickDirect, connect, disconnect, refresh]);
}
