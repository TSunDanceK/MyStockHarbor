// The picker-page routes, in one place, so nothing has to hand-maintain a
// second copy of them.
//
// WHY THIS FILE EXISTS. warm-picker-universe now revalidates these paths on
// demand, and the alternative was typing ~36 route strings into the cron route.
// That is the shape #376 just removed from stalenessQueue.ts: a list nothing
// checks, which drifts the moment a page is added and reports nothing when it
// does. There was no existing registry to derive from -- NOINDEX_PICKER_PAGES
// covers only the 22 deliberately de-indexed pages and names the 10 keepers in
// prose, and sitemap.ts's seoGuides mixes picker pages with editorial guides --
// so this is that registry.
//
// IT IS HAND-WRITTEN BUT NOT HAND-MAINTAINED. scripts/check-picker-routes.mjs
// asserts this array equals the set of app/**/page.tsx that actually import
// PickerResultPage, so adding a page without listing it here fails, and listing
// a route that no longer exists fails too. A registry that can silently
// disagree with reality is the thing this was supposed to avoid.
//
// EXCLUDED, deliberately: /pickers and /stock/[symbol]. Both import
// PickerResultPage but neither is a picker RESULT page -- /pickers is the hub
// and /stock/[symbol] is a dynamic segment -- and neither carries the
// revalidate constant this list exists to drive.
export const PICKER_ROUTES = [
  "/3-month-high-breakout-stocks",
  "/all-time-high-breakout-stocks",
  "/atr-spike-stocks",
  "/bearish-macd-divergence-stocks",
  "/bearish-rsi-divergence-stocks",
  "/best-trend-score-stocks",
  "/breakout-signal-stocks",
  "/bullish-bearish-divergence-stocks",
  "/bullish-macd-divergence-stocks",
  "/bullish-rsi-divergence-stocks",
  "/cash-rich-value-stocks",
  "/cheap-tech-stocks",
  "/dividend-growth-stocks",
  "/high-dividend-yield-stocks",
  "/low-pe-stocks",
  "/macro-support-resistance-stocks",
  "/overbought-stocks-today",
  "/oversold-stocks-today",
  "/semiconductor-stocks",
  "/stock-screener",
  "/stocks-above-50-day-moving-average",
  "/stocks-below-200-day-moving-average",
  "/stocks-below-50-day-moving-average",
  "/stocks-down-20-from-all-time-highs",
  "/stocks-near-200-day-moving-average",
  "/stocks-near-weekly-200-day-moving-average",
  "/stocks-trading-above-200-day-moving-average",
  "/stocks-with-bearish-trend-flip",
  "/stocks-with-bullish-trend-flip",
  "/stocks-with-positive-last-earnings",
  "/stocks-with-strong-earnings-growth",
  "/stocks-with-weekly-bearish-trend-flip",
  "/stocks-with-weekly-bullish-trend-flip",
  "/top-stocks-with-buy-signals",
  "/top-stocks-with-sell-signals",
  "/volume-spike-stocks",
] as const;

export type PickerRoute = (typeof PICKER_ROUTES)[number];
