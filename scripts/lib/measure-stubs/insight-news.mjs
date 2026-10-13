// The news page's cached read for the insight page's measure (#563 COWORK #138
// §1): three headlines and a score for AMZN and AAPL, none for the rest, so the
// card's empty state renders too. Never fetches.
const items = (sym) => [
  { title: `${sym} expands its data-centre build-out with a new multi-year power agreement covering several regions`, link: `https://example.com/${sym}/1`, source: "Reuters", pubDate: "2026-10-01T13:00:00Z" },
  { title: `${sym} quarterly filing shows higher capital spending`, link: `https://example.com/${sym}/2`, source: "SEC EDGAR", pubDate: "2026-09-29T21:05:00Z" },
  { title: `Analysts weigh ${sym}'s cloud growth against rising costs`, link: `https://example.com/${sym}/3`, source: "MarketWatch", pubDate: "2026-09-26T10:30:00Z" },
];
export async function getStockNewsBaseData(symbol) {
  const sym = String(symbol).toUpperCase(), has = sym === "AMZN" || sym === "AAPL";
  return {
    detailedNews: has ? items(sym) : [],
    newsScore: has ? { available: true, score: 61, tone: "green", label: "Slightly Bullish", reason: "Recent headlines lean towards spending plans and growth, with some cost concerns.", positives: [], negatives: [], confidence: "Medium" }
      : { available: false, score: 50, tone: "yellow", label: "Neutral", reason: "", positives: [], negatives: [], confidence: "Low" },
  };
}
