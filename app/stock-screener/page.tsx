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
  title: "Advanced Stock Screener | MyStockHarbor",
  description: "Screen the full analyzed universe of stocks. Sort any column, switch data tabs (Performance, Valuation, Dividends, Financials, Analysts), or tick any combination of conditions on the left to narrow the list.",
  alternates: { canonical: "https://www.mystockharbor.com/stock-screener" },
  openGraph: {
    title: "Advanced Stock Screener | MyStockHarbor",
    description: "Screen the full analyzed universe of stocks — sort, switch data tabs, or combine any conditions.",
    url: "https://www.mystockharbor.com/stock-screener",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Advanced Stock Screener | MyStockHarbor",
    description: "Screen the full analyzed universe of stocks by any combination of conditions.",
  },
};

const config: PickerResultConfig = {
  href: "/stock-screener",
  eyebrow: "ADVANCED SCREENER",
  title: "Advanced Screener",
  description: "Screen the full analyzed universe of stocks. Nothing is pre-applied here — sort any column, switch between the data tabs, or tick any combination of conditions on the left to narrow the list.",
  explainerTitle: "How to use the advanced screener",
  explainerBody: "This is the whole analyzed universe with nothing pre-filtered — a plain starting point that does not already apply a condition the way the Overbought or Oversold pages do. Sort by any column header, switch between the General, Performance, Valuation, Dividends, Financials and Analysts tabs, or tick any conditions in the left-hand nav to narrow the list. Everything updates instantly in your browser.",
  emptyText: "No stocks are currently available from the live universe.",
  tone: "blue",
  kind: "allSymbols",
  showAllImmediately: true,
  maxItems: 36,
  bodySections: [
    {
      heading: "A blank starting point",
      paragraphs: [
        "Most picker pages on this site open with a rule already applied. This one does not. It shows the whole analysis universe, roughly 700 US-listed stocks, with no condition switched on, so you can build a screen from scratch or simply browse.",
        "That universe is assembled from about 100 large caps, the 300 largest companies by market cap, popular searches on the site, and the day’s movers. It is broad but not complete: many smaller US listings sit outside it and will not appear however you filter.",
        "Rows open in order of conditions met, a count of how many tracked screener conditions each stock currently meets, with ties settled alphabetically. A stock near the top is not ranked as better; it simply matches more of the rules the site tracks.",
      ],
    },
    {
      heading: "Narrowing and reading the table",
      paragraphs: [
        "The sidebar labeled “Select Screener” holds the conditions used across the site’s picker pages. Ticking them filters the table in place, so you can combine, say, a moving-average condition with a momentum one without leaving the page. ‘See more’ just expands how many rows are visible; it does not change which stocks match.",
        "Column headers sort the table, and the tabs switch the data on show: General, Performance, Valuation, Dividends, Financials and Analysts. Every column and tab is available here. Sorting by a single column, such as market cap or a performance figure, can be a quick way to get oriented before ticking any conditions at all.",
        "One practical approach may be to start with a single technical condition, then check the Valuation or Financials tab for context, since a chart pattern and a company’s reported numbers can tell quite different stories about the same stock.",
      ],
    },
    {
      heading: "What the data can and cannot show",
      paragraphs: [
        "Prices come from daily bars of end-of-day data, so the newest bar is the previous session’s close, and the page rebuilds hourly. Moves made during today’s session will not show until the next daily bar lands.",
        "Technical conditions use fixed definitions: moving averages are simple (SMA), RSI is RSI(14), MACD is 12/26/9 and ATR is ATR(14), a measure of typical daily range. A stock may look different on a chart using other settings, and a reading close to a threshold can flip in or out from one day to the next.",
        "The conditions-met figure is also just a count. It does not weigh one condition above another, and it mixes conditions that can point in opposite directions, so a high number might mean quite different things for two stocks. Opening a stock’s chart is usually the quickest way to see what is actually going on.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/oversold-stocks-today", label: "Oversold stocks today" },
    { href: "/best-trend-score-stocks", label: "Best trend score stocks" },
    { href: "/low-pe-stocks", label: "Low P/E stocks" },
    { href: "/top-stocks-with-buy-signals", label: "Top stocks with Buy Signals" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
