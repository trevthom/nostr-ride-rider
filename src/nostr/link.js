// ════════════════════════════════════════════════════════════
//  LINK — Remembers when OUR relays were unreachable, so a relay outage is
//  never counted as the other person's silence (lib/finish.js). "Relays down
//  while both phones are online" means: no signal for either person, and no
//  one is blamed.
//
//    link.start()            begin sampling (once, at app start)
//    link.up()               true when a relay is connected and the device is online
//    link.downMsSince(ms)    total time since `ms` (epoch) that the link was down
//
//  Sampling every 3 s is enough for a 10-minute rule. The first 20 s after
//  start count as up: relays are still connecting.
// ════════════════════════════════════════════════════════════

import { relay } from "./relay.js";

const SAMPLE_MS = 3000;
const KEEP_MS = 6 * 3600000;

export const link = {
  startedAt: 0,
  timer: null,
  downSince: null,
  gaps: [], // [{ from, to }] finished outages
  up() {
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    return online && (relay.linkUp() || Date.now() - this.startedAt < 20000);
  },
  start() {
    if (this.timer) return;
    this.startedAt = Date.now();
    const tick = () => {
      const now = Date.now();
      if (this.up()) {
        if (this.downSince != null) { this.gaps.push({ from: this.downSince, to: now }); this.downSince = null; }
      } else if (this.downSince == null) {
        this.downSince = now - SAMPLE_MS;
      }
      this.gaps = this.gaps.filter((g) => now - g.to < KEEP_MS);
    };
    tick();
    this.timer = setInterval(tick, SAMPLE_MS);
  },
  downMsSince(ms, now = Date.now()) {
    const overlap = (from, to) => Math.max(0, Math.min(to, now) - Math.max(from, ms));
    let total = this.gaps.reduce((s, g) => s + overlap(g.from, g.to), 0);
    if (this.downSince != null) total += overlap(this.downSince, now);
    return total;
  },
};
