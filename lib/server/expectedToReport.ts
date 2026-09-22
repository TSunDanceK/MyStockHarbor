// "Expected to report in the next 30 days" — a BAND, never a day.
//
// ── THE MEASUREMENT THIS IS BUILT ON, AND THE ONE IT IS NOT ───────────────
// A day-level forward calendar was measured and killed twice over: cadence
// prediction put 2 of 48 filers inside their OWN p90 band +/-2 days, and 8-K
// scheduling announcements put 0 of 276 in the band a calendar would need.
// lib/server/dueToReport.ts's header records both, and nothing here disputes
// them.
//
// The COARSER claim was never measured, and it is a different claim. Relay
// 35731269985 measured it over the full universe (claude/window30-measurement-
// 2026-09-22.md):
//
//   listing-day precision   82.6%   against a computed "list everyone every
//                                   day" baseline of 31.5% -- 51.2 points
//   median absolute error   3 days      p90 15 days
//   zero usable overlap     1.4%        two thirds of misses are 31-45 days
//
// Those two results agree. medAbs 3d / p90 15d is precisely a distribution
// that destroys an exact date and that a 30-day band absorbs. So this module
// may say "expected within the next 7 days" and must never say "on 14 October".
//
// ── THE BAR IS COMPUTED PER FILER, HERE, NOT COPIED FROM THE PROBE ────────
// The measurement's own conclusion was that a page degrades PER SYMBOL: 90.6%
// of filers clear 70% listing-day precision on their own history, and the
// other 9.4% should not be shown. A committed list of the passing symbols
// would be a snapshot that rots silently the first time a filer changes habit.
//
// So each filer is scored at render time, from the events already in its
// stored record, by the same walk-forward the probe used. The suppression is a
// live computation over live data, and a filer that becomes irregular drops out
// on its own.
import type { ReportEvent } from "./secReportDates";
import type { StoredReportDates } from "./secReportDatesStore";

export const EXPECTED_WINDOW_DAYS = 30;

/**
 * Three bands, and the banding IS the honesty.
 *
 * A flat list ordered by estimated date looks exactly like a schedule; a reader
 * reads position as precision. Grouping into coarse buckets puts the
 * uncertainty into the LAYOUT, so the widest thing on screen is the thing the
 * data actually supports.
 *
 * The edges are not measured and are not claimed to be. They are a reading
 * choice -- "this week", "the next fortnight or so", "later in the month" --
 * and the 30-day outer edge is the only one the measurement speaks to.
 */
export const EXPECTED_BANDS = [
  { id: "d0_7", maxDays: 7, heading: "Within the next 7 days" },
  { id: "d8_21", maxDays: 21, heading: "8 to 21 days away" },
  { id: "d22_30", maxDays: 30, heading: "22 to 30 days away" },
] as const;
export type ExpectedBandId = (typeof EXPECTED_BANDS)[number]["id"];

/** Periods a filer must have before it is scored at all. */
export const MIN_USABLE_PERIODS = 8;
/** Predictions start once the median has this many lags behind it. */
export const SEED_PERIODS = 3;

/**
 * ── TWO BARS, AND WHY THE SECOND IS HIGHER RATHER THAN THE BAND WIDER ─────
 * Measured by class: domestic filers 83.9% listing-day precision with 0.5% of
 * predictions missing entirely; foreign private issuers 72.1% with 8.2%. FPIs
 * clear the baseline comfortably -- dropping all 74 would be throwing away a
 * population for a nameable, sixteen-fold difference in the tail rather than
 * for being unpredictable.
 *
 * The two available levers were a WIDER BAND for FPIs or a HIGHER BAR. This
 * takes the bar, because the band is the sentence a reader reads: two classes
 * of row making two different claims under one heading is a worse honesty
 * problem than a shorter list. One claim, uniformly 30 days, and an FPI earns
 * its place by its own history.
 *
 * 0.80 is a THRESHOLD, not a measurement, and is named as one. What is measured
 * is the 16x difference in zero-overlap rate that motivates it.
 */
export const PRECISION_BAR_DOMESTIC = 0.7;
export const PRECISION_BAR_FPI = 0.8;

export type ExpectedSkip =
  | "no-record" | "no-period-end" | "thin-history"
  | "below-precision-bar" | "outside-window" | "already-due";

