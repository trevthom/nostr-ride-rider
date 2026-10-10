// ════════════════════════════════════════════════════════════
//  BUTTON — One button used everywhere, with style "variants".
//  Change a variant here and every button of that type updates.
//
//  Usage:
//    <Button onClick={fn}>Primary (black)</Button>
//    <Button variant="go">Confirm (green)</Button>
//    <Button variant="secondary">Back</Button>
//    <Button variant="danger">Cancel ride</Button>
//    <Button variant="ghost">Skip</Button>
//    <Button size="sm" full={false}>Small pill</Button>
//    <Button loading>Working…</Button>
// ════════════════════════════════════════════════════════════

const VARIANTS = {
  primary: "bg-black text-white active:bg-neutral-700",
  go: "bg-[#05944f] text-white active:bg-[#047a41]",
  secondary: "bg-neutral-100 text-black active:bg-neutral-200",
  outline: "bg-white text-black border border-neutral-300 active:bg-neutral-100",
  danger: "bg-red-50 text-red-600 active:bg-red-100",
  ghost: "bg-transparent text-black active:bg-neutral-100",
};

const SIZES = {
  lg: "py-4 text-base rounded-xl",
  md: "py-3 text-[15px] rounded-xl",
  sm: "py-2 px-4 text-sm rounded-full",
};

export default function Button({
  children,
  onClick,
  variant = "primary",
  size = "lg",
  full = true,
  disabled = false,
  loading = false,
  className = "",
  type = "button",
  ...rest
}) {
  const off = disabled || loading;
  const look =
    off && variant !== "ghost" && variant !== "outline"
      ? "bg-neutral-200 text-neutral-400"
      : VARIANTS[variant] || VARIANTS.primary;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={off}
      className={`${full ? "w-full" : ""} ${SIZES[size]} ${look} font-semibold transition-colors disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 ${className}`}
      {...rest}
    >
      {loading && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
