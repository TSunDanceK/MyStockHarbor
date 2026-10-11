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
  title: "ATR Spike Stocks | MyStockHarbor",
  description: "Stocks whose latest daily range was at least twice their 14-day average true range: a sharp jump in volatility.",
  alternates: { canonical: "https://www.mystockharbor.com/atr-spike-stocks" },
  openGraph: {
    title: "ATR Spike Stocks | MyStockHarbor",
    description: "Stocks whose latest daily range was at least twice their 14-day average true range: a sharp jump in volatility.",
    url: "https://www.mystockharbor.com/atr-spike-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ATR Spike Stocks | MyStockHarbor",
    description: "Stocks whose latest daily range was at least twice their 14-day average true range: a sharp jump in volatility.",
  },
};

const config: PickerResultConfig = {
  href: "/atr-spike-stocks",
  eyebrow: "ATR SPIKE SCREENER",
  title: "ATR Spike Stocks",
  description: "Stocks whose latest daily range was at least twice their 14-day average true range: a sharp jump in volatility.",
  explainerTitle: "How to use ATR spikes",
  // Alternative B (#553 COWORK #186 ruling 4): the copy says what the rule does.
  explainerBody: "A stock is listed when its latest true range (high to low, including any gap from the prior close) is at least twice its 14-day ATR as of the session before. A rising ATR means bigger daily ranges and more volatility — useful for spotting names on the move and for sizing positions and stops. Higher volatility cuts both ways, so manage risk accordingly.",
  emptyText: "No stocks are currently flagged with an ATR spike in the live feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["atrSpike"],
  maxItems: 36,
  bodySections: [
    {
      heading: "Measuring a sudden jump in volatility",
      paragraphs: [
        "Average true range, or ATR, is a way of measuring how far a stock typically moves in a day. The true range for a single day is the distance from high to low, stretched to include any gap from the prior close, so a stock that opens well away from yesterday’s finish has that jump counted too. ATR(14) averages those daily ranges over 14 sessions.",
        "A stock lands on this page when today’s true range is at least twice the ATR(14) as it stood on the previous bar. Comparing against the prior bar matters: the wide day is judged against what was normal before it happened, so the spike cannot dilute its own yardstick. One unusually wide session is enough to qualify, with no need for a run of them.",
        "The data are daily bars of end-of-day prices, so “today” is the previous session’s completed bar. The universe is roughly 700 US-listed stocks, and the page rebuilds hourly.",
      ],
    },
    {
      heading: "How to approach the list",
      paragraphs: [
        "Rows are ordered by conditions met, the number of tracked screener conditions each stock meets, not by the size of the spike. It may help to open the chart and see which way the wide bar went, since the rule is direction-blind: a sharp drop and a sharp rally qualify equally.",
        "Imagine a stock whose ATR(14) stood at $1.50 after the prior session, so the bar to clear is a $3.00 true range. If it then closed at $40 one day and opened at $41.20 the next, trading between $41.00 and $43.10, the high-to-low span alone is only $2.10. Measured from the earlier $40 close up to $43.10, however, the true range is $3.10, and the gap pushes it over the line. A day with a $2.90 range and no gap would fall just short.",
        "The nearest neighbor is the volume spike screen, which looks at how many shares changed hands rather than how far price traveled. The two often overlap on news days, but not always: a stock can swing widely on light trading, or trade heavily inside a narrow range.",
        "Context tends to matter more than the flag itself. A wide range in a stock that has been quiet for months reads differently from one in a name that swings hard as a matter of routine. Checking whether volume also rose, and whether the move came with a gap, can show whether the day was driven by news or by a thin market.",
        "Keep the limits in mind. A single wide session says nothing about what follows, and volatility often settles back toward its average after a shock. Because the comparison uses only one prior ATR value, a stock whose range was unusually compressed beforehand can trip the rule on a fairly ordinary move.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/volume-spike-stocks", label: "Volume spike stocks" },
    { href: "/breakout-signal-stocks", label: "Breakout signal stocks" },
    { href: "/oversold-stocks-today", label: "Oversold stocks today" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
