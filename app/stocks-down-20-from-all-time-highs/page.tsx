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
  title: "Stocks Down 20% From All-Time Highs | MyStockHarbor",
  description: "Find stocks trading at least 20% below their all-time highs while still above their 200-day moving average, ranked to favour tradable pullbacks over broken charts.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-down-20-from-all-time-highs",
  },
  openGraph: {
    title: "Stocks Down 20% From All-Time Highs | MyStockHarbor",
    description: "Find stocks trading at least 20% below their all-time highs while still above their 200-day moving average, ranked to favour tradable pullbacks over broken charts.",
    url: "https://www.mystockharbor.com/stocks-down-20-from-all-time-highs",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Down 20% From All-Time Highs | MyStockHarbor",
    description: "Find stocks trading at least 20% below their all-time highs while still above their 200-day moving average, ranked to favour tradable pullbacks over broken charts.",
  },
};

// kind is "preset", not "section": ships the whole universe with `buyTheDip`
// pre-ticked so Select Screener filters in place. sectionIncludes is kept so the
// section's badge and ordering are re-applied on top. See buildEntries in
// PickerResultPage.tsx.
//
// `buyTheDip` is this page's condition -- the drawdown-from-all-time-high check
// is the same test, just named for what it's used for rather than how it's
// measured. Note the Select Screener checkbox therefore reads "Buy The Dip"
// while the page heading reads "Stocks Down 20% From All-Time Highs"; the URL
// and metadata are deliberately left alone, since renaming a ranking page means
// redirects and starting its search history over.
const config: PickerResultConfig = {
  href: "/stocks-down-20-from-all-time-highs",
  eyebrow: "Pullback stock screener",
  title: "Stocks Down 20% From All-Time Highs",
  description: "Find stocks trading at least 20% below their all-time highs while still above their 200-day moving average, ranked to favour tradable pullbacks over broken charts.",
  explainerTitle: "How to use stocks down from highs",
  // "and above MA200" (#553 COWORK #186 ruling 5): the copy says what the rule does.
  explainerBody: "Every stock here is at least 20% below its all-time closing high and still trading above its 200-day moving average. A large drawdown can create opportunity, but it can also signal real weakness. Use this page to find names worth reviewing, then check whether price is stabilising or still making lower lows.",
  emptyText: "No stocks down 20% from all-time highs and above their 200-day moving average are currently available from the live picker feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["buyTheDip"],
  sectionIncludes: ["stocks down 20"],
  maxItems: 36,
  bodySections: [
    {
      heading: "A deep pullback inside a longer uptrend",
      paragraphs: [
        "This screen pairs two conditions that can look contradictory at first. A stock must be at least 20% below the highest close in its loaded history, and its last close must still be above the 200-day simple moving average (SMA200). The aim is to surface pullbacks that have happened within a longer-term rise, rather than charts that have been falling for a long time.",
        "The “all-time high” here is the highest daily close in up to about five years of data, so it is a long-window peak rather than a true lifetime high, and intraday spikes are ignored. A stock needs at least 220 closes to be considered.",
      ],
    },
    {
      heading: "How the top 20 are chosen",
      paragraphs: [
        "The first 20 rows are ordered by a score that tends to favor drawdowns of roughly 20–35%, heavily traded stocks, a tight trading range over the last 20 days, the strength of the trend, and how price has behaved over the last 10 sessions. The idea is that a moderate decline that has started to settle into a narrow range reads differently from a steep slide still in motion. Everything after the top 20 is sorted by conditions met, the count of tracked screener conditions each stock meets.",
        "When reading the list, it can help to compare the drawdown figure with how far price sits above the 200-day average. A stock only just above that line has less of a cushion than one comfortably clear of it. The chart may also show whether recent lows are holding or still stepping lower.",
      ],
    },
    {
      heading: "What this view can miss",
      paragraphs: [
        "Moving averages lag, so a stock can stay above its 200-day line well after its trend has weakened. A 20% decline may reflect a real change in the business that no price rule can see, such as an earnings reset or lost guidance. The data are daily end-of-day bars, refreshed hourly, so a sharp move in the latest session may not show yet. Membership describes the chart’s shape, not whether the decline is over.",
      ],
    },
    {
      heading: "Reading one row, and the edges of the rule",
      paragraphs: [
        "Take a stock whose highest close in the loaded window was 150 and whose latest close is 114, a 24% drawdown, sitting about 4% above a 200-day average of roughly 110. That fits the rule and lands inside the 20–35% range the ranking favors. If the same stock slipped to 108, it would fall below the average and leave the page, though its drawdown barely changed.",
        "Conversely, a stock 19% off its peak is excluded, however orderly its pullback, and one down 45% can still appear if it remains above its 200-day line, though it will tend to rank lower. Unlike the stocks near the 200-day moving average page, which measures only distance from that average, this screen starts from the size of the decline from the peak and uses the average as a filter.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/stocks-near-200-day-moving-average", label: "Stocks near the 200-day moving average" },
    { href: "/oversold-stocks-today", label: "Oversold stocks today" },
    { href: "/macro-support-resistance-stocks", label: "Macro support and resistance stocks" },
  ],
  relatedGuide: {
    href: "/how-to-find-buy-the-dip-stocks",
    label: "our guide to finding buy-the-dip stocks",
    blurb: "For how to tell a pullback worth reviewing from a broken chart, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
