// A fixture sector table for /sector (#553 COWORK #157): percentages and
// tickers only, one falling sector, one with no figure, one with no movers.
export const SLUGS = ["technology", "healthcare", "financial-services", "consumer-cyclical", "consumer-defensive", "energy", "industrials", "basic-materials", "utilities", "real-estate", "communication-services"];
const NAMES = ["Technology", "Healthcare", "Financial Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Industrials", "Basic Materials", "Utilities", "Real Estate", "Communication Services"];
export async function getSectorPerformanceTable() {
  return {
    builtAt: Date.parse("2026-10-05T12:00:00Z"),
    rows: SLUGS.map((slug, i) => ({
      slug, name: NAMES[i], day: i === 3 ? -1.25 : 0.3 + i * 0.1, week: 1, month: i === 3 ? -4.5 : 1 + i, ytd: i === 3 ? -12.4 : i === 5 ? null : 5 + i * 2,
      sampled: 25, rank: i + 1, dayBasis: "last-close", sessionDate: "2026-10-02",
      capSum: [16, 7, 9, 8, 4, 3, 6, 1.8, 1.5, 1.4, 7][i] * 1e12, capCovered: 40, constituents: 42,
      above200: 20 + i, breadthN: i === 9 ? 0 : 40,
      gainers: i === 7 ? [] : [{ symbol: "AAA" + i, pct: 3.2 }, { symbol: "BBB" + i, pct: 1.4 }],
      decliners: i === 7 ? [] : [{ symbol: "CCC" + i, pct: -2.1 }],
    })),
  };
}
export function sessionDateLabel() { return "2 Oct"; }
// The insight page's sector card (#563 COWORK #133) reads one row.
export async function getSectorPerformanceRow(slug) { return (await getSectorPerformanceTable()).rows.find((r) => r.slug === slug) ?? null; }
