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
  title: "Volume Spike Stocks | MyStockHarbor",
  description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
  alternates: { canonical: "https://www.mystockharbor.com/volume-spike-stocks" },
  openGraph: {
    title: "Volume Spike Stocks | MyStockHarbor",
    description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
    url: "https://www.mystockharbor.com/volume-spike-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Volume Spike Stocks | MyStockHarbor",
    description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
  },
};

const config: PickerResultConfig = {
  href: "/volume-spike-stocks",
  eyebrow: "VOLUME SPIKE SCREENER",
  title: "Volume Spike Stocks",
  description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
  explainerTitle: "How to use volume spikes",
  explainerBody: "A volume spike shows unusual interest and can precede or confirm a big move in either direction. Pair it with the price action and news to judge whether it is accumulation, distribution or a one-off.",
  emptyText: "No stocks are currently flagged with a volume spike in the live feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["volumeSpike"],
  maxItems: 36,
  // WRITE-UP (#553 COWORK #152, batch 1 of the indexing test, 2026-10-05):
  // what the condition is and how this page computes it, from the builder's
  // own thresholds; distinct per page; descriptive only.
  bodySections: [
    {
      heading: "What counts as a volume spike here",
      paragraphs: [
        "Volume is the number of shares that changed hands in a session. On its own the figure says little, because a large company routinely trades tens of millions of shares a day while a smaller one may trade a few hundred thousand. What matters is volume compared with the stock's own normal level, and that comparison is what this page measures.",
        "A stock is listed when its latest daily volume is at least 1.8 times its average daily volume over the previous 20 sessions. The 20-session window is roughly one trading month, long enough to smooth out an ordinary busy day and short enough to reflect how the stock has been trading recently. The test is relative, so a small company and a mega-cap can both appear when each trades well above its own usual level.",
        "The threshold is deliberately moderate. A session at 1.8 times average is clearly unusual without being extreme, which means the list catches the early or milder cases as well as the dramatic ones. Some names here may be trading at three, five or ten times their normal volume; the Volume column on the General tab shows the session's figure, which is the place to compare them.",
      ],
    },
    {
      heading: "Why the volume may have jumped",
      paragraphs: [
        "The cause behind a spike often matters more than its size. Scheduled events are the most common: a quarterly report, a guidance update, an investor day or a regulatory decision with a known date. Volume around those events is expected, and a spike on the day of a report says more about the reaction than about anything hidden.",
        "Other spikes have mechanical causes with little to do with the company itself. Index rebalancing days, the monthly and quarterly options expiry dates, and large block trades between institutions can all push volume far above normal for a single session. These often leave the price close to where it started, which is one way to recognise them.",
        "Then there are the spikes with no obvious calendar reason: news that broke during the session, a move across the whole sector, or a change in how the market is valuing the business. Checking the stock's news page is usually the fastest way to tell an explained spike from an unexplained one, and the two may deserve very different levels of attention.",
      ],
    },
    {
      heading: "Putting the price move next to the volume",
      paragraphs: [
        "Volume describes participation, not direction. The same spike can sit under a large rise, a large fall or almost no change at all, and each of those combinations reads differently. The % Change column next to Volume is the first thing to look at: heavy volume with a big price move suggests a broad reassessment, while heavy volume with a flat price suggests large orders being matched without either side gaining ground.",
        "Where the spike sits on the chart adds a second layer. Heavy trading as the price pushes through a level it has struggled with before tends to be read differently from heavy trading after a long, steady run. The Performance tab helps place the session in context, showing whether it comes after a quiet stretch or at the end of a strong week or month.",
        "A single session of high volume is a snapshot, and its meaning often becomes clearer only over the following days, as volume either stays elevated or drops back to normal. A related page tracks sharp rises in daily price range (ATR) rather than shares traded, and the two lists overlap only sometimes. Nothing on this page is a forecast or a recommendation; it shows where trading interest was unusually high in the latest session.",
      ],
    },
  ],
  relatedGuide: {
    href: "/learn/volume",
    label: "our lesson on volume",
    blurb: "For what a volume spike signals and what it doesn't, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
