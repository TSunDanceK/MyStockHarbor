// THE SPX PAGE'S OWN WORDS (#563 COWORK #90), kept out of app/markets/spx/page.tsx
// (a Next page file exports only Next's names) so the checks can read them.

/**
 * The trend score's words (#563 COWORK #90). buildMarketMoodScore labels its
 * bands Fear / Greed, which is sentiment's vocabulary; the tile reads trend,
 * so its words are the trend's. Same bands as the tile's colour.
 */
export function trendWords(score: number): string {
  return score >= 70 ? "Strong uptrend" : score >= 56 ? "Uptrend" : score > 44 ? "Mixed" : score > 30 ? "Downtrend" : "Strong downtrend";
}

export const FAQ: { q: string; a: string }[] = [
  {
    q: "What is the 200-day moving average?",
    a: "The average closing price over the last 200 trading days, roughly ten months. Many investors use it as a broad trend line: price above a rising 200-day average is generally described as a longer-term uptrend.",
  },
  {
    q: "What is market breadth?",
    a: "Breadth measures how many stocks take part in a move, often as the share of S&P 500 members trading above their 200-day average. A rising index with few stocks above that average is a narrower advance.",
  },
  {
    q: "What is the trend score?",
    a: "A 0–100 reading of the price trend: where SPY sits against its 50- and 200-day moving averages, how those averages sit against each other, and its 14-day RSI. It describes trend, not sentiment; sentiment is the Fear & Greed reading beside it.",
  },
  {
    q: "Why are the charts on SPY rather than the index?",
    a: "Our market data licence covers the SPDR S&P 500 ETF (SPY), which tracks the index closely at about a tenth of its level. The live charts, levels and signals use SPY; the weekly write-up quotes the index itself.",
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
 * "Why the weekly chart matters" (#563 COWORK #91): evergreen, visible, not
 * weekly. General explainer text, kept here rather than in the weekly file.
 */
export const WEEKLY_CHART_EXPLAINER = [
  "A daily chart shows every swing, and in a busy news week those swings can look bigger than they are. The weekly chart compresses each week into a single bar, which makes the larger trend easier to see. Many investors watch two lines on it: the 50-week moving average, roughly a year of prices, and the 200-week, close to four years. When the index sits above both and both are rising, the longer-term trend is generally described as intact, even if the daily chart is choppy.",
  "The weekly view is also slower to change. One bad day rarely moves a 50-week average much, so a break below it tends to reflect a sustained shift rather than a single headline. That is why this page shows both charts: the daily one for what moved this week, and the weekly one for the trend those moves sit inside. Neither predicts what happens next; together they describe where the index stands.",
];
