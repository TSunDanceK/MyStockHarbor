// Picker pages deliberately kept out of Google's index.
//
// HISTORY. 15 Aug: 22 thin picker pages were noindexed as a near-duplicate
// cluster (claude/picker-pages-demand-data-2026-08-15.md); 25 Aug: the four
// Trend Helper flip pages joined them; 5 Oct (#553 COWORK #152): batch 1 left
// once each carried a write-up; 11 Oct (#553 COWORK #202, owner ruling): the
// other 20 left together, each with a write-up of 400+ words.
//
// THE RULES THAT STILL HOLD:
//   1. Copy before index, never the reverse: a page outside this list must
//      carry 400+ words of write-up (scripts/check-picker-copy-before-index.mjs).
//   2. A listed page is served `X-Robots-Tag: noindex, follow` (next.config.ts):
//      `follow` keeps its /stock/{sym} links in the crawl graph.
//   3. It stays live and internally linked; this is an indexing decision only.
//      Do NOT 301 a page because it is listed here.
//
// Consumed by next.config.ts (the header) and app/sitemap.ts (a listed page is
// filtered out of the sitemap). Edit only this file to keep the two in sync.
//
// The one page left: it 301s to /stocks-with-strong-earnings-growth unless
// NEXT_PUBLIC_POSITIVE_LAST_EARNINGS_ENABLED is set (lib/positiveLastEarnings.ts).
// /bullish-divergence-stocks and /bearish-divergence-stocks are not here: they
// 301 to /bullish-bearish-divergence-stocks, so a header on them is never served.
export const NOINDEX_PICKER_PAGES = [
  "/stocks-with-positive-last-earnings",
] as const;
