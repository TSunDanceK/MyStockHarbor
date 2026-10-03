/**
 * ── THE PICKERS PERFORMANCE TAB FROM STORED BARS (#553 CODE-B #94 B6) ──────
 *
 * The 1W / 1M / 6M / YTD / 1Y columns used to be FMP's stock-price-change,
 * cron-warmed into stockDataCache. That ends with FMP on 14 Oct. With
 * PRICE_PROVIDER_PICKERS=tiingo the Pickers build computes them here instead,
 * at BUILD time, from the stored Tiingo EOD bars it already holds for every
 * symbol (split-adjusted, price basis B), so a page view reads nothing new.
 *
 * THE WINDOWS (calendar, from the latest stored close):
 *   1W  = the close 7 days back       1M = 1 month back     6M = 6 months back
 *   1Y  = 12 months back              YTD = the last close of the prior year
 * The base is the last close ON OR BEFORE that date. A return is shown with
 * the date of the close it runs to ("to the close of 2 Oct 2026").
 *
 * EVERY "–" SAYS WHY, AND THE WHY IS TRUE. A period is refused with:
 *   short     the stored history starts after the period begins
 *   gap       there is no stored close within a week before the period begins
 *   noBars    no stored daily history for this stock at all
 *   notBuilt  the row is not in the current screener build (rollout window)
 *   noCache   FMP path: the cron has not loaded this stock's figures
 * "Not enough price history for this period" is the `short` reason ONLY.
 *
 * IMPORTS NOTHING: PickerResultsGrid (a client component) reads the words.
 * Checked by scripts/check-fmpoff-plays-perf.mjs.
 */

export const PERF_KEYS = ["perf1w", "perf1m", "perf6m", "perfYtd", "perf1y"] as const;
export type PerfKey = (typeof PERF_KEYS)[number];

export const PERF_WHY_WORDS = {
  short: "Not enough price history for this period",
  gap: "No stored close near the start of this period",
  noBars: "No stored daily price history for this stock",
  notBuilt: "Not in the current screener build yet",
  noCache: "Performance figures for this stock haven't been loaded",
} as const;
export type PerfWhyCode = keyof typeof PERF_WHY_WORDS;

/** One symbol's returns, in PERF_KEYS order. `asOf` is the close they run to. */
export type PerfRow = {
  asOf: string | null;
  v: (number | null)[];
  why: (PerfWhyCode | null)[];
};

/** A base close more than this many days before the period start is a gap. */
export const PERF_MAX_BASE_GAP_DAYS = 7;

const DAY_MS = 86_400_000;

function parseDay(d: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isFinite(t) ? t : null;
}

function isoDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function monthsBack(t: number, months: number): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay));
}

/** The date each period starts from, given the latest close's date (YYYY-MM-DD). */
export function perfWindowStart(key: PerfKey, lastDate: string): string | null {
  const t = parseDay(lastDate);
  if (t == null) return null;
  switch (key) {
    case "perf1w":
      return isoDay(t - 7 * DAY_MS);
    case "perf1m":
      return isoDay(monthsBack(t, 1));
    case "perf6m":
      return isoDay(monthsBack(t, 6));
    case "perf1y":
      return isoDay(monthsBack(t, 12));
    case "perfYtd":
      return `${new Date(t).getUTCFullYear() - 1}-12-31`;
  }
}

/** Every period refused for one reason (no bars, not built, not cached). */
export function perfRowRefused(code: PerfWhyCode): PerfRow {
  return { asOf: null, v: PERF_KEYS.map(() => null), why: PERF_KEYS.map(() => code) };
}

/**
 * The five returns from a daily series (any order; non-positive or unparseable
 * closes are dropped). Percent, rounded to 2 dp, like FMP's figures were.
 */
export function computePerfFromBars(points: readonly { date: string; close: number }[]): PerfRow {
  const rows = points
    .map((p) => ({ date: String(p?.date ?? "").slice(0, 10), t: parseDay(String(p?.date ?? "")), close: Number(p?.close) }))
    .filter((p): p is { date: string; t: number; close: number } => p.t != null && Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => a.t - b.t);
  if (!rows.length) return perfRowRefused("noBars");
  const last = rows[rows.length - 1];
  const v: (number | null)[] = [];
  const why: (PerfWhyCode | null)[] = [];
  for (const key of PERF_KEYS) {
    const startDay = perfWindowStart(key, last.date);
    const start = startDay ? parseDay(startDay) : null;
    if (start == null) { v.push(null); why.push("noBars"); continue; }
    if (rows[0].t > start) { v.push(null); why.push("short"); continue; }
    let base: (typeof rows)[number] | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].t <= start) { base = rows[i]; break; }
    }
    if (!base || start - base.t > PERF_MAX_BASE_GAP_DAYS * DAY_MS) { v.push(null); why.push("gap"); continue; }
    v.push(Math.round((last.close / base.close - 1) * 10_000) / 100);
    why.push(null);
  }
  return { asOf: last.date, v, why };
}

/** The words for a refused period, or null when there is no code. */
export function perfWhyText(code: string | null | undefined): string | null {
  return code && code in PERF_WHY_WORDS ? PERF_WHY_WORDS[code as PerfWhyCode] : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "to the close of 2 Oct 2026": the label a computed return carries. */
export function perfAsOfLabel(asOf: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(asOf ?? ""));
  if (!m) return null;
  return `to the close of ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** The Performance fields a Pickers row carries (ResultEntry's subset). */
export type PerfFields = Partial<Record<PerfKey, number>> & {
  /** The close the returns run to (YYYY-MM-DD), on the Tiingo path. */
  perfAsOf?: string;
  /** Why each empty period is empty: a PERF_WHY_WORDS code. */
  perfWhy?: Partial<Record<PerfKey, PerfWhyCode>>;
};

/**
 * Lay one row's Performance figures onto a page entry. On Tiingo, the build's
 * PerfRow is the only source: any figure already there is cleared first, so
 * nothing from FMP's stockDataCache can stand beside a Tiingo return. Off
 * Tiingo, the stored (FMP) figures stay and only the empty ones get a reason.
 */
export function applyPerf(entry: PerfFields, row: PerfRow | null | undefined, onTiingo: boolean): void {
  const why: Partial<Record<PerfKey, PerfWhyCode>> = {};
  if (onTiingo) {
    const r = row ?? perfRowRefused("notBuilt");
    PERF_KEYS.forEach((key, i) => {
      const v = r.v?.[i];
      if (typeof v === "number" && Number.isFinite(v)) entry[key] = v;
      else {
        delete entry[key];
        why[key] = r.why?.[i] ?? "notBuilt";
      }
    });
    if (r.asOf) entry.perfAsOf = r.asOf;
    else delete entry.perfAsOf;
  } else {
    for (const key of PERF_KEYS) {
      const v = entry[key];
      if (typeof v !== "number" || !Number.isFinite(v)) why[key] = "noCache";
    }
    delete entry.perfAsOf;
  }
  if (Object.keys(why).length) entry.perfWhy = why;
  else delete entry.perfWhy;
}
