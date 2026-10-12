// THE PICKER ROW'S CHART LITE (#553 COWORK #214, cut 1, 2026-10-12).
//
// WHY IT EXISTS. Every picker-page regeneration read the whole payload AND the
// whole picker-charts hash (~7.6 MB, 72 enriched bars x ~690 symbols) to ship
// every row's bars to the browser, which used them for four things only:
//
//   the row's sparkline        the last 40 closes        (PickerResultsGrid)
//   the Stretch column (z20)   the last 20 closes        (lib/stretch.ts)
//   the 200 MA column          the last bar's ma200
//   price / % / volume, on a   the last two closes and   (deriveRow, and the
//   price-pool miss            the last bar's volume      server's predicate twin)
//
// So the build stores this compact summary on each record (~0.3 KB instead of
// ~11 KB), the payload read stops attaching the hash, and the full candles are
// fetched only for the rows that draw one (the chart view's visible cards and
// an expanded phone row) through /api/picker-charts.
//
// PURE AND DEPENDENCY-FREE: the build (server), the page (server) and the grid
// (client) all read it, and the derivations must be the same three times.

/** Closes kept: the sparkline's 40, which covers Stretch's 20 and the last two. */
export const CHART_LITE_CLOSES = 40;

export type ChartLite = {
  /** The last CHART_LITE_CLOSES closes, oldest first; null where a bar had no finite close. */
  c: (number | null)[];
  /** The last bar's volume. */
  v: number | null;
  /** The last bar's 200-day moving average. */
  m: number | null;
};

type BarLike = { close?: unknown; volume?: unknown; ma200?: unknown };

const finite = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** The summary of a full bar series, or null for no bars. */
export function chartLiteOf(points: readonly BarLike[] | null | undefined): ChartLite | null {
  if (!Array.isArray(points) || !points.length) return null;
  const tail = points.slice(-CHART_LITE_CLOSES);
  const last = points[points.length - 1];
  return { c: tail.map((p) => finite(p?.close)), v: finite(last?.volume), m: finite(last?.ma200) };
}

/** What deriveRow and the predicate twin read: from full bars when present, else from the lite. */
export type RowBars = {
  /** Finite closes, oldest first (at most CHART_LITE_CLOSES from a lite; all of them from bars). */
  closes: number[];
  /** The last bar's close, or null when it had none. */
  lastClose: number | null;
  /** The bar before it's close, or null. */
  prevClose: number | null;
  lastVolume: number | null;
  lastMa200: number | null;
};

export function rowBars(entry: { chartPoints?: readonly BarLike[] | null; chartLite?: ChartLite | null }): RowBars {
  const pts = Array.isArray(entry.chartPoints) ? entry.chartPoints : [];
  if (pts.length) {
    const last = pts[pts.length - 1];
    const prev = pts.length > 1 ? pts[pts.length - 2] : undefined;
    return {
      closes: pts.map((p) => finite(p?.close)).filter((c): c is number => c !== null),
      lastClose: finite(last?.close),
      prevClose: prev ? finite(prev.close) : null,
      lastVolume: finite(last?.volume),
      lastMa200: finite(last?.ma200),
    };
  }
  const lite = entry.chartLite;
  if (!lite || !Array.isArray(lite.c) || !lite.c.length) {
    return { closes: [], lastClose: null, prevClose: null, lastVolume: null, lastMa200: null };
  }
  const c = lite.c;
  return {
    closes: c.filter((x): x is number => typeof x === "number" && Number.isFinite(x)),
    lastClose: finite(c[c.length - 1]),
    prevClose: c.length > 1 ? finite(c[c.length - 2]) : null,
    lastVolume: finite(lite.v),
    lastMa200: finite(lite.m),
  };
}
