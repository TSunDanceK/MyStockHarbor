// LOW / FAIR / RICH AGAINST THE SECTOR, FOR THE VALUATION CARD (#552 COWORK #202 item 3).
//
// Each multiple is placed against its peers' QUARTILES: below the 25th
// percentile is "Low", the middle half is "Fair", above the 75th is "Rich".
// A comparison with peers, never a verdict on value: the words are Low / Fair
// / Rich "vs sector", and no buy or sell wording exists anywhere here.
//
// THE RULES, as measured on the census (CODE-A #219, relay
// write-valuation-sector-census):
//   peers     every fresh SEC picker row with a priced, usable FILED figure:
//             the shipped valuationMultiples without estimates (an estimate
//             must never reach a shown number unmarked) and the pickers' P/E. Refusals, losses, negative book or EBITDA
//             and non-USD rows are out (they never become a figure > 0).
//   groups    the FMP-free SIC sector (sicProfileFor); BANKS (SIC 6000–6299)
//             are their own group, since a bank's multiples are not an
//             industrial's.
//   edges     the sector's quartiles. Measured: they put a steady 25 / 50 / 25
//             of names in Low / Fair / Rich, where 0.8× / 1.2× the median put
//             anywhere from 12% to 65% in "Fair".
//   floor     the P/E sector line's own bars (peSectorLine): at least
//             PE_PEER_FLOOR peers and a half-sample spread within
//             PE_MAX_SPREAD_PCT. Below either, the MARKET-WIDE quartiles are
//             used and the card says so.
//
// PURE. The bands and the marker position are arithmetic over numbers, so a
// check runs every rule on fixtures.
import { quantile, halfSampleSpreadPct, PE_PEER_FLOOR, PE_MAX_SPREAD_PCT } from "./peSectorLine";

export const VALUATION_BAND_KEYS = ["peRatio", "priceToSalesRatio", "priceToBookRatio", "evToEbitda"] as const;
export type ValuationBandKey = (typeof VALUATION_BAND_KEYS)[number];

export type QuartileBench = { n: number; p25: number; median: number; p75: number; spreadPct: number };
export type ValuationBenchmarks = {
  /** The latest close the peers were priced at (YYYY-MM-DD). */
  asOf: string;
  market: Partial<Record<ValuationBandKey, QuartileBench>>;
  groups: Record<string, Partial<Record<ValuationBandKey, QuartileBench>>>;
};

export const BANKS_GROUP = "Banks";

/** Quartiles, count and stability of a list of usable (> 0) figures. */
export function quartileBench(xs: number[]): QuartileBench | null {
  // SORTED FIRST: the half-sample test draws by position, so an unsorted list
  // would give a different spread for the same peers in a different hash
  // order (measured: P/S Basic Materials ±26% one read, ±21% the next).
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  return { n: v.length, p25: quantile(v, 0.25), median: quantile(v, 0.5), p75: quantile(v, 0.75), spreadPct: halfSampleSpreadPct(v) };
}

/** The benchmarks from (group, key, figure) rows. */
export function buildBenchmarks(rows: { group: string; key: ValuationBandKey; val: number }[], asOf: string): ValuationBenchmarks {
  const by = new Map<string, Map<ValuationBandKey, number[]>>();
  const all = new Map<ValuationBandKey, number[]>();
  for (const r of rows) {
    const g = by.get(r.group) ?? new Map();
    g.set(r.key, [...(g.get(r.key) ?? []), r.val]);
    by.set(r.group, g);
    all.set(r.key, [...(all.get(r.key) ?? []), r.val]);
  }
  const pack = (m: Map<ValuationBandKey, number[]>) => {
    const out: Partial<Record<ValuationBandKey, QuartileBench>> = {};
    for (const [k, xs] of m) { const b = quartileBench(xs); if (b) out[k] = b; }
    return out;
  };
  return { asOf, market: pack(all), groups: Object.fromEntries([...by].map(([g, m]) => [g, pack(m)])) };
}

/** Does a group's benchmark clear the P/E line's own bars? */
export function benchUsable(b: QuartileBench | null | undefined): b is QuartileBench {
  return Boolean(b) && b!.n >= PE_PEER_FLOOR && typeof b!.spreadPct === "number" && b!.spreadPct <= PE_MAX_SPREAD_PCT && b!.p75 > b!.p25 && b!.p25 > 0;
}

export type ValuationBand = {
  band: "Low" | "Fair" | "Rich";
  /** Where the marker sits on a bar of three EQUAL thirds, 0–1. */
  pos: number;
  /** True when the figure is past the bar's right end (the marker is pinned). */
  offScale: boolean;
  basis: "sector" | "market";
  /** The group's name when basis is "sector". */
  group: string | null;
  p25: number;
  median: number;
  p75: number;
  n: number;
  /** The tap note: what the bands are, and from what. */
  note: string;
};

const x1 = (v: number) => `${v.toFixed(1)}×`;

/**
 * The band for one figure, or null (no figure, or no benchmark at all).
 * The bar is three equal thirds; within each the marker moves linearly:
 * Low 0 → p25, Fair p25 → p75, Rich p75 → p75 + (p75 − p25), pinned beyond.
 */
export function valuationBand(
  value: number | null | undefined,
  group: string | null,
  bench: ValuationBenchmarks | null | undefined,
  key: ValuationBandKey,
  label: string,
): ValuationBand | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !bench) return null;
  const g = group ? bench.groups[group]?.[key] : undefined;
  const useSector = benchUsable(g);
  const b = useSector ? g! : bench.market[key];
  if (!b || !(b.p75 > b.p25) || !(b.p25 > 0)) return null;
  const width = b.p75 - b.p25;
  let pos: number, offScale = false;
  if (value < b.p25) pos = (value / b.p25) / 3;
  else if (value <= b.p75) pos = 1 / 3 + ((value - b.p25) / width) / 3;
  else {
    const t = (value - b.p75) / width;
    offScale = t > 1;
    pos = 2 / 3 + Math.min(t, 1) / 3;
  }
  const band = value < b.p25 ? "Low" : value > b.p75 ? "Rich" : "Fair";
  const who = useSector ? `${b.n} ${group} companies` : `${b.n} companies across the market`;
  const why = useSector ? "" : group
    ? ` ${group} has too few comparable companies, or too unsteady a spread, for its own bands, so the whole market's are used.`
    : " This company has no sector classification, so the whole market's bands are used.";
  const note =
    `${label} of ${x1(value)} against ${who} with a usable figure, from their SEC filings and the latest close` +
    `${bench.asOf ? ` (${bench.asOf})` : ""}. Low is below ${x1(b.p25)} (the lowest quarter), Rich above ${x1(b.p75)} (the highest quarter); ` +
    `Fair is the middle half, around a median of ${x1(b.median)}.${why} ` +
    `Losses, negative book or earnings, and figures that can't be computed are left out. A comparison with peers, not a view on value.`;
  return { band, pos: Math.max(0, Math.min(1, pos)), offScale, basis: useSector ? "sector" : "market", group: useSector ? group : null, p25: b.p25, median: b.median, p75: b.p75, n: b.n, note };
}
