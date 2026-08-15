// Picker pages deliberately removed from Google's index (2026-08-15).
//
// The 34-route `app/components/PickerResultPage.tsx` cluster produced 130
// impressions and 0 clicks in 90 days, and 25 of the 34 had never been shown
// in search at all. Each carries ~60-70 words of unique copy against a shared
// results grid, filter bar, nav, header and footer, so Google had already
// crawled them and declined to index ("Crawled - currently not indexed").
// The point of this list is not to fix those pages but to stop a large
// near-duplicate cluster from dragging on the site-wide quality assessment
// that feeds crawl demand. Full measurement and reasoning:
// claude/picker-pages-demand-data-2026-08-15.md.
//
// These 22 are the zero-signal tail. The 10 keepers are NOT here and must
// stay indexable:
//   /stock-screener (core "All Stocks" hub, header + footer linked),
//   /bullish-bearish-divergence-stocks (canonical 301 target in
//   next.config.ts), /all-time-high-breakout-stocks (position 3.5 - the only
//   page in the whole cluster that ranks), /semiconductor-stocks,
//   /oversold-stocks-today, /low-pe-stocks, /dividend-growth-stocks,
//   /high-dividend-yield-stocks, /cash-rich-value-stocks,
//   /stocks-near-200-day-moving-average.
//
// Two rules this list depends on:
//
//   1. `follow` is not optional. These pages link out to /stock/{sym} and
//      that crawl path is worth keeping - the goal is to drop them from the
//      *index*, not to cut them out of the link graph. next.config.ts serves
//      `X-Robots-Tag: noindex, follow`, never a bare `noindex`.
//   2. They stay live and internally linked, in the Pickers dropdown and the
//      Select Screener sidebar. This is an indexing decision, not a product
//      one, and nothing changes for a visitor. Do NOT 301 them.
//
// Consumed by next.config.ts (serves the header) and app/sitemap.ts (filters
// them out of the sitemap, because a noindex page in a sitemap is a
// contradictory signal). Keep those two in sync by editing only this file.
//
// Three of these are 301 destinations in next.config.ts
// (/stocks-above-200-day-moving-average -> /stocks-trading-above-200-day-
// moving-average, /stocks-with-unusual-volume -> /volume-spike-stocks,
// /buy-the-dip-stocks -> /stocks-down-20-from-all-time-highs). Those
// redirects now land on noindexed pages. That is accepted: the sources were
// thin footer pages with no measurable traffic, so there is no ranking to
// consolidate. Noted so it isn't rediscovered as a bug.
export const NOINDEX_PICKER_PAGES = [
  "/3-month-high-breakout-stocks",
  "/atr-spike-stocks",
  "/bearish-macd-divergence-stocks",
  "/bearish-rsi-divergence-stocks",
  "/best-trend-score-stocks",
  "/breakout-signal-stocks",
  "/bullish-macd-divergence-stocks",
  "/bullish-rsi-divergence-stocks",
  "/cheap-tech-stocks",
  "/macro-support-resistance-stocks",
  "/overbought-stocks-today",
  "/stocks-above-50-day-moving-average",
  "/stocks-below-200-day-moving-average",
  "/stocks-below-50-day-moving-average",
  "/stocks-down-20-from-all-time-highs",
  "/stocks-near-weekly-200-day-moving-average",
  "/stocks-trading-above-200-day-moving-average",
  "/stocks-with-positive-last-earnings",
  "/stocks-with-strong-earnings-growth",
  "/top-stocks-with-buy-signals",
  "/top-stocks-with-sell-signals",
  "/volume-spike-stocks",
] as const;

// Deliberately absent: /bullish-divergence-stocks and /bearish-divergence-
// stocks. The 15 Aug spec listed them among 24, but next.config.ts already
// 301s both to /bullish-bearish-divergence-stocks, so neither route ever
// renders and a robots directive on them would never be served. They have
// also been dropped from app/sitemap.ts, where they were still listed as
// crawlable URLs despite redirecting.
