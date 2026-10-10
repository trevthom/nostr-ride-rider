// ════════════════════════════════════════════════════════════
//  RATING — Star display ("★ 4.92 · 31") and a tappable 5-star input.
// ════════════════════════════════════════════════════════════

import Icon from "./Icon.jsx";

// avg: number | null. count: number of reviews. Shows "New" with no reviews.
export function Rating({ avg, count, className = "" }) {
  if (avg == null || !count) {
    return <span className={`text-xs text-neutral-500 ${className}`}>New</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${className}`}>
      <Icon name="star" size={12} fill="currentColor" strokeWidth={0} className="text-black" />
      {avg.toFixed(2)}
      <span className="text-neutral-500 font-normal">({count})</span>
    </span>
  );
}

export function StarInput({ value, onChange, size = 40 }) {
  return (
    <div className="flex justify-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={s === value}
          aria-label={`${s} star${s > 1 ? "s" : ""}`}
          onClick={() => onChange(s)}
          className={`p-1 ${s <= value ? "text-black" : "text-neutral-300"}`}
        >
          <Icon name="star" size={size} fill="currentColor" strokeWidth={0} />
        </button>
      ))}
    </div>
  );
}
