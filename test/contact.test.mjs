// Contact links come from untrusted profiles: only safe, fixed-prefix links.
// Run with: npm test
import assert from "node:assert/strict";
const { contactHref } = await import("../src/lib/contact.js");
assert.equal(contactHref("Phone", "+1 (555) 014-2222"), "tel:+15550142222");
assert.equal(contactHref("WhatsApp", "+1 555 014 2222"), "https://wa.me/15550142222");
assert.equal(contactHref("Telegram", "@jordan_rides"), "https://t.me/jordan_rides");
assert.equal(contactHref("Signal", "555 014 2222"), "https://signal.me/#p/+5550142222");
// Hostile or malformed values give no link at all.
for (const [p, h] of [["Telegram", "javascript:alert(1)"], ["Telegram", "a/../b"], ["Telegram", "x"], ["Phone", "javascript:1"], ["Phone", "12"], ["Signal", "https://evil.example"], ["Email", "a@b.co"], ["Phone", null]]) {
  assert.equal(contactHref(p, h), null, `${p}:${h}`);
}
console.log("contact checks passed");
process.exit(0);
