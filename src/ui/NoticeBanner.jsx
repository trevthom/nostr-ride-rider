// ════════════════════════════════════════════════════════════
//  NOTICE BANNER — Transient banners pinned to the top. Each one auto-
//  dismisses after 6s and can be swiped away (up / left / right).
//  Rendered above everything (very high z-index).
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import Icon from "./Icon.jsx";

function Banner({ notice, onClose }) {
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const start = useRef(null);
  const closed = useRef(false);

  // Auto-dismiss after 6 seconds.
  useEffect(() => {
    const t = setTimeout(() => onClose(notice.id), 6000);
    return () => clearTimeout(t);
  }, [notice.id, onClose]);

  const finish = () => { if (!closed.current) { closed.current = true; onClose(notice.id); } };

  const onDown = (e) => {
    const p = e.touches ? e.touches[0] : e;
    start.current = { x: p.clientX, y: p.clientY };
  };
  const onMove = (e) => {
    if (!start.current) return;
    const p = e.touches ? e.touches[0] : e;
    setDrag({ x: p.clientX - start.current.x, y: p.clientY - start.current.y });
  };
  const onUp = () => {
    if (!start.current) return;
    const { x, y } = drag;
    // Swipe up, left, or right past threshold dismisses.
    if (y < -40 || Math.abs(x) > 60) finish();
    else setDrag({ x: 0, y: 0 });
    start.current = null;
  };

  return (
    <div
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      onTouchStart={onDown}
      onTouchMove={onMove}
      onTouchEnd={onUp}
      className="pointer-events-auto mx-auto max-w-md w-[92%] rounded-2xl px-4 py-3 shadow-xl flex items-center gap-3 select-none bg-black text-white"
      style={{
        transform: `translate(${drag.x}px, ${Math.min(0, drag.y)}px)`,
        transition: start.current ? "none" : "transform 0.15s ease",
        cursor: "grab",
      }}
    >
      <Icon name="bell" size={18} />
      <span className="text-sm font-medium flex-1">{notice.message}</span>
      <button type="button" onClick={finish} aria-label="Dismiss" className="p-1 -mr-1 text-white/70">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

export default function NoticeBanner() {
  const { notices, dismissNotice } = useApp();
  if (!notices || notices.length === 0) return null;
  return (
    <div role="status" aria-live="polite" className="fixed top-3 inset-x-0 z-[10050] flex flex-col gap-2 pointer-events-none">
      {notices.map((n) => (
        <Banner key={n.id} notice={n} onClose={dismissNotice} />
      ))}
    </div>
  );
}