export type ExpectedRow = {
  symbol: string;
  band: ExpectedBandId;
  /** Whole days from today to the estimated date. NEVER rendered as a date. */
  daysAway: number;
  /** The fiscal period the expected report would cover. A fact, so renderable. */
  periodEnd: string;
  /** This filer's own median lag, and how many periods it is over. */
  medianLagDays: number;
  fromPeriods: number;
  /** Its own listing-day precision on its own history, 0-1. */
  precision: number;
  isFpi: boolean;
  /** The last results filing on record: a dated public document, so a fact. */
  lastReportedOn: string | null;
  lastReportedPeriodEnd: string | null;
};

const DAY = 86_400_000;
const parse = (d: string): number => Date.parse(`${d}T00:00:00.000Z`);
const valid = (d: unknown): d is string =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(parse(d));
const daysBetween = (from: string, to: string) => Math.round((parse(to) - parse(from)) / DAY);

export const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * A filer's own reporting lags, oldest first, with its class.
 *
 * ── IT READS BOTH BASES, AND secReportDates DELIBERATELY DOES NOT ─────────
 * `estimateNextReport` counts only events whose basis is "8-K item 2.02". That
 * is correct for the live /stock/[symbol] "next expected" line and it is why
 * eight FPIs are structurally absent from the due strip
 * (claude/due-input-census-2026-09-22.md) -- a foreign private issuer files a
 * 6-K, not an 8-K.
 *
 * This module accepts BOTH, and that is a deliberate, narrower widening rather
 * than a fix to the shared estimator. What it buys is 74 FPI filers the
 * measurement scored at 72.1%. What makes it safe HERE and not there: the
 * output is a 30-day band held to a higher bar, not a printed date. The
 * shared estimator is untouched, so nothing on the stock page moves.
 */
export function lagsFrom(events: readonly ReportEvent[] | undefined): {
  lags: number[];
  isFpi: boolean;
} {
  if (!Array.isArray(events)) return { lags: [], isFpi: false };
  const usable = events.filter(
    (e) => e && valid(e.periodEnd) && valid(e.announcedOn),
  );
  const isFpi = usable.some((e) => e.basis === "6-K near period end");
  // Stored newest-first; the walk-forward needs oldest-first, and reversing an
  // array whose order is a documented property of the store is the kind of
  // thing that silently inverts a whole measurement.
  const lags = [...usable]
    .sort((a, b) => parse(a.periodEnd as string) - parse(b.periodEnd as string))
    .map((e) => daysBetween(e.periodEnd as string, e.announcedOn))
    // A negative lag is an announcement before its own period ended, which is
    // a mis-pairing rather than a filer habit. 200 days is past every statutory
    // deadline. Same bounds as the probe, so the two agree.
    .filter((d) => d >= 0 && d <= 200);
  return { lags, isFpi };
}

/**
 * How well this filer's own history predicts its own next date, scored the way
 * a reader experiences it.
 *
 * LISTING-DAY PRECISION, NOT "within 30 days". Over every day D on which we
 * would list the filer (its estimate falls in [D, D+30]), how often does it
 * really report inside that window. Two intervals of WINDOW+1 days offset by
 * the signed error, so the overlap is max(0, 31 - |error|) days out of 31 --
 * which makes a 10-day error two thirds of a hit rather than a whole one.
 * Identical to the probe's scoring, so the bar means what the measurement says.
 */
export function filerPrecision(lags: readonly number[]): { precision: number; predictions: number } | null {
  if (lags.length < MIN_USABLE_PERIODS) return null;
  const span = EXPECTED_WINDOW_DAYS + 1;
  let overlap = 0;
  let n = 0;
  for (let i = SEED_PERIODS; i < lags.length; i++) {
    const m = median(lags.slice(0, i));
    if (m == null) continue;
    // The error in DAYS is the difference between the predicted lag and the
    // realised one: both are measured from the same period end, so the period
    // end cancels and no date arithmetic is needed.
    const error = Math.abs(m - lags[i]);
    overlap += Math.max(0, span - error);
    n++;
  }
  if (!n) return null;
  return { precision: overlap / (n * span), predictions: n };
}

const bandFor = (daysAway: number): ExpectedBandId | null => {
  for (const b of EXPECTED_BANDS) if (daysAway <= b.maxDays) return b.id;
  return null;
};

/** The most recent results filing on record. Newest-first, first dated wins. */
function lastReported(events: readonly ReportEvent[] | undefined) {
  if (!Array.isArray(events)) return { on: null, periodEnd: null };
  for (const e of events) {
    if (e && valid(e.announcedOn)) {
      return { on: e.announcedOn, periodEnd: valid(e.periodEnd) ? e.periodEnd : null };
    }
  }
  return { on: null, periodEnd: null };
}

