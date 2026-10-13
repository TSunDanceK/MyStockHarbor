// EACH SECTOR'S 3-MONTH LINE, FOR THE /sector CARDS (#553 COWORK #157 item 3,
// ruled in COWORK #167). PURE, so scripts/check-sector-spark.mjs runs it.
//
// The same method as the cards' returns (sectorPanels.ts): the sector's top
// sampled constituents, weighted by tracked cap (equal weights only when none
// has a cap, as weightedAverage does). Each point is the weighted average of
// every member's % move from the window's first session to that day, so the
// line ends where a "3 month" figure would, and its last month moves with the
// "1 month" figure. Percentages only: no close, no bar leaves this file.

export const SECTOR_SPARK_SESSIONS = 63;

export type CloseRow = readonly [date: string, close: number];

export type SectorSpark = {
  /** First and last session of the line (yyyy-mm-dd). */
  from: string;
  to: string;
  /** % from `from`, one per session, rounded to 2 dp. */
  v: number[];
};

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function sectorSeries(
  members: readonly string[],
  closesOf: (symbol: string) => readonly CloseRow[] | undefined,
  capOf: (symbol: string) => number | null | undefined,
  sessions = SECTOR_SPARK_SESSIONS
): SectorSpark | null {
  const rows = new Map<string, Map<string, number>>();
  const dates = new Set<string>();
  for (const s of members) {
    const c = closesOf(s);
    if (!c?.length) continue;
    const tail = c.slice(-(sessions + 5));
    const m = new Map<string, number>();
    for (const [d, close] of tail) if (num(close) && close > 0) { m.set(d, close); dates.add(d); }
    if (m.size) rows.set(s, m);
  }
  const window = [...dates].sort().slice(-(sessions + 1));
  if (window.length < 2) return null;
  const t0 = window[0];
  // Members with a close on the first session; each carries its last close
  // forward over a day it has none (a halt, a late listing in the window).
  const based = [...rows].filter(([, m]) => m.has(t0));
  if (!based.length) return null;
  const capped = based.filter(([s]) => { const w = capOf(s); return num(w) && w > 0; });
  const use = capped.length ? capped : based;
  const weight = (s: string) => (capped.length ? (capOf(s) as number) : 1);
  const total = use.reduce((a, [s]) => a + weight(s), 0);
  const last = new Map(use.map(([s, m]) => [s, m.get(t0) as number]));
  const v = window.map((d) => {
    let sum = 0;
    for (const [s, m] of use) {
      const c = m.get(d);
      if (num(c)) last.set(s, c);
      sum += weight(s) * (((last.get(s) as number) / (m.get(t0) as number)) - 1) * 100;
    }
    return Math.round((sum / total) * 100) / 100;
  });
  return { from: t0, to: window[window.length - 1], v };
}

/** The card's SVG path for a line `w` x `h`, or null when there is nothing to draw. */
export function sparkPath(v: readonly number[], w: number, h: number, pad = 2): string | null {
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  return v
    .map((y, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * (w - 2 * pad) + pad).toFixed(1)} ${(h - pad - ((y - lo) / span) * (h - 2 * pad)).toFixed(1)}`)
    .join(" ");
}

/** Green when the line ends at or above where it started, red otherwise. */
export function sparkUp(v: readonly number[]): boolean {
  return v.length > 0 && v[v.length - 1] >= 0;
}
