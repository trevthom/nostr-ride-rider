// ════════════════════════════════════════════════════════════
//  LAYOUT — The page structure shared by both apps.
//
//   AppFrame   Phone-width column, full height. On a desktop it sits in
//              the middle of the page; on a phone it fills the screen.
//   MapPage    Map fills the area; a Sheet slides up from the bottom and
//              `top` floats over the map (back button, status pill). `switcher` adds the Ride / Drive switch under it.
//   Sheet      The white bottom card (Uber/Lyft style). With a `peek` it can
//              also be nearly collapsed: only a drag handle and one line show,
//              and the user drags it up (or taps it) to open the details.
//   StickyActions  The main button(s) of a Sheet: they stay at the bottom edge while the rest of the sheet scrolls, so
//              on a short phone the button ("Request ride", "Accept", "Start trip") is never below the fold.
//   Screen     A plain scrolling page with a big title (Activity, Account).
// ════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useRef, useState, isValidElement, cloneElement } from "react";
import Icon from "./Icon.jsx";
import { ModeSwitch } from "./ModeSwitch.jsx";

// The Sheet tells its MapPage how tall it is, so the map can keep the route
// and pins in the visible part above it.
const SheetHeight = createContext(() => {});

export function AppFrame({ children }) {
  return (
    <div className="nr-frame mx-auto w-full max-w-md relative overflow-hidden bg-white flex flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:border-x sm:border-neutral-200">
      {children}
    </div>
  );
}

// `map` is a <MapView/>; `top` floats over it; children are the Sheet.
export function MapPage({ map, top, switcher = false, children }) {
  const [sheetH, setSheetH] = useState(0);
  const shown = sheetH && isValidElement(map) ? cloneElement(map, { padBottom: sheetH + 28 }) : map;
  return (
    <SheetHeight.Provider value={setSheetH}>
      {/* --nr-sheet = the sheet's height: the map's attribution line sits just above the sheet, not under or over it (index.css). */}
      <div className="relative flex-1 min-h-0 bg-neutral-200" style={{ "--nr-sheet": `${sheetH}px` }}>
        {shown}
        {top && (
          <div className="absolute top-0 inset-x-0 z-[500] px-4 pt-[max(1rem,env(safe-area-inset-top))] pointer-events-none">
            <div className="flex items-center gap-3 [&>*]:pointer-events-auto">{top}</div>
          </div>
        )}
        {switcher && (
          <div className="absolute inset-x-0 z-[500] flex justify-center pointer-events-none" style={{ top: "calc(max(1rem, env(safe-area-inset-top)) + 3.25rem)" }}>
            <ModeSwitch className="pointer-events-auto !bg-white shadow-[0_2px_10px_rgba(0,0,0,0.22)]" />
          </div>
        )}
        {children}
      </div>
    </SheetHeight.Provider>
  );
}

// `peek` makes the sheet collapsible: a short line shown next to the drag handle. The
// sheet starts collapsed. `openKey` (when it changes to a non-empty value) opens it, and
// `closeKey` (when it changes) collapses it, so a screen can pop it open when the user
// has something to do and tuck it away again when the stage changes.
const SHEET_MAX = 0.82; // share of the screen the open sheet may use