/** One stored record to one row, or the named reason there isn't one. */
export function expectedFrom(
  symbol: string,
  rec: StoredReportDates | null,
  today: string,
  alreadyDue: ReadonlySet<string>,
): { row: ExpectedRow } | { skip: ExpectedSkip } {
  if (!rec || typeof rec !== "object") return { skip: "no-record" };

  // ── THE DUE STRIP WINS, AND WITHOUT THIS THEY DOUBLE-LIST ────────────────
  // Both sections read the same `nextPeriodEnd` and the same median lag. A
  // filer whose estimate is a few days out is simultaneously "due to report"
  // (dueToReport's k=7 lead) and "expected within 7 days" -- the same company
  // in two sections making two different claims, one confirmed and one
  // estimated. The confirmed one wins: its period has demonstrably ended with
  // nothing filed, which is a fact about the record rather than an estimate.
  if (alreadyDue.has(symbol)) return { skip: "already-due" };

  if (!valid(rec.nextPeriodEnd)) return { skip: "no-period-end" };
  const { lags, isFpi } = lagsFrom(rec.events);
  const scored = filerPrecision(lags);
  if (!scored) return { skip: "thin-history" };

  const bar = isFpi ? PRECISION_BAR_FPI : PRECISION_BAR_DOMESTIC;
  if (scored.precision < bar) return { skip: "below-precision-bar" };

  const lag = median(lags);
  if (lag == null) return { skip: "thin-history" };
  const daysAway = daysBetween(today, rec.nextPeriodEnd) + lag;
  // Past-due is the due strip's business, not this section's, and a band is
  // forward-looking by construction.
  if (daysAway < 0) return { skip: "outside-window" };
  const band = bandFor(daysAway);
  if (!band) return { skip: "outside-window" };

  const last = lastReported(rec.events);
  return {
    row: {
      symbol, band, daysAway,
      periodEnd: rec.nextPeriodEnd,
      medianLagDays: lag,
      fromPeriods: lags.length,
      precision: scored.precision,
      isFpi,
      lastReportedOn: last.on,
      lastReportedPeriodEnd: last.periodEnd,
    },
  };
}

export type ExpectedBuild = {
  rows: ExpectedRow[];
  skipped: Record<ExpectedSkip, string[]>;
  /** Denominator honesty: the section states this, it is not inferred. */
  considered: number;
};

export function buildExpected(
  symbols: readonly string[],
  records: ReadonlyMap<string, StoredReportDates | null>,
  today: string,
  alreadyDue: ReadonlySet<string> = new Set(),
): ExpectedBuild {
  const rows: ExpectedRow[] = [];
  const skipped: Record<ExpectedSkip, string[]> = {
    "no-record": [], "no-period-end": [], "thin-history": [],
    "below-precision-bar": [], "outside-window": [], "already-due": [],
  };
  for (const symbol of symbols) {
    const got = expectedFrom(symbol, records.get(symbol) ?? null, today, alreadyDue);
    if ("row" in got) rows.push(got.row);
    else skipped[got.skip].push(symbol);
  }
  // Nearest first WITHIN a band; the bands themselves carry the ordering a
  // reader sees, so this only decides order inside a bucket.
  rows.sort((a, b) => (a.daysAway - b.daysAway) || (a.symbol < b.symbol ? -1 : 1));
  return { rows, skipped, considered: symbols.length };
}

/** Rows grouped for render, in band order, empty bands dropped. */
export function groupByBand(rows: readonly ExpectedRow[]) {
  return EXPECTED_BANDS
    .map((b) => ({ ...b, rows: rows.filter((r) => r.band === b.id) }))
    .filter((b) => b.rows.length > 0);
}

/**
 * What the section renders. THE TYPE LIVES HERE, NOT IN THE COMPONENT.
 *
 * The producer is in lib/ and the component is in app/; putting the shared
 * shape in the component would make lib/ import from app/, which inverts the
 * dependency and is how a server module ends up pulling a client tree behind
 * it. Same direction dueStripState.ts already sets for DueStripState.
 *
 * Three kinds, and "none" is not "unavailable": nothing clearing the accuracy
 * bar is a claim about our confidence, and an unreadable record is a claim
 * about us.
 */
export type ExpectedSectionState =
  | { kind: "listed"; rows: ExpectedRow[]; considered: number }
  | { kind: "none" }
  | { kind: "unavailable" };
