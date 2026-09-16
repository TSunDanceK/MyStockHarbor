// WHEN A COMPANY ACTUALLY ANNOUNCED, FROM ITS OWN FILINGS — not from a vendor.
//
// ── WHAT THIS REPLACES AND WHY ────────────────────────────────────────────
// The earnings page reads announcement dates and before-open/after-close timing
// from FMP's /earnings. Those are the last two fields on the page still coming
// from a vendor, and they are the two a filer publishes itself: an 8-K carrying
// Item 2.02 ("Results of Operations and Financial Condition") IS the earnings
// announcement, and EDGAR records the moment it was accepted.
//
// A FILING DATE IS NOT AN ANNOUNCEMENT DATE, which is the whole reason this
// module reads `acceptanceDateTime` rather than `filingDate`. EDGAR rolls the
// filing date to the next business day for anything accepted after 17:30 ET, so
// a 16:05 release on a Thursday can carry Friday's filingDate. Using it would
// put the market reaction on the wrong session — the exact defect the price
// reaction card exists to avoid.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
// It does not read numbers. EPS and revenue come from the stored fact set and
// nowhere else (claude/traps/two-validators-for-one-value.md). This module
// supplies DATES and TIMING only.

/** Where a filing sits against the US regular session, in Eastern time. */
export type ReportTiming = "before-open" | "during-market" | "after-close";

export type ReportEvent = {
  /**
   * ── THE 8-K reportDate IS NOT A PERIOD END, AND I BUILT ON THE ASSUMPTION
   * THAT IT WAS ──────────────────────────────────────────────────────────────
   *
   * EDGAR labels it "Date of Report (Date of earliest event reported)". For an
   * Item 2.02 8-K the earliest event reported IS THE RESULTS RELEASE, so this
   * field is the announcement date, not the quarter it covers.
   *
   * The first version of this module called it `periodEnd` and computed the
   * reporting lag as announcedOn - reportDate. That is announcement minus
   * announcement: ZERO by construction. The backtest then "predicted" the
   * announcement date from the announcement date and reported a median
   * absolute error of 0 days across 103 filers, which read as an
   * extraordinarily good model and was an identity.
   *
   *   AA  prior lags [0,0,0,0,0,0] (n=42) median 0d
   *       period end 2026-07-16 -> predicted 2026-07-16 · actual 2026-07-16
   *
   * Six zero lags in a row is not a well-behaved filer, it is a tautology, and
   * the field name was what hid it.
   */
  eventDate: string | null;
  /**
   * The FISCAL PERIOD the results cover, matched from the stored fact set —
   * the only place this repository holds real period ends.
   *
   * Null where no stored period lines up, and that is the honest answer: an
   * announcement older than the retention window has no period to measure a
   * lag against, and inventing one from the filing itself is the mistake above.
   */
  periodEnd: string | null;
  /** Announcement DATE in ET (YYYY-MM-DD), taken from acceptanceDateTime. */
  announcedOn: string;
  /** Announcement time in ET, HH:MM. */
  announcedAt: string;
  timing: ReportTiming;
  form: string;
  /** The raw items string, so a reader can see why this filing was selected. */
  items: string | null;
  accession: string;
  /**
   * HOW this event was identified, carried with it rather than inferred later.
   *
   * The two paths are not equally strong and must not be presented as if they
   * were: an 8-K names Item 2.02 explicitly, while a 6-K has no items taxonomy
   * at all and is selected by a weaker rule. See `SIX_K_IS_A_WEAKER_SIGNAL`.
   */
  basis: "8-K item 2.02" | "6-K near period end";
};

/**
 * ── THE 6-K PROBLEM, STATED RATHER THAN PAPERED OVER ──────────────────────
 *
 * A foreign private issuer files 6-K, not 8-K, and THE 6-K FORM HAS NO ITEM
 * CODES. `items` is empty for every one of them, so "the filing that carries
 * Item 2.02" is not a question that can be asked of a 6-K.
 *
 * A 6-K carries anything the filer must disclose at home: results, yes, but
 * also board changes, dividends, AGM notices, press releases of every kind. A
 * filer can publish twenty in a year.
 *
 * So this module uses a POSITIONAL rule for them — a 6-K whose reportDate is a
 * period end the filer also reports figures for — and marks the result with a
 * different `basis` so nothing downstream can treat the two as equivalent
 * evidence. Where the rule is wrong it will be wrong by selecting a nearby
 * non-results 6-K, which is why the probe reports 8-K and 6-K agreement
 * SEPARATELY and never as one blended number.
 */
