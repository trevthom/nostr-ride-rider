// ════════════════════════════════════════════════════════════
//  MINTS — Which ecash mints the apps use. A driver picks the mint they are
//  paid at (Account); it travels in their offer, and the rider pays at that
//  mint. A mint is a trusted party that holds the money behind ecash, so each
//  person should pick one they trust and may name a different one in Account.
//
//    DEFAULT_MINT        from config/services.js (VITE_DEFAULT_MINT)
//    isMintUrl(url)      an https URL (http only for localhost, for testing)
//    cleanMintUrl(url)   trimmed, no trailing slash; null when it is not a mint URL
//    mintLabel(url)      a short name to show: "mint.example.com"
// ════════════════════════════════════════════════════════════

export function cleanMintUrl(input) {
  if (typeof input !== "string") return null;
  let url;
  try { url = new URL(input.trim()); } catch { return null; }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return (url.origin + url.pathname).replace(/\/+$/, "");
}
export const isMintUrl = (url) => cleanMintUrl(url) === url;

export function mintLabel(url) {
  try { return new URL(url).hostname; } catch { return String(url || ""); }
}
