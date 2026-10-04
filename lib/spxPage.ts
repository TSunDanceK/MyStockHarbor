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
    q: "Why does the weekly chart matter?",
    a: "Daily moves are noisy. The weekly chart shows the larger trend, so many investors check where the index sits against its 50- and 200-week averages before reading too much into one week.",
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
