import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl of this page paid a full
// serverless render -- 24h of runtime logs showed cache=MISS on every
// request, never a HIT or PRERENDER. 300s matches the underlying pickers
// cache cycle (and what /pickers already runs at), and the payload is
// cron-warmed into Redis on a shorter cycle than that, so nothing here goes
// stale. See claude/picker-pages-isr-2026-08-20.md.
// 3600, PAIRED WITH THE HOURLY PRICE TIER.
//
// These two changes only make sense together. A page rebuilt hourly cannot
// DISPLAY anything fresher than an hour, so refreshing the tail of the price
// pool every 30 minutes was buying freshness this surface throws away -- which
// is the argument that moved TIER2_TTL_MS to 60 (lib/server/priceTiers.ts).
// Stretching the window without that would have been a freshness cut with no
// coherent story; making both is a deliberate position: screening and longer
// horizons here, live ticks on TradingView.
//
// ScanFooter prints the OBSERVED age range of the prices on the page rather
// than the policy, so this needs no change there and the spread stays stated
// rather than hidden.
//
// The ISR saving is real but second-order: 36 routes at 48 regenerations a day
// halve to 24, which is ~1,700 fewer a day against a bill dominated by
// /stock/[symbol]. See claude/isr-cadence-2026-09-04.md for the split.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Stocks Near Weekly 200-Day Moving Average | MyStockHarbor",
  description:
    "Browse stocks screening near their weekly 200-day moving average, a slower higher-timeframe trend reference for bigger support and resistance zones.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-near-weekly-200-day-moving-average",
  },
  openGraph: {
    title: "Stocks Near Weekly 200-Day Moving Average | MyStockHarbor",
    description:
      "Browse stocks screening near their weekly 200-day moving average using live MyStockHarbor picker data.",
    url: "https://www.mystockharbor.com/stocks-near-weekly-200-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Near Weekly 200-Day Moving Average | MyStockHarbor",
    description:
      "Browse stocks screening near their weekly 200-day moving average using live MyStockHarbor picker data.",
  },
};

// kind is "preset", not "section": ships the whole universe with
// `weeklyMa200Proximity` pre-ticked so Select Screener filters in place.
// sectionIncludes + filterTimeframe are kept so the weekly section's badge and
// ordering are re-applied on top (filterTimeframe now only scopes which section
// items enrich, since the W/D split is already carried by the flag itself).
// See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/stocks-near-weekly-200-day-moving-average",
  eyebrow: "Weekly MA200 stock screener",
  title: "Stocks Near Weekly 200-Day Moving Average",
  description:
    "Review stocks screening near the weekly 200-day moving average. These are slower, higher-timeframe levels that can matter for larger trend tests.",
  explainerTitle: "How to use weekly MA200 setups",
  explainerBody:
    "The weekly 200-day moving average is a higher-timeframe reference point. These setups are usually slower than daily MA200 tests, so focus on whether the stock is building support, reclaiming the level, or rejecting from it. A weekly 200 average needs about 4 years of price history, so a recently listed stock may not appear here even if it is near the level.",
  // ^ the history note (#553 COWORK #186, item 7): why a younger listing is absent.
  emptyText:
    "No weekly MA200 proximity stocks are currently available from the live picker feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["weeklyMa200Proximity"],
  sectionIncludes: ["weekly ma200"],
  filterTimeframe: "W",
  maxItems: 36,
  bodySections: [
    {
      heading: "A 200-week average, despite the name",
      paragraphs: [
        "The address says 200-day, but the line this page measures is the 200-week simple moving average: the mean of the last 200 weekly closes, close to four years of trading. Because it moves so slowly, a stock reaching it is often revisiting a level last seen years earlier, which is why longer-term chart readers tend to watch it.",
        "A stock is included when its price sits between 1% below and 3% above that average. The band is lopsided on purpose, leaning toward stocks holding at or just above the line rather than ones well beneath it.",
      ],
    },
    {
      heading: "History, timing and ordering",
      paragraphs: [
        "The calculation needs at least 220 weekly bars, a little over four years of data, so recently listed companies cannot appear even if they look close to the level on a chart elsewhere. The current, unfinished week counts as a bar, so the reading can shift during the week as new daily closes arrive, and a stock may join or leave before the week is out.",
        "The top 20 candidates are ranked and shown first. Remaining matches follow in conditions met order, a count of how many tracked screener conditions each stock meets.",
      ],
    },
    {
      heading: "Reading weekly tests carefully",
      paragraphs: [
        "Weekly setups unfold slowly, so a stock may sit in this band for several weeks before anything resolves. Checking whether price approached from above, after a long pullback, or from below, after a recovery, can add useful context, and so can the slope of the average itself, since a rising 200-week line and a flat one describe quite different histories.",
        "The screen cannot tell whether the level will hold, and a single wide week can carry price straight through the band. Prices are end-of-day, the newest bar being the previous session’s close, and the page rebuilds hourly. For a faster view of the same idea, the daily 200-day page uses the same −1% to +3% band, measured on daily bars.",
      ],
    },
    {
      heading: "A hypothetical weekly reading",
      paragraphs: [
        "Suppose a stock’s 200-week average stands at 60 and its latest price is 61.20, 2% above the line, so it falls inside the band. A week of steady gains to 62 would put it about 3.3% above and outside the range, while a drop to 59.20 would leave it about 1.3% below and outside on that side too. Because the unfinished week is counted, either change could happen midweek, so the row may come and go between visits.",
        "Stocks hovering just beyond the band, say 4% above an average that is still rising, will not be listed here, however close they look. A stock with barely 220 weekly bars also has only a short history of the average itself, so its slope may say little yet. The weekly trend flip pages, by contrast, use closed weeks only, so their readings change once a week rather than during it.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/stocks-near-200-day-moving-average", label: "Near the daily 200-day average" },
    { href: "/stocks-with-weekly-bullish-trend-flip", label: "Weekly bullish trend flips" },
    { href: "/macro-support-resistance-stocks", label: "Macro support and resistance" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
