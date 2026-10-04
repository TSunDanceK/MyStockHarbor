// P/E VS ITS SECTOR'S MEDIAN, IN WORDS (#552 CODE-A #137 §4, COWORK #147 §2).
//
// Under the stock page's P/E: "▲ Above sector median (21.5×)" / "● Near sector
// median (…)" / "▼ Below sector median (…)". A comparison with peers, never
// "cheap" or "expensive": the words name the comparison and claim nothing
// about value, and the colour stays neutral (the glyph and the word carry it).
//
// THE RULES, as ruled on the census (CODE-A #150):
//   peers       trailing P/E usable (A's peRatio: loss-makers, stale EPS, ADS
//               units, near-zero EPS and non-USD refused), banks (SIC
//               6000–6299) left out, sector from the FMP-free SIC
//               classification (sicProfileFor)
//   floor       at least PE_PEER_FLOOR peers, or no line
//   near        within ±PE_NEAR_PCT % of the median
//   stability   no line where the median moves more than ±PE_MAX_SPREAD_PCT %
//               across half-samples of the peers (5th–95th percentile of 200
//               deterministic draws) — Communication Services and Basic
//               Materials on 4 Oct; they switch on by themselves once they pass
//
// PURE and import-free, so a check runs every rule on fixtures and the census
// script uses the same arithmetic.

export const PE_PEER_FLOOR = 20;
export const PE_NEAR_PCT = 15;
export const PE_MAX_SPREAD_PCT = 25;
const HALF_SAMPLE_DRAWS = 200;
/** The spread reported for fewer than 6 peers: far past any bar. */
export const TOO_FEW_SPREAD = 1e9;

export type SectorMedian = { median: number; n: number; spreadPct: number };

/** Linear-interpolated quantile of a non-empty list. */
export function quantile(xs: number[], p: number): number {
  const a = [...xs].sort((x, y) => x - y);
  const i = (a.length - 1) * p;
  const lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo);
}

/**
 * How far the median moves on a different half of the peers, as ± % of the
 * median: the 5th–95th percentile of 200 half-sample medians. Deterministic
 * (a fixed-seed generator), so the same peers always give the same answer.
 * TOO_FEW_SPREAD below 6 peers: too few to say. A finite number, not
 * Infinity: the medians ride the Data Cache as JSON, where Infinity comes back
 * as null — and `null <= 25` is true.
 */
export function halfSampleSpreadPct(pes: number[]): number {
  if (pes.length < 6) return TOO_FEW_SPREAD;
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const meds: number[] = [];
  for (let k = 0; k < HALF_SAMPLE_DRAWS; k++) {
    const pick = pes.filter(() => rnd() < 0.5);
    if (pick.length >= 3) meds.push(quantile(pick, 0.5));
  }
  const med = quantile(pes, 0.5);
  return ((quantile(meds, 0.95) - quantile(meds, 0.05)) / 2 / med) * 100;
}

/** Each sector's median, peer count and stability, from (sector, usable P/E) pairs. */
export function sectorMedians(rows: { sector: string; pe: number }[]): Record<string, SectorMedian> {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    if (!(r.pe > 0) || !Number.isFinite(r.pe)) continue;
    by.set(r.sector, [...(by.get(r.sector) ?? []), r.pe]);
  }
  return Object.fromEntries([...by].map(([sector, pes]) => [sector, { median: quantile(pes, 0.5), n: pes.length, spreadPct: halfSampleSpreadPct(pes) }]));
}

export type PeSectorLine = { word: "Above" | "Near" | "Below"; glyph: "▲" | "●" | "▼"; text: string; note: string };

/** The line under a P/E, or null where the rules say no line. */
export function peSectorLine(
  pe: number | null | undefined,
  sector: string | null | undefined,
  m: SectorMedian | null | undefined,
  asOf: string,
): PeSectorLine | null {
  if (typeof pe !== "number" || !Number.isFinite(pe) || pe <= 0 || !sector || !m) return null;
  // `typeof … === "number"` first: a spread that arrives as null (or anything
  // not a number) is no line, never a pass.
  if (m.n < PE_PEER_FLOOR || typeof m.spreadPct !== "number" || !(m.spreadPct <= PE_MAX_SPREAD_PCT) || !(m.median > 0)) return null;
  const d = ((pe - m.median) / m.median) * 100;
  const [word, glyph] = Math.abs(d) <= PE_NEAR_PCT ? (["Near", "●"] as const) : d > 0 ? (["Above", "▲"] as const) : (["Below", "▼"] as const);
  return {
    word,
    glyph,
    text: `${word} sector median (${m.median.toFixed(1)}×)`,
    note:
      `The median trailing P/E of ${m.n} ${sector} companies with a usable twelve-month P/E, ` +
      `from their SEC filings and the latest close${asOf ? `, as of ${asOf}` : ""}. Banks and loss-makers are left out. ` +
      `"Near" means within ±${PE_NEAR_PCT}% of the median. A comparison with peers, not a view on value.`,
  };
}
