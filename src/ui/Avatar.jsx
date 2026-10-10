// ════════════════════════════════════════════════════════════
//  AVATAR — A round face photo, or the person's initial when they have
//  no photo. `src` is the data URL from their profile (kind 0).
// ════════════════════════════════════════════════════════════

export default function Avatar({ src, name = "", size = 44, className = "", onClick }) {
  const initial = (name.trim()[0] || "?").toUpperCase();
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  const cls = `rounded-full shrink-0 ${onClick ? "cursor-pointer" : ""} ${className}`;
  const body = src ? (
    <img src={src} alt={name || "Profile photo"} style={style} className={`${cls} object-cover bg-neutral-200`} />
  ) : (
    <div style={style} className={`${cls} bg-neutral-200 text-neutral-600 font-semibold flex items-center justify-center`} aria-hidden="true">
      {initial}
    </div>
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={name ? `${name}'s profile` : "Profile"} className="rounded-full shrink-0">
      {body}
    </button>
  ) : (
    body
  );
}
