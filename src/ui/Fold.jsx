// ════════════════════════════════════════════════════════════
//  FOLD — A section that opens and closes (the Account screens use it for every setting). The header is a button with the
//  section's title, an optional status chip and an arrow. The part inside stays mounted while closed (hidden), so a half-typed
//  field is not lost. Whether a section is open is remembered on this device, per section.
//
//    <Fold id="ecash" title="Wallets" status={{ text: "Needed", tone: "warn" }} defaultOpen={false}>…</Fold>
//    openFold("ecash")                    open one from anywhere (a notice's button, for example)
//    <FoldTitle right={<Chip/>}>Title</FoldTitle>    a heading that a section draws only when it is NOT inside a Fold
//    <SubTitle>Title</SubTitle>           a heading for a part INSIDE a Fold that holds several parts (Wallets); always drawn
//
//  Inside a Fold the section's own title (SectionLabel, FoldTitle) is left out, because the header already shows it.
// ════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useId, useState } from "react";
import { getSetting, setSetting } from "../config/relays.js";
import Icon from "./Icon.jsx";

const InFold = createContext(false);
export const useInFold = () => useContext(InFold);

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
