// ════════════════════════════════════════════════════════════
//  CONTACT — Turn a contact method from someone's profile (platform +
//  handle, both untrusted text from relays) into a safe link. Links are
//  built from a FIXED prefix plus a strictly cleaned handle, never from a
//  URL in the profile, so a hostile profile can't smuggle in a
//  `javascript:` link or another site. Returns null when it can't be done.
// ════════════════════════════════════════════════════════════

// Format a phone number as it is typed: (XXX) XXX-XXXX. Numbers that start with + are left for the person to
// enter in international form; the saved link strips the punctuation either way (contactHref).
export function formatPhoneInput(value) {
  const raw = String(value ?? "");
  if (raw.trimStart().startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (!digits) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function contactHref(platform, handle) {
  const h = String(handle || "").trim();
  const digits = h.replace(/[^\d+]/g, "");
  switch (platform) {
    case "Phone": return /^\+?\d{5,}$/.test(digits) ? `tel:${digits}` : null;
    case "WhatsApp": return /^\+?\d{5,}$/.test(digits) ? `https://wa.me/${digits.replace(/\D/g, "")}` : null;
    case "Telegram": { const u = h.replace(/^@/, ""); return /^[A-Za-z0-9_]{4,32}$/.test(u) ? `https://t.me/${u}` : null; }
    case "Signal": return /^\+?\d{7,}$/.test(digits) ? `https://signal.me/#p/${digits.startsWith("+") ? digits : "+" + digits}` : null;
    default: return null;
  }
}
