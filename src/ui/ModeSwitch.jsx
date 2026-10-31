// ════════════════════════════════════════════════════════════
//  MODE SWITCH — The Ride / Drive switch of the one app. A small pill with two buttons; the face on screen is pressed.
//  It is drawn at the top of every main screen (Home, Activity / Earnings, Account) and nowhere during a trip.
//
//    <ModeProvider mode lock warn onSwitch>…</ModeProvider>   the app shell provides it (src/app/App.jsx)
//    <ModeSwitch />                                            draws nothing outside a ModeProvider
//
//  Rules (the shell sets them):
//    lock  a sentence: the switch is closed ("Finish your drive first."). Tapping the other side shows it as a notice.
//    warn  a sentence: switching is allowed but costs something ("You will go offline."): the person confirms first.
// ════════════════════════════════════════════════════════════

import { createContext, useCallback, useContext, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { ConfirmDialog } from "./Parts.jsx";

const ModeContext = createContext(null);
export const useMode = () => useContext(ModeContext);

const LABEL = { ride: "Ride", drive: "Drive" };

export function ModeProvider({ mode, lock = null, warn = null, onSwitch, children }) {
  const { pushNotice } = useApp();
  const [ask, setAsk] = useState(null); // the face a person is about to leave for, waiting for "Switch"
  const request = useCallback((next) => {
    if (next === mode) return;
    if (lock) return pushNotice(lock);
    if (warn) return setAsk(next);
    onSwitch(next);
  }, [mode, lock, warn, onSwitch, pushNotice]);
  return (
    <ModeContext.Provider value={{ mode, lock, request }}>
      {children}
      <ConfirmDialog open={!!ask} title={`Switch to ${LABEL[ask] || ""}?`} message={warn || ""} confirmLabel="Switch" cancelLabel={`Stay in ${LABEL[mode]}`}
        onConfirm={() => { const next = ask; setAsk(null); onSwitch(next); }} onCancel={() => setAsk(null)} />
    </ModeContext.Provider>
  );
}

export function ModeSwitch({ className = "" }) {
  const ctx = useMode();
  if (!ctx) return null;
  const { mode, lock, request } = ctx;
  return (
    <div role="group" aria-label="Ride or drive" className={`inline-flex rounded-full bg-neutral-100 p-0.5 text-[13px] font-semibold ${className}`}>
      {["ride", "drive"].map((id) => {
        const on = id === mode;
        return (
          <button key={id} type="button" aria-pressed={on} aria-disabled={!on && lock ? true : undefined} title={!on && lock ? lock : undefined} onClick={() => request(id)}
            className={`px-4 py-1.5 rounded-full ${on ? "bg-black text-white" : lock ? "text-neutral-400" : "text-neutral-700"}`}>{LABEL[id]}</button>
        );
      })}
    </div>
  );
}
