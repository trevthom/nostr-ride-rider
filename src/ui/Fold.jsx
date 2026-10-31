// ════════════════════════════════════════════════════════════
//  FOLD — A section that opens and closes. Account no longer uses folds (every setting has its own screen now), but the
//  piece that matters there is kept here: a section shown on its own screen must not draw its own title again, because the
//  screen's header already names it. `ScreenBody` says so, and `Fold` does the same for a fold's header.
//
//    <Fold id="x" title="…">…</Fold>     a section that opens and closes on this device
//    <ScreenBody>…</ScreenBody>          a section on a screen of its own (its label is left out)
//    <FoldTitle right={<Chip/>}>Title</FoldTitle>    a heading that a section draws only when it is NOT inside one of those
//    <SubTitle>Title</SubTitle>           a heading for a part that holds several parts (Wallets); always drawn
//
//  Inside a Fold or a ScreenBody the section's own title (SectionLabel, FoldTitle) is left out, because the header shows it.
// ════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useId, useState } from "react";
import { getSetting, setSetting } from "../config/relays.js";
import Icon from "./Icon.jsx";

const InFold = createContext(false);
export const useInFold = () => useContext(InFold);

// A section on a screen of its own (Account → Wallets, → Keys, …): the screen's title replaces the section's label.
export function ScreenBody({ children }) {
  return <InFold.Provider value={true}>{children}</InFold.Provider>;
}

const EVENT = "nostrride-fold";
export function openFold(id) {
  setSetting("fold_" + id, true);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: { id } }));
}

const TONES = { ok: "bg-[#e6f4ec] text-[#05683a]", warn: "bg-amber-50 text-amber-800" };

export default function Fold({ id, title, status = null, defaultOpen = false, children }) {
  const key = "fold_" + id;
  const [open, setOpen] = useState(() => {
    const saved = getSetting(key, null);
    return saved === null ? defaultOpen : saved === true;
  });
  const bodyId = useId();
  useEffect(() => {
    const on = (e) => { if (e.detail?.id === id) setOpen(true); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [id]);
  const toggle = () => {
    setSetting(key, !open);
    setOpen(!open);
  };
  return (
    <section className="border-b border-neutral-200 last:border-b-0">
      <h2>
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle} className="w-full flex items-center gap-3 py-3.5 text-left">
          <span className="flex-1 min-w-0 text-[15px] font-semibold text-black">{title}</span>
          {status && <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${TONES[status.tone] || TONES.ok}`}>{status.text}</span>}
          <Icon name={open ? "chevron-up" : "chevron-down"} size={18} className="text-neutral-400 shrink-0" />
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="pb-5">
        <InFold.Provider value={true}>{children}</InFold.Provider>
      </div>
    </section>
  );
}

// A heading for a section that has no SectionLabel. Left out inside a Fold; `right` (a status chip) is still drawn.
export function FoldTitle({ children, right = null, className = "" }) {
  const inFold = useInFold();
  if (inFold) return right ? <div className="flex justify-end mb-2">{right}</div> : null;
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <p className="text-neutral-500 text-xs uppercase tracking-wider font-semibold">{children}</p>
      {right}
    </div>
  );
}

// A heading for one part of a Fold that holds several parts (the Wallets fold). Unlike FoldTitle it is always drawn.
export function SubTitle({ children }) {
  return <h3 className="text-[13px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">{children}</h3>;
}