export const SIX_K_IS_A_WEAKER_SIGNAL = true;

/**
 * How long after a period ends an announcement about it can plausibly arrive.
 *
 * Wide enough for a slow annual filer (the statutory 10-K deadline alone is 90
 * days for a non-accelerated filer) and narrow enough that an announcement
 * cannot match the period BEFORE the one it is about.
 */
export const MAX_PERIOD_TO_ANNOUNCEMENT_DAYS = 120;

/** Item 2.02 — Results of Operations and Financial Condition. */
const RESULTS_ITEM = "2.02";

/** US regular session, Eastern. */
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 16 * 60;

/**
 * The shape `filings.recent` actually has: parallel arrays, one entry per
 * filing, indexed together. Optional throughout because a partial payload must
 * produce no events rather than throw.
 */
export type SubmissionsFilings = {
  accessionNumber?: unknown[];
  filingDate?: unknown[];
  reportDate?: unknown[];
  acceptanceDateTime?: unknown[];
  form?: unknown[];
  items?: unknown[];
};

export type Submissions = {
  cik?: unknown;
  name?: unknown;
  /** "Large accelerated filer" | "Accelerated filer" | "Non-accelerated filer" | … */
  category?: unknown;
  filings?: { recent?: SubmissionsFilings };
};

/**
 * ── THE TIMEZONE, WHICH IS THE ONE THING HERE THAT CAN BE SILENTLY WRONG ──
 *
 * `acceptanceDateTime` is serialised as `2026-07-28T14:58:11.000Z`, and THE Z IS
 * REAL: the digits are UTC and must be converted to Eastern.
 *
 * I ASSUMED THE OPPOSITE AND WAS WRONG. The first version of this module took
 * the digits at face value as Eastern wall time, on the widely-repeated claim
 * that EDGAR stamps acceptance in ET and the serializer appends a spurious Z.
 * scripts/sec-report-dates-probe.mjs was written to settle it rather than
 * argue it, and it settled it against me:
 *
 *   PANEL: 10 filers whose habit is public and stable
 *     digits read as EASTERN            5/10 in the expected bucket
 *     digits read as UTC and converted  10/10
 *
 * THE BEFORE-OPEN HALF IS WHAT DISCRIMINATES. KO, PG, CAT and MMM stamp
 * 10:58Z, 11:03Z, 10:31Z and 10:34Z. Read as Eastern those are 10:58, 11:03,
 * 10:31, 10:34 — all "during market", all wrong. Converted they are 06:58,
 * 07:03, 06:31 and 06:34 ET, which is what a before-open release looks like.
 *
 * The after-close half (AAPL, MSFT, NVDA, GOOGL, AMZN) lands after 16:00 under
 * BOTH readings, which is exactly why a panel of only mega-caps would have
 * confirmed the wrong answer — 5 of 5, and meaningless.
 *
 * HAD THIS SHIPPED, nothing would have failed. Every before-open filer on the
 * site would simply have been labelled "during market", forever, and the price
 * reaction card would have measured the wrong session for them.
 *
 * ── AND THE CONVERSION IS Intl, NOT A FIXED OFFSET ────────────────────────
 * Eastern is UTC-5 or UTC-4 depending on the date, and a hardcoded -5 puts
 * every summer filing an hour early — enough to move a 09:00 ET release across
 * the 09:30 open. `America/New_York` via Intl knows the rules and the
 * historical transitions; nothing here needs to.
 *
 * THE DATE CONVERTS TOO, which is the part a naive fix misses: a filing
 * accepted at 00:30Z is 20:30 ET on the PREVIOUS day, and reporting it under
 * the UTC date puts the announcement on a session that had already closed.
 */
const ET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function parseAcceptanceEt(raw: unknown): { date: string; time: string; minutes: number } | null {
  if (typeof raw !== "string") return null;
  // EDGAR writes it with a Z, but not always; a bare "YYYY-MM-DD HH:MM:SS" is
  // the same instant in UTC and is normalised here rather than at every caller.
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const parts = ET.formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const [y, mo, d, hh, mm] = [get("year"), get("month"), get("day"), get("hour"), get("minute")];
  if (!y || !mo || !d || !hh || !mm) return null;
  return {
    date: `${y}-${mo}-${d}`,
    time: `${hh}:${mm}`,
    minutes: Number(hh) * 60 + Number(mm),
  };
}

