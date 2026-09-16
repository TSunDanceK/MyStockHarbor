// VIEW COUNTERS AND TICKER DEMAND ARE PRODUCTION FACTS.
//
// ── WHAT THIS EXISTS FOR ─────────────────────────────────────────────────
// A preview deployment renders the same pages as production, including the
// client beacons. Measured on 2026-09-16, one eye-check session put 18 POSTs
// through /api/internal/track-view in forty minutes — every one of them an
// increment against production's per-IP daily page-view counters, from a
// branch nobody had merged.
//
// Ticker interest is worse than a counter: it is a DEMAND RANKING. It decides
// which symbols the site treats as wanted, and an eye-check clicking through
// AAPL and ABT is not demand. A ranking polluted by its own reviewers is a
// ranking that quietly stops describing readers.
//
// ── WHAT IS DELIBERATELY NOT GATED ───────────────────────────────────────
// The price, news, history and fundamentals caches. Those are caches of
// THIRD-PARTY DATA keyed by symbol: a preview filling one costs a fetch that
// production would have made anyway and leaves the same bytes behind. They
// describe the world, not this site's traffic, so a preview writing one is not
// a preview inventing a fact.
//
// Also not gated: the BotID verified/bot-flagged day markers in
// dailyPageLimit. They are middleware per-IP caches rather than counters, and
// gating them would re-challenge every preview request without stopping
// anything a reader can see. Recorded here rather than silently skipped.
import { isProductionDeployment, noteWriteBlocked } from "./deployTarget";

/** True only on the production deployment. See deployTarget. */
export function canWriteDemandState(): boolean {
  return isProductionDeployment();
}

/** Log the refusal once per process. A silent no-count is the worse bug. */
export function noteDemandWriteBlocked(site: string): void {
  noteWriteBlocked("demand", site);
}
