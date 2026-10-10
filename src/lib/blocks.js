// ════════════════════════════════════════════════════════════
//  BLOCKS — A person's own block list: pubkeys they never want to deal with.
//  Pure helpers over the list (the app keeps it in localStorage). Blocking
//  is local to the app on this device: the blocked person is not told.
//    Driver app: a blocked rider's requests never appear.
//    Rider app:  a blocked driver's offers and car never appear.
// ════════════════════════════════════════════════════════════

export const isBlocked = (list, pubkey) => list.some((b) => b.pubkey === pubkey);

export function addBlock(list, pubkey, name = "", at = Date.now()) {
  if (!pubkey || isBlocked(list, pubkey)) return list;
  return [...list, { pubkey, name: String(name || "").slice(0, 60), at }].slice(-500);
}

export const removeBlock = (list, pubkey) => list.filter((b) => b.pubkey !== pubkey);