/**
 * BOUNDARIES INCLUSIVE AT THE CLOSE, EXCLUSIVE AT THE OPEN, and that asymmetry
 * is deliberate. A release timed for 16:00:00 is an after-close release in
 * every newsroom's usage; one timed for 09:30:00 is not a before-open release,
 * it is into the opening bell.
 */
export function timingFor(minutes: number): ReportTiming {
  if (minutes < OPEN_MINUTES) return "before-open";
  if (minutes >= CLOSE_MINUTES) return "after-close";
  return "during-market";
}

/** Every 2.02 item spelling EDGAR uses, so a filing is not missed on format. */
function hasResultsItem(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  // EDGAR writes items as a comma-separated list, sometimes with the prose
  // title attached: "2.02,9.01" or "Item 2.02 Results of Operations...".
  return raw.split(/[,;]/).some((part) => part.trim().replace(/^Item\s+/i, "").startsWith(RESULTS_ITEM));
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Every earnings announcement this filer's recent submissions can evidence,
 * newest first.
 *
 * `periodEnds` is the set of period ends the STORED FACT SET knows about, used
 * only by the 6-K rule. Passed in rather than fetched so this module stays pure
 * and the caller owns every read.
 */
export function reportEvents(
  subs: Submissions,
  periodEnds: ReadonlySet<string> = new Set()
): ReportEvent[] {
  const recent = subs?.filings?.recent;
  if (!recent) return [];
  const n = Array.isArray(recent.accessionNumber) ? recent.accessionNumber.length : 0;
  const out: ReportEvent[] = [];

  for (let i = 0; i < n; i++) {
    const form = str(recent.form?.[i]);
    if (!form) continue;
    const items = str(recent.items?.[i]);
    const isEightK = form === "8-K" || form === "8-K/A";
    const isSixK = form === "6-K" || form === "6-K/A";
    if (!isEightK && !isSixK) continue;

    const eventDate = str(recent.reportDate?.[i]);
    let basis: ReportEvent["basis"];
    if (isEightK) {
      if (!hasResultsItem(items)) continue;
      basis = "8-K item 2.02";
    } else {
      // THE POSITIONAL RULE, and it refuses rather than guesses. A 6-K carries
      // no item codes, so the only handle is its reported date landing on a
      // period this filer publishes figures for. NOTE the asymmetry with the
      // 8-K above: on a 6-K that date often IS the period end, which is why
      // this rule works at all and why the 8-K's identically-named field misled
      // me. See ReportEvent.eventDate.
      if (!eventDate || !periodEnds.has(eventDate)) continue;
      basis = "6-K near period end";
    }

    const accepted = parseAcceptanceEt(recent.acceptanceDateTime?.[i]);
    // NO ACCEPTANCE TIME, NO EVENT. Falling back to filingDate here is exactly
    // the substitution this module's header rejects: it is a different fact.
    if (!accepted) continue;

    // ── THE PERIOD IS MATCHED, NEVER READ OFF THE FILING ────────────────
    // The newest stored period end that had already ENDED when the filing was
    // accepted, within a window a results announcement can plausibly span.
    // Nothing outside that window is a match rather than a guess.
    let periodEnd: string | null = null;
    for (const end of periodEnds) {
      if (end > accepted.date) continue;
      const age = daysBetween(end, accepted.date);
      if (age > MAX_PERIOD_TO_ANNOUNCEMENT_DAYS) continue;
      if (!periodEnd || end > periodEnd) periodEnd = end;
    }

    out.push({
      eventDate,
      periodEnd,
      announcedOn: accepted.date,
      announcedAt: accepted.time,
      timing: timingFor(accepted.minutes),
      form,
      items,
      accession: str(recent.accessionNumber?.[i]) ?? "",
      basis,
    });
  }

  out.sort((a, b) => (a.announcedOn < b.announcedOn ? 1 : a.announcedOn > b.announcedOn ? -1 : 0));

  // ── ONE EVENT PER PERIOD, AND THE EARLIEST ONE ────────────────────────────
  //
  // A filer can file several qualifying documents for the SAME period: an
  // 8-K/A amending the original, a second 8-K carrying the transcript, or —
  // seen live on ABEV — the same 6-K indexed twice. The ORIGINAL announcement
  // is the one the market reacted to, so the earliest wins.
  //
  // THIS IS NOT COSMETIC, AND IT WAS LEAKING A BACKTEST. With duplicates in the
  // list, a leave-one-out prediction of the newest event kept a COPY of that
  // same event in its own training set, whose lag is by definition the lag
  // being predicted. The median was then pulled onto the answer and the
  // reported error collapsed toward zero — a number that measured the
  // duplication, not the method.
  // KEYED ON THE PERIOD WHERE THERE IS ONE, on the event date otherwise — an
  // announcement with no matched period is still one announcement, and two
  // index entries for it must still collapse to one.
  const byPeriod = new Map<string, ReportEvent>();
  const undated: ReportEvent[] = [];
  for (const e of out) {
    const key = e.periodEnd ?? e.eventDate;
    if (!key) { undated.push(e); continue; }
    const seen = byPeriod.get(key);
    if (!seen || e.announcedOn < seen.announcedOn) byPeriod.set(key, e);
  }
  const deduped = [...byPeriod.values(), ...undated];
  deduped.sort((a, b) => (a.announcedOn < b.announcedOn ? 1 : a.announcedOn > b.announcedOn ? -1 : 0));
  return deduped;
}

// ── THE NEXT REPORT DATE ───────────────────────────────────────────────────

const DAY = 86400000;
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/**
 * Statutory deadlines for the PERIODIC report covering a period, in days after
 * the period end. 17 CFR 240.13a-13 / 13a-1.
 *
 * THE DEADLINE IS FOR THE 10-Q OR 10-K, NOT FOR THE 8-K, and that is the point:
 * an earnings 8-K almost always precedes the periodic report, so the deadline
 * is an UPPER BOUND on a sane estimate rather than a prediction of it. It is
 * used to clamp, never to predict.
 */
export const FILING_DEADLINE_DAYS: Record<string, { quarter: number; annual: number }> = {
  "large accelerated filer": { quarter: 40, annual: 60 },
  "accelerated filer": { quarter: 40, annual: 75 },
  "non-accelerated filer": { quarter: 45, annual: 90 },
};
/** The slowest of the three. An unknown category must not tighten the clamp. */
export const DEADLINE_FALLBACK = { quarter: 45, annual: 90 };

export function deadlineDays(category: unknown, annual: boolean): number {
  const key = typeof category === "string" ? category.trim().toLowerCase() : "";
  const row = FILING_DEADLINE_DAYS[key] ?? DEADLINE_FALLBACK;
  return annual ? row.annual : row.quarter;
}

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * ── ONLY PROMISE A DATE WHERE THE FILER HAS EARNED ONE ────────────────────
 *
 * A median over four wildly different lags is still a number, and rendering it
 * as "expected 12 November" tells a reader something the data does not support.
 * So the estimate is a DISCRIMINATED RESULT and the page renders whichever
 * shape it gets, rather than a number plus a confidence nobody reads.
 */
export type NextReportEstimate =
  | {
      kind: "date";
      date: string;
      medianLagDays: number;
      /** max - min over the last four lags. The regularity that earned a date. */
      spreadDays: number;
      fromEvents: number;
      clamped: boolean;
      timing: ReportTiming | null;
      /** Which of the three produced it — C means the primary had no input. */
      estimator: EstimatorId;
    }
  | {
      kind: "month";
      /** YYYY-MM. The last four lags all land here, but not on one day. */
      month: string;
      spreadDays: number;
      fromEvents: number;
      timing: ReportTiming | null;
    }
  | { kind: "none"; reason: string };

/**
 * How far the last four lags may spread and still earn a specific date.
 *
 * SEVEN DAYS IS A WEEK OF WEEKDAY DRIFT and nothing more. A filer whose period
 * end moves across the week announces a few days earlier or later without
 * changing its habit; one that swings a fortnight has no habit to report.
 */
export const REGULAR_SPREAD_DAYS = 7;
/** Lags are judged over this many of the most recent events. */
export const REGULARITY_WINDOW = 4;

/**
 * Estimate the next announcement from THE FILER'S OWN HABIT, clamped.
 *
 * NOT A FORECAST AND LABELLED AS SUCH WHEREVER IT RENDERS. A median lag over
 * past quarters is a description of a pattern, and a filer is free to break it.
 * `fromEvents` travels with the number so a one-sample "median" cannot be
 * quoted as if it were a habit.
 */
/**
 * ── THREE ESTIMATORS, DECLARED BEFORE THEY WERE MEASURED ──────────────────
 *
 * The first attempt used C alone and lost to a one-line baseline. Rather than
 * tune until something won — which is how a method gets chosen by the noise in
 * one corpus — exactly three candidates were fixed in advance, compared on the
 * same symbols with the same corrected data, and the winner taken by lowest
 * MEAN absolute error with ties going to A as the simplest to explain.
 *
 *   A  this period end + LAST YEAR'S SAME-QUARTER LAG
 *   B  last year's same-quarter announcement + 364 days (preserves weekday)
 *   C  the filer's MEDIAN LAG over every prior announcement
 *
 * A and B differ in what they hold fixed: A holds the gap from period end, B
 * holds the calendar position. They disagree whenever the period end moves
 * relative to the week, which is exactly when a fixed lag drifts.
 */
export type EstimatorId = "A" | "B" | "C";

/** The year-ago announcement for the same fiscal quarter, or null. */
export function sameQuarterLastYear(
  events: readonly ReportEvent[],
  nextPeriodEnd: string
): ReportEvent | null {
  let best: ReportEvent | null = null;
  for (const e of events) {
    if (!e.periodEnd || e.basis !== "8-K item 2.02") continue;
    const gap = daysBetween(e.periodEnd, nextPeriodEnd);
    // A YEAR, GENEROUSLY: a 52/53-week calendar moves the anniversary by a
    // week either way, and a 4-4-5 year can be 371 days.
    if (gap < 330 || gap > 400) continue;
    if (!best || daysBetween(best.periodEnd!, nextPeriodEnd) > gap) best = e;
  }
  return best;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Run one named estimator. Null when it has no input for this filer. */
export function runEstimator(
  id: EstimatorId,
  events: readonly ReportEvent[],
  nextPeriodEnd: string
): string | null {
  const yearAgo = sameQuarterLastYear(events, nextPeriodEnd);
  if (id === "A") {
    if (!yearAgo) return null;
    return iso(Date.parse(nextPeriodEnd) + daysBetween(yearAgo.periodEnd!, yearAgo.announcedOn) * DAY);
  }
  if (id === "B") {
    if (!yearAgo) return null;
    // 364, NOT 365: fifty-two whole weeks, so the prediction lands on the same
    // weekday the filer used last year. A filer that always reports on a
    // Thursday keeps reporting on a Thursday.
    return iso(Date.parse(yearAgo.announcedOn) + 364 * DAY);
  }
  const lags = events
    .filter((e) => e.periodEnd && e.basis === "8-K item 2.02")
    .map((e) => daysBetween(e.periodEnd!, e.announcedOn))
    .filter((d) => d >= 0 && d <= 200);
  const lag = median(lags);
  return lag === null ? null : iso(Date.parse(nextPeriodEnd) + lag * DAY);
}

/**
 * THE PRIMARY, CHOSEN BY THE RULE AND NOT REVISITED.
 *
 * Set from the measured table (relay run recorded in the commit that changed
 * it). C remains the fallback for a filer with no same-quarter event a year
 * ago, which is the one case A and B cannot answer at all.
 */
export const PRIMARY_ESTIMATOR: EstimatorId = "A";
// MEASURED, relay run 35120730648, 44 SYMBOLS all three could answer:
//   A 1.98d mean · B 2.07d · C 3.27d      (claude/sec-report-dates-2026-09-16.md §4)
// B wins the exact-hit column (26 of 44 against A's 15) and loses the mean. The
// rule was fixed before the run and says MEAN, so A ships and the split is
// recorded rather than used to justify a different choice afterwards.

/**
 * Estimate the next announcement.
 *
 * ── THE CLAMP NEEDS A REAL PERIOD END ────────────────────────────────────
 * The statutory deadline is measured from the fiscal period end. `eventDate` is
 * the announcement, so clamping against it was nonsense in the first version —
 * a deadline measured from the thing being predicted. This takes
 * `nextPeriodEnd`, and the caller may only pass a MATCHED period; where none
 * matched there is no deadline to clamp to and no specific date to offer.
 */
export function estimateNextReport(
  events: readonly ReportEvent[],
  nextPeriodEnd: string | null,
  category: unknown,
  annual = false
): NextReportEstimate {
  // NO PERIOD END, NO DATE. Every one of the three estimators is arithmetic on
  // a period end, and the deadline that caps them is measured from one. Without
  // it there is nothing to add a lag to and nothing to clamp against, so the
  // honest output is silence — not a date computed from the announcement, which
  // is the conflation this whole module exists to keep out.
  if (!nextPeriodEnd) return { kind: "none", reason: "no matched fiscal period end" };
  const usable = events.filter((e) => e.periodEnd && e.basis === "8-K item 2.02");
  const lags = usable
    .map((e) => daysBetween(e.periodEnd!, e.announcedOn))
    .filter((d) => d >= 0 && d <= 200);
  if (lags.length < REGULARITY_WINDOW) {
    return { kind: "none", reason: `only ${lags.length} prior 8-K item 2.02 announcement(s)` };
  }

  const recent = lags.slice(0, REGULARITY_WINDOW);
  const spread = Math.max(...recent) - Math.min(...recent);

  const primary = runEstimator(PRIMARY_ESTIMATOR, usable, nextPeriodEnd);
  const predicted = primary ?? runEstimator("C", usable, nextPeriodEnd);
  if (!predicted) return { kind: "none", reason: "no usable prior announcement" };

  const cap = new Date(Date.parse(nextPeriodEnd) + deadlineDays(category, annual) * DAY);
  const clamped = Date.parse(predicted) > cap.getTime();

  const timings = usable.slice(0, REGULARITY_WINDOW).map((e) => e.timing);
  const timing = timings.length && timings.every((t) => t === timings[0]) ? timings[0] : null;

  if (spread <= REGULAR_SPREAD_DAYS) {
    return {
      kind: "date",
      date: clamped ? cap.toISOString().slice(0, 10) : predicted,
      medianLagDays: median(lags)!,
      spreadDays: spread,
      fromEvents: lags.length,
      clamped,
      timing,
      estimator: primary ? PRIMARY_ESTIMATOR : "C",
    };
  }

  const months = new Set(
    recent.map((d) => iso(Date.parse(nextPeriodEnd) + d * DAY).slice(0, 7))
  );
  if (months.size === 1) {
    return { kind: "month", month: [...months][0], spreadDays: spread, fromEvents: lags.length, timing };
  }
  return { kind: "none", reason: `last ${REGULARITY_WINDOW} lags spread ${spread} days across ${months.size} months` };
}

// ── WHICH SESSION THE MARKET REACTED IN ────────────────────────────────────

/**
 * The trading day whose close reflects the announcement.
 *
 * ── WHY THIS COLLAPSES THREE TIMINGS INTO TWO ─────────────────────────────
 * A release before the open and one at 11:00 are both digested by the SAME
 * day's close. Only an after-close release waits for the next session:
 *
 *   before-open   on D  ->  D
 *   during-market on D  ->  D
 *   after-close   on D  ->  D + 1 trading day
 *
 * AND THAT IS WHY A TIMING MISTAKE IS MOSTLY HARMLESS. The boundary this code
 * can plausibly get wrong is before-open vs during-market — a morning release
 * filed late, and the probe could not resolve how often that happens because
 * NONE of the sampled EX-99.1 exhibits stated a release time. That question is
 * openly unanswered. It does not need answering: both map to the same session.
 * The boundary that WOULD matter, after-close, is the one the timestamps are
 * least ambiguous about — nothing accepted at 20:30Z is a morning release.
 *
 * RETURNS A DATE, NOT AN INDEX. The caller owns the bar series and advances to
 * the next available bar, so a weekend or holiday filing lands on the next
 * session without this needing a market calendar it would only get wrong.
 */
export function reactionDate(event: Pick<ReportEvent, "announcedOn" | "timing">): string {
  if (event.timing !== "after-close") return event.announcedOn;
  return new Date(Date.parse(event.announcedOn) + DAY).toISOString().slice(0, 10);
}

/**
 * How the page describes the timing.
 *
 * IT DESCRIBES THE FILING, NOT THE ANNOUNCEMENT, and the distinction is not
 * pedantry: what this module observes is when a document reached EDGAR, which
 * is at or after the moment the company put the news out. "Reported after
 * close" claims to know the press release time; "filed with the SEC after
 * market close" claims only what the timestamp shows.
 */
export const TIMING_WORDING: Record<ReportTiming, string> = {
  "before-open": "Results filed with the SEC before market open",
  "during-market": "Results filed with the SEC during market hours",
  "after-close": "Results filed with the SEC after market close",
};

// ── THE PERIOD THE NEXT ANNOUNCEMENT WILL BE ABOUT ────────────────────────

/**
 * Derive the next fiscal period end from the filer's OWN cadence.
 *
 * ── WHY THIS IS NOT "TODAY PLUS NINETY" ──────────────────────────────────
 * A 4-4-5 filer's quarters end on a weekday that moves; a 52/53-week year adds
 * a week every five or six years; AAPL's September quarter is thirteen weeks
 * from the June one and not ninety-one days. The filer's own spacing carries
 * all of that, and nothing else available here does.
 *
 * QUARTERS IF THERE ARE ENOUGH OF THEM, ANNUAL OTHERWISE, never mixed: a set
 * holding both would otherwise produce a median spacing somewhere between a
 * quarter and a year, which describes no filer that exists.
 *
 * Returns null rather than guessing. Null is what `estimateNextReport` needs to
 * say nothing at all — and saying nothing is the correct output for a filer
 * whose stored history is too thin to show a cadence.
 */
export function nextPeriodEndFrom(
  quarterEnds: readonly string[],
  yearEnds: readonly string[]
): { end: string; annual: boolean; stepDays: number } | null {
  const pick = (ends: readonly string[]) => {
    const sorted = [...new Set(ends.filter(Boolean))].sort().reverse();
    if (sorted.length < 3) return null;
    const gaps: number[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) gaps.push(daysBetween(sorted[i + 1], sorted[i]));
    // A SPACING THAT IS NOT A REPORTING PERIOD is a gap in the stored history,
    // not a cadence. Bounded either side so a missing quarter cannot stretch
    // the median into something no filer uses.
    const step = median(gaps.filter((d) => d >= 60 && d <= 400));
    if (step === null) return null;
    return { newest: sorted[0], step };
  };
  const q = pick(quarterEnds);
  const chosen = q ?? pick(yearEnds);
  if (!chosen) return null;
  return {
    end: new Date(Date.parse(chosen.newest) + chosen.step * DAY).toISOString().slice(0, 10),
    annual: !q,
    stepDays: chosen.step,
  };
}

/**
 * The same period end, one year on.
 *
 * ── TWO KINDS OF FILER, AND +365 IS WRONG FOR BOTH SOMETIMES ─────────────
 * A calendar filer's quarter ends on the LAST DAY OF A MONTH: 30 September
 * this year, 30 September next, and +365 lands on the 30th only when no leap
 * day intervenes. A 52/53-week filer's quarter ends on a fixed WEEKDAY:
 * AAPL's June quarter ended 2026-06-27, and its successor is 2027-06-26 —
 * 364 days, fifty-two whole weeks, so the weekday is preserved.
 *
 * The two are told apart by the one thing that distinguishes them: whether the
 * date is its month's last day. Nothing else here can, and guessing wrong costs
 * a day or two on every estimate that rolls.
 */
export function periodAnniversary(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  if (d.getUTCDate() === lastDay) {
    const nextLast = new Date(Date.UTC(y + 1, mo + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y + 1, mo, nextLast)).toISOString().slice(0, 10);
  }
  return new Date(d.getTime() + 364 * DAY).toISOString().slice(0, 10);
}

/**
 * The next announcement that HAS NOT HAPPENED YET.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 * The first wiring rendered "Next expected earnings date: 2026-07-18" on a page
 * read in September. It was not a bad estimate — it was a correct estimate for
 * a quarter already reported. The stored fact set lags the filings by design:
 * companyfacts carries a period once it is FILED, so a filer that has announced
 * Q3 but not yet filed its 10-Q has a fact set ending at Q2, and one cadence
 * step past Q2 is a date in the past.
 *
 * A date in the past under the heading "next expected" is worse than no date.
 * Nothing about it fails, and a reader has no way to tell it from a date the
 * company missed.
 *
 * SO IT ROLLS FORWARD, one cadence step at a time, until the estimate lands on
 * or after `today` — and stops after a bounded number of steps rather than
 * looping, because an unbounded roll on a filer with a strange cadence is a
 * hang on a page render.
 *
 * `today` IS PASSED IN, never read from the clock here: this runs in the cron,
 * in the seeder and in checks, and a function that reads the clock cannot be
 * given a date to test against.
 */
export function estimateUpcoming(
  events: readonly ReportEvent[],
  cadence: { end: string; annual: boolean; stepDays: number } | null,
  category: unknown,
  today: string
): { estimate: NextReportEstimate; periodEnd: string | null } {
  if (!cadence) {
    return { estimate: estimateNextReport(events, null, category, false), periodEnd: null };
  }
  // NOT PAST TODAY ALONE. A filer that announced yesterday should be estimated
  // for its NEXT quarter, not shown yesterday's date as if it were upcoming.
  const floor = events[0]?.announcedOn && events[0].announcedOn > today ? events[0].announcedOn : today;
  // ── SNAPPED TO THE FILER'S OWN CALENDAR, NOT LEFT ON THE MEDIAN STEP ────
  // Stepping by the median spacing accumulates: two steps of 92 days from a
  // 31 March quarter end lands on 1 October, not 30 September, and the estimate
  // inherits every day of that drift. Where the same quarter a year earlier is
  // on file, its anniversary is the period end — exactly, by the filer's own
  // convention — so the stepped date is only used to FIND it.
  const snap = (end: string): string => {
    let best: string | null = null;
    for (const e of events) {
      if (!e.periodEnd) continue;
      const cand = periodAnniversary(e.periodEnd);
      const off = Math.abs(daysBetween(cand, end));
      if (off > 20) continue;
      if (!best || off < Math.abs(daysBetween(best, end))) best = cand;
    }
    return best ?? end;
  };
  let end = snap(cadence.end);
  let estimate = estimateNextReport(events, end, category, cadence.annual);
  for (let i = 0; i < 8; i++) {
    if (estimate.kind !== "date" || estimate.date >= floor) break;
    end = snap(new Date(Date.parse(end) + cadence.stepDays * DAY).toISOString().slice(0, 10));
    estimate = estimateNextReport(events, end, category, cadence.annual);
  }
  // A MONTH THAT HAS PASSED IS THE SAME MISTAKE IN A COARSER UNIT.
  if (estimate.kind === "month" && estimate.month < today.slice(0, 7)) {
    return { estimate: { kind: "none", reason: "the estimated month has already passed" }, periodEnd: end };
  }
  if (estimate.kind === "date" && estimate.date < floor) {
    return { estimate: { kind: "none", reason: "no upcoming date within eight periods" }, periodEnd: end };
  }
  return { estimate, periodEnd: end };
}

// ── LABELLING THE REACTION BARS ────────────────────────────────────────────

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * What a bar is called when its fiscal period is NOT known.
 *
 * ── WHY THIS IS NOT A QUARTER ────────────────────────────────────────────
 * The fallback path has an announcement date and nothing else, and a quarter
 * derived from one is a different quarter from the one being reported on. That
 * is what put "Q3 26" on a quarter that had not ended and the same "Q4 23" on
 * two different bars: an announcement names the quarter it FALLS IN, and two
 * announcements can fall in one. So it says only what it knows.
 */
export function reportedLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `Reported ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * One label per bar, in the page's own fiscal vocabulary, all distinct.
 *
 * ── THE THREE DEFECTS THIS REPLACES, ALL VISIBLE ON ONE PREVIEW ──────────
 *   AAPL's latest bar read "Q2 26" while the snapshot called the same filing
 *   Q3 FY2026 — two vocabularies for one filing on one page.
 *   AAP carried "Q4 23" TWICE, because two of its announcements fell in the
 *   same calendar quarter.
 *   AAP and ABEV showed "Q3 26" for a quarter that had not ended.
 *
 * All three come from labelling a bar by the calendar quarter of its
 * ANNOUNCEMENT. The fix is to take the label from the SAME stored period the
 * rest of the page reads, by the matched period end — and where there is no
 * matched period, to make no fiscal claim at all.
 *
 * `labelFor` is passed in rather than imported: the stored labels live in the
 * fact set, this module knows nothing about fact sets, and a second copy of the
 * labeller here is exactly the drift that produced two vocabularies.
 *
 * DISTINCTNESS IS ENFORCED, NOT ASSUMED. Matched periods are unique because
 * `reportEvents` keeps one event per period — but the fallback path has no such
 * guarantee, and two announcements in one month would collide. A collision
 * takes the day as well, because a chart with two bars named the same thing
 * cannot be read at all.
 */
export function reactionBarLabels(
  rows: readonly { periodEnd: string | null; announcedOn: string }[],
  labelFor: (periodEnd: string) => string | undefined
): string[] {
  const out = rows.map((r) =>
    (r.periodEnd ? labelFor(r.periodEnd) : undefined) ?? reportedLabel(r.announcedOn)
  );
  const seen = new Map<string, number>();
  for (const l of out) seen.set(l, (seen.get(l) ?? 0) + 1);
  return out.map((l, i) =>
    (seen.get(l) ?? 0) > 1 ? `${l} (${rows[i].announcedOn.slice(5).replace("-", "/")})` : l
  );
}
