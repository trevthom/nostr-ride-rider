// ════════════════════════════════════════════════════════════
//  PARTS — Small building blocks used across both apps: list rows,
//  toggle switch, spinner, confirm dialog, text field, section label.
// ════════════════════════════════════════════════════════════

import { useEffect } from "react";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

export function Spinner({ size = 20, className = "" }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{ width: size, height: size }}
      className={`inline-block border-2 border-neutral-300 border-t-black rounded-full animate-spin ${className}`}
    />
  );
}

export function SectionLabel({ children, className = "" }) {
  return <h2 className={`text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2 ${className}`}>{children}</h2>;
}

// A tappable list row: icon, title/subtitle, and a right slot (default chevron).
export function Row({ icon, title, subtitle, right, onClick, danger = false }) {
  const body = (
    <>
      {icon && (
        <span className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="flex-1 min-w-0 text-left">
        <span className={`block text-[15px] font-medium truncate ${danger ? "text-red-600" : ""}`}>{title}</span>
        {subtitle && <span className="block text-sm text-neutral-500 truncate">{subtitle}</span>}
      </span>
      {right !== undefined ? right : onClick ? <Icon name="chevron-right" size={18} className="text-neutral-400" /> : null}
    </>
  );
  const cls = "w-full flex items-center gap-3 py-3";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} active:bg-neutral-50`}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${checked ? "bg-black" : "bg-neutral-300"} disabled:opacity-40`}
    >
      <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

// Light text field with an optional label.
export function Field({ label, children }) {
  return (
    <label className="block">
      {label && <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1 block">{label}</span>}
      {children}
    </label>
  );
}
export const inputCls =
  "w-full bg-neutral-100 rounded-xl px-4 py-3 text-[15px] text-black placeholder-neutral-500 border border-transparent focus:outline-none focus:border-black focus:bg-white";

// Modal confirm. Escape cancels. Renders nothing when `open` is false.
export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Keep", danger = false, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/50 nr-fade" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">{title}</h2>
        {message && <p className="text-[15px] text-neutral-600 mb-5">{message}</p>}
        <div className="space-y-2">
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} size="md">{confirmLabel}</Button>
          <Button variant="secondary" onClick={onCancel} size="md">{cancelLabel}</Button>
        </div>
      </div>
    </div>
  );
}

// Bottom-sheet style modal for pickers (contact, payment).
export function Modal({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/50 nr-fade" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[88vh] overflow-y-auto nr-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-3">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto p-2 -mr-2 rounded-full active:bg-neutral-100">
            <Icon name="x" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
