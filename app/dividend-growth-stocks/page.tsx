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

const pageTitle = "Dividend Growth Stocks | Rising Dividends, Yielding Over 2% | MyStockHarbor";
const pageDescription =
  "Stocks paying more than 2% and growing the dividend by more than 5% a year — the combination that compounds income over time rather than paying a large amount that never rises.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: "https://www.mystockharbor.com/dividend-growth-stocks" },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://www.mystockharbor.com/dividend-growth-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: pageTitle, description: pageDescription },
};

const config: PickerResultConfig = {
  href: "/dividend-growth-stocks",
  eyebrow: "DIVIDEND GROWTH SCREENER",
  title: "Dividend Growth Stocks",
  description:
    "Stocks yielding over 2% that are also growing the dividend by more than 5% a year. Both conditions apply together — untick either one in the sidebar to widen the list.",
  explainerTitle: "How to use this screen",
  explainerBody:
    "A rising dividend is a harder signal to fake than a large one. Cutting a dividend is publicly embarrassing, so boards raise them only when they expect the higher payment to be affordable for years.",
  emptyText: "No stocks in the analyzed universe currently meet both the yield and dividend growth conditions.",
  tone: "green",
  kind: "preset",
  presetPredicates: [
    { kind: "number", field: "divYield", min: 2 },
    { kind: "number", field: "divGrowth", min: 5 },
  ],
  // Two predicates define the set, so the ordering key is a choice rather than
  // a reading: divGrowth, because the page is called Dividend GROWTH and yield
  // is the qualifying floor, not the subject. The other one stays visible as a
  // column so a reader can see both. See /low-pe-stocks.
  orderBy: { field: "divGrowth", dir: "desc", label: "Dividend Growth" },
  maxItems: 36,
  // Dividend growth appears on this tab and nowhere else, so opening anywhere
  // else would hide the metric the page is named after.
  defaultTab: "dividends",
  bodySections: [
    {
      heading: "Why growth beats size in a dividend",
      paragraphs: [
        "A 6% yield that never increases and a 3% yield growing at 8% a year look very different on day one and very different again a decade later. The second overtakes the first on income somewhere around year nine, and by then it has usually delivered substantial capital appreciation as well, because a company able to keep raising its dividend is generally a company whose profits are still rising.",
        "That is the real argument for this screen. You are not primarily buying today's income. You are buying a business with enough confidence in its own future cash generation to commit publicly to paying more of it away each year — and the commitment is what makes the signal credible.",
        "Dividend growth also does something a fixed payment cannot: it defends against inflation. An income stream that rises faster than prices preserves its purchasing power. One that is fixed in nominal terms quietly loses value every year, and a 6% yield that never moves is worth meaningfully less in real terms after a decade of even moderate inflation.",
      ],
    },
    {
      heading: "The signal in a raised dividend",
      paragraphs: [
        "Dividend policy is one of the few forward-looking statements a board makes with real consequences attached. Cutting a dividend is an admission of difficulty that draws immediate press coverage and an immediate share price fall, so boards avoid it, which means they raise the payment only when they believe the higher level is sustainable through a downturn as well as a boom.",
        "That asymmetry is what gives the growth rate its information content. Reported earnings can be shaped by accounting choices and management guidance is frequently optimistic, but a dividend increase is cash actually leaving the company. It is a costly signal, and costly signals are the honest kind.",
        "The corollary is that a long unbroken record of increases carries more weight than a single large rise. One big increase can be a one-off, a special payment dressed up, or a board responding to shareholder pressure. A decade of steady rises through at least one recession is evidence about the business itself.",
      ],
    },
    {
      heading: "What to check before acting on this list",
      paragraphs: [
        "Look at the payout ratio alongside the growth rate. A dividend growing faster than earnings is being funded by an expanding share of profit, and that arithmetic has a limit — once the ratio approaches 100% the growth has to stop regardless of how good the record looks. Sustainable dividend growth is ultimately capped by earnings growth.",
        "Be careful with a very high growth figure on this screen. A company restoring a dividend it had previously cut can post an enormous percentage increase off a low base, which is recovery rather than growth and says something quite different about the business. Check what the payment actually did over several years, not just the most recent change.",
        "The 5% and 2% thresholds here are deliberately moderate rather than demanding, because tightening either one collapses the list quickly. If you want a stricter version, raise the growth floor in the sidebar and watch how few names survive — that in itself tells you something useful about how rare durable dividend growth actually is.",
      ],
    },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
