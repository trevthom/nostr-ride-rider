// ════════════════════════════════════════════════════════════
//  LAYOUT — The page structure shared by both apps.
//
//   AppFrame   Phone-width column, full height. On a desktop it sits in
//              the middle of the page; on a phone it fills the screen.
//   MapPage    Map fills the area; a Sheet slides up from the bottom and
//              `top` floats over the map (back button, status pill).
//   Sheet      The white bottom card (Uber/Lyft style).
//   Screen     A plain scrolling page with a big title (Activity, Account).
// ════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useRef, useState, isValidElement, cloneElement } from "react";
import Icon from "./Icon.jsx";

// The Sheet tells its MapPage how tall it is, so the map can keep the route
// and pins in the visible part above it.
const SheetHeight = createContext(() => {});

export function AppFrame({ children }) {
  return (
    <div className="mx-auto h-[100dvh] w-full max-w-md relative overflow-hidden bg-white flex flex-col sm:border-x sm:border-neutral-200">
      {children}
    </div>
  );
}

// `map` is a <MapView/>; `top` floats over it; children are the Sheet.
export function MapPage({ map, top, children }) {
  const [sheetH, setSheetH] = useState(0);
  const shown = sheetH && isValidElement(map) ? cloneElement(map, { padBottom: sheetH + 28 }) : map;
  return (
    <SheetHeight.Provider value={setSheetH}>
      <div className="relative flex-1 min-h-0 bg-neutral-200">
        {shown}
        {top && (
          <div className="absolute top-0 inset-x-0 z-[500] px-4 pt-[max(1rem,env(safe-area-inset-top))] pointer-events-none">
            <div className="flex items-center gap-3 [&>*]:pointer-events-auto">{top}</div>
          </div>
        )}
        {children}
      </div>
    </SheetHeight.Provider>
  );
}

export function Sheet({ children, className = "", label, maxHeight = "82%" }) {
  const report = useContext(SheetHeight);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => report(Math.round(el.getBoundingClientRect().height));
    update();
    let ro;
    try { ro = new ResizeObserver(update); ro.observe(el); } catch { /* older browsers: keep the first measurement */ }
    return () => ro && ro.disconnect();
  }, [report]);
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