export function Sheet({ children, className = "", label, maxHeight = "82%", peek, openKey = "", closeKey = "" }) {
  const report = useContext(SheetHeight);
  const ref = useRef(null);
  const headRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(null); // live height while the handle is being dragged
  const [parentH, setParentH] = useState(0);
  const [peekH, setPeekH] = useState(64);
  const collapsible = peek !== undefined;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => report(Math.round(el.getBoundingClientRect().height));
    update();
    let ro;
    try { ro = new ResizeObserver(update); ro.observe(el); } catch { /* older browsers: keep the first measurement */ }
    return () => ro && ro.disconnect();
  }, [report]);

  // Measure the area the sheet may grow into, and the height of the handle + peek line.
  useEffect(() => {
    if (!collapsible) return;
    const measure = () => {
      if (ref.current?.parentElement) setParentH(ref.current.parentElement.clientHeight);
      if (headRef.current) setPeekH(Math.ceil(headRef.current.getBoundingClientRect().height));
    };
    measure();
    let ro;
    try { ro = new ResizeObserver(measure); ro.observe(ref.current.parentElement); ro.observe(headRef.current); } catch { /* keep the first measurement */ }
    return () => ro && ro.disconnect();
  }, [collapsible, peek]);

  useEffect(() => { if (collapsible) setOpen(false); }, [closeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (collapsible && openKey) setOpen(true); }, [openKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!collapsible) {
    return (
      <section
        ref={ref}
        aria-label={label}
        style={{ maxHeight }}
        className={`absolute bottom-0 inset-x-0 z-[600] bg-white rounded-t-3xl shadow-[0_-6px_28px_rgba(0,0,0,0.16)] overflow-y-auto nr-slide-up ${className}`}
      >
        <div className="w-10 h-1 rounded-full bg-neutral-300 mx-auto mt-2.5" aria-hidden="true" />
        <div className="px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </section>
    );
  }

  const fullH = Math.round((parentH || 700) * SHEET_MAX);
  const target = open ? fullH : peekH;
  const height = drag ?? target;

  // Drag the handle: up opens, down collapses, a tap toggles.
  const down = (e) => {
    if (e.button != null && e.button !== 0) return;
    const startY = e.clientY;
    const startH = ref.current ? ref.current.getBoundingClientRect().height : target;
    let moved = 0;
    const clamp = (h) => Math.min(fullH, Math.max(peekH, h));
    const move = (ev) => {
      moved = startY - ev.clientY; // up is positive
      if (Math.abs(moved) > 4) setDrag(clamp(startH + moved));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (Math.abs(moved) <= 4) setOpen((o) => !o);
      else setOpen(moved > 24 ? true : moved < -24 ? false : startH > (peekH + fullH) / 2);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const key = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } };

  return (
    <section
      ref={ref}
      aria-label={label}
      style={{ maxHeight: height, transition: drag == null ? "max-height .28s ease" : "none" }}
      className={`absolute bottom-0 inset-x-0 z-[600] bg-white rounded-t-3xl shadow-[0_-6px_28px_rgba(0,0,0,0.16)] overflow-hidden flex flex-col nr-slide-up ${className}`}
    >
      <div
        ref={headRef}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={open ? "Trip details, drag down to collapse" : "Trip details, drag up to open"}
        onPointerDown={down}
        onKeyDown={key}
        style={{ touchAction: "none" }}
        className="shrink-0 cursor-grab select-none px-5 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] -mb-0"
      >
        <div className="w-10 h-1 rounded-full bg-neutral-300 mx-auto" aria-hidden="true" />
        <div className="flex items-center gap-2 mt-2 min-h-[24px]">
          <div className="flex-1 min-w-0">{peek}</div>
          <Icon name={open ? "chevron-down" : "chevron-up"} size={20} className="text-neutral-400 shrink-0" />
        </div>
      </div>
      <div
        className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto min-h-0"
        style={{ visibility: open || drag != null ? "visible" : "hidden" }}
      >
        {children}
      </div>
    </section>
  );
}

// The main button(s) of a sheet, pinned to the bottom edge of the sheet's scrolling area. Inside a Sheet only.
export function StickyActions({ children, className = "" }) {
  return (
    <div className={`nr-sticky sticky bottom-0 z-10 -mx-5 px-5 pt-3 pb-2 bg-white before:content-[''] before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-gradient-to-t before:from-white before:to-transparent before:pointer-events-none ${className}`}>
      {children}
    </div>
  );
}

// Round white button that floats on the map (back, recenter, close).
export function FloatButton({ icon, label, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`w-11 h-11 rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.22)] flex items-center justify-center text-black active:bg-neutral-100 ${className}`}
    >
      <Icon name={icon} size={20} />
    </button>
  );
}

// A scrolling page: big title, optional back arrow and right slot.
export function Screen({ title, onBack, right, children, flush = false }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-white">
      <header className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3 flex items-center gap-3">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back" className="-ml-2 p-2 rounded-full active:bg-neutral-100">
            <Icon name="chevron-left" size={24} />
          </button>
        )}
        <h1 className="text-[28px] leading-8 font-bold tracking-tight">{title}</h1>
        {right && <div className="ml-auto">{right}</div>}
      </header>
      <div className={flush ? "" : "px-5 pb-8"}>{children}</div>
    </div>
  );
}

// Bottom tab bar. items: [{ id, label, icon, badge }].
export function TabBar({ items, active, onChange }) {
  return (
    <nav aria-label="Main" className="shrink-0 border-t border-neutral-200 bg-white flex pb-[env(safe-area-inset-bottom)] z-[700]">
      {items.map((item) => {
        const on = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            aria-current={on ? "page" : undefined}
            className={`flex-1 flex flex-col items-center gap-0.5 pt-2.5 pb-2 ${on ? "text-black" : "text-neutral-500"}`}
          >
            <span className="relative">
              <Icon name={item.icon} size={24} strokeWidth={on ? 2.4 : 1.8} />
              {item.badge > 0 && (
                <span
                  aria-label={`${item.badge} new`}
                  className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-black text-white text-[10px] font-bold flex items-center justify-center"
                >
                  {item.badge}
                </span>
              )}
            </span>
            <span className={`text-[11px] ${on ? "font-semibold" : "font-medium"}`}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
