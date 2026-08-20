import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl of this page paid a full
// serverless render -- 24h of runtime logs showed cache=MISS on every
// request, never a HIT or PRERENDER. 300s matches the underlying pickers
// cache cycle (and what /pickers already runs at), and the payload is
// cron-warmed into Redis on a shorter cycle than that, so nothing here goes
// stale. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 300;

const pageTitle = "Semiconductor Stocks | Chipmakers, Equipment & Fabs | MyStockHarbor";
const pageDescription =
  "Every semiconductor company in the analyzed universe, from chip designers to the equipment makers that supply the fabs, with valuation, performance and financials on the same table.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: "https://www.mystockharbor.com/semiconductor-stocks" },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://www.mystockharbor.com/semiconductor-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: pageTitle, description: pageDescription },
};

const config: PickerResultConfig = {
  href: "/semiconductor-stocks",
  eyebrow: "SEMICONDUCTOR SCREENER",
  title: "Semiconductor Stocks",
  description:
    "Every semiconductor name in the analyzed universe — designers, manufacturers and equipment suppliers. Switch tabs for valuation, performance or financials, or add a condition from the sidebar.",
  explainerTitle: "How to use this screen",
  explainerBody:
    "Semiconductors are a single industry label covering several very different businesses. A chip designer, a contract manufacturer and a lithography equipment supplier have little in common beyond the end market.",
  emptyText: "No semiconductor stocks are currently available from the live feed.",
  tone: "blue",
  kind: "preset",
  presetPredicates: [{ kind: "category", field: "industry", values: ["Semiconductors"] }],
  maxItems: 36,
  // Deliberately General rather than a metric tab: this page screens on an
  // industry, not a number, so the right opening view is the plain overview --
  // market cap, price, change, industry. The body copy points at Performance as
  // the next place to look, which stays a click away.
  defaultTab: "general",
  bodySections: [
    {
      heading: "One label, several different businesses",
      paragraphs: [
        "The semiconductor industry is usually discussed as a single thing, and it is not. It contains at least four distinct business models, and they behave differently enough that comparing them on the same metrics can be actively misleading.",
        "Fabless designers create chips and pay someone else to build them. They carry little heavy machinery, run high margins, and their fortunes turn on design wins and the strength of a particular product cycle. Foundries do the opposite: they manufacture to order, spend enormous sums on plant, and are judged on capacity utilisation and process leadership. Integrated manufacturers do both under one roof. Equipment makers sell the machines that fabs are built from, and their revenue arrives in large lumps whenever the industry decides to expand.",
        "That last group is the one most often misread. Equipment suppliers do not track chip demand — they track chip capacity investment, which is a different and considerably more volatile series. Their orders can collapse while chip sales are still growing, simply because the fabs have finished building.",
      ],
    },
    {
      heading: "The most cyclical industry on the market",
      paragraphs: [
        "Semiconductors run one of the most pronounced boom-and-bust cycles in public markets, and the mechanism is structural rather than accidental. Fabs take years and tens of billions of dollars to build, so capacity decisions are made against a forecast of demand several years out. When the forecast is too optimistic, capacity arrives into a glut and pricing collapses. When it is too cautious, shortages appear and pricing spikes. Neither state corrects quickly, because the response to both is another multi-year construction decision.",
        "This has a direct and counter-intuitive consequence for valuation. Semiconductor stocks tend to look cheapest on trailing earnings at the top of the cycle, when profits are at a peak that is about to reverse, and most expensive at the bottom, when profits are depressed and about to recover. A low P/E in this industry is more often a late-cycle warning than an opportunity.",
        "It is also why this page does not filter on valuation. When we measured the analyzed universe, only a handful of semiconductor names traded below any defensible definition of cheap — the industry as a whole is priced for growth, and a page promising cheap semiconductors would have had to either mislead or show almost nothing.",
      ],
    },
    {
      heading: "What to look at on this list",
      paragraphs: [
        "Start with the Performance tab. Semiconductor names move together far more than most industries, because they share end markets and sentiment, so a stock diverging sharply from its peers is usually doing so for a company-specific reason worth identifying. Convergence is the norm here; divergence is the signal.",
        "Then consider concentration risk, which is unusually high in this industry. Several of these companies derive a large share of revenue from a small number of customers, and in some parts of the supply chain a single supplier holds effective monopoly on a critical process. Both conditions cut in either direction — enormous pricing power while the position holds, and enormous exposure if it does not.",
        "Geography matters more here than almost anywhere else on the market. A substantial share of the world's most advanced manufacturing capacity sits in one region, and export controls have become a live commercial factor rather than a background political one. Company revenue exposure to particular markets is now a genuine part of the investment case, not a footnote to it.",
      ],
    },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
