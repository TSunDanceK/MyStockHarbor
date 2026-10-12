// THE QQQ PAGE'S OWN WORDS (#553 COWORK #217), kept out of
// app/markets/qqq/page.tsx (a Next page file exports only Next's names) so the
// checks can read them. The twin of lib/spxPage.ts; the trend score's words are
// shared from there, so both pages describe the same score the same way.
export { trendWords } from "./spxPage";

export const QQQ_URL = "https://www.mystockharbor.com/markets/qqq";
export const QQQ_TITLE = "Nasdaq-100 (QQQ) Analysis (2026) | Market Outlook | MyStockHarbor";
export const QQQ_DESCRIPTION =
  "Nasdaq-100 analysis on QQQ: the trend against its 50- and 200-day averages, price zones, key levels, RSI and MACD, plus a dated weekly read of what moved the index.";

export const FAQ: { q: string; a: string }[] = [
  {
    q: "What is the Nasdaq-100?",
    a: "An index of 100 of the largest non-financial companies listed on the Nasdaq stock market, weighted by market value. Large technology and communication companies make up much of it, so it tends to move more than the broader S&P 500 when those sectors swing.",
  },
  {
    q: "What is market breadth?",
    a: "Breadth measures how many stocks take part in a move, here as the share of Nasdaq-100 members trading above their 200-day average. A rising index with few members above that average is a narrower advance, carried by a smaller group of large names.",
  },
  {
    q: "What is the trend score?",
    a: "A 0–100 reading of the price trend: where QQQ sits against its 50- and 200-day moving averages, how those averages sit against each other, and its 14-day RSI. It describes trend, not sentiment; the Market Mood reading beside it is a broader, market-wide measure.",
  },
  {
    q: "Why are the charts on QQQ rather than the index?",
    a: "Our market data licence covers the Invesco QQQ Trust (QQQ), an ETF that tracks the Nasdaq-100 closely at a fraction of its level. The live charts, levels and signals use QQQ; the weekly write-up quotes the index itself.",
  },
  {
    q: "Is this a buying opportunity?",
    a: "This page describes the market; it doesn't tell anyone what to do. Whether any level suits someone depends on their timeframe, goals and risk tolerance. It can help to look at the weekly trend, breadth and rates together rather than one figure alone.",
  },
];

/** The FAQPage JSON-LD, built from the same FAQ the page shows, so the two never differ. */
export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

/**
 * "Why the weekly chart matters": evergreen, visible, not weekly. The SPX
 * page's explainer, worded for the Nasdaq-100.
 */
export const WEEKLY_CHART_EXPLAINER = [
  "A daily chart shows every swing, and the Nasdaq-100's swings are often larger than the broader market's because so much of the index sits in a few large technology companies. The weekly chart compresses each week into a single bar, which makes the larger trend easier to see. Many investors watch two lines on it: the 50-week moving average, roughly a year of prices, and the 200-week, close to four years. When the index sits above both and both are rising, the longer-term trend is generally described as intact, even if the daily chart is choppy.",
  "The weekly view is also slower to change. One sharp day in chip or AI stocks rarely moves a 50-week average much, so a break below it tends to reflect a sustained shift rather than a single headline. That is why this page shows both charts: the daily one for what moved this week, and the weekly one for the trend those moves sit inside. Neither predicts what happens next; together they describe where the index stands.",
];
