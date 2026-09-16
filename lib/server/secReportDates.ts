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
  /** The period the results cover, from the filing's own reportDate. */
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
 * `acceptanceDateTime` is serialised as `2026-07-31T16:31:22.000Z`. THE Z IS A
 * LIE: EDGAR stamps acceptance in US Eastern and the serializer appends Z
 * anyway. Reading it as UTC shifts every timestamp back four or five hours,
 * which does not fail — it silently reclassifies a 16:31 after-close release as
 * a 12:31 during-market one, for every filer, forever.
 *
 * MEASURED rather than assumed: scripts/sec-report-dates-probe.mjs classifies a
 * panel of filers whose habit is public knowledge under BOTH readings and
 * reports which one puts them in the right bucket. This function implements the
 * reading that measurement supports, and the probe is the evidence.
 *
 * So the string is parsed as WALL TIME — the digits are taken at face value in
 * Eastern — and no timezone conversion is applied.
 */
export function parseAcceptanceEt(raw: unknown): { date: string; time: string; minutes: number } | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return null;
  return {
    date: m[1],
    time: `${m[2]}:${m[3]}`,
    minutes: hh * 60 + mm,
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

    const reportDate = str(recent.reportDate?.[i]);
    let basis: ReportEvent["basis"];
    if (isEightK) {
      if (!hasResultsItem(items)) continue;
      basis = "8-K item 2.02";
    } else {
      // THE POSITIONAL RULE, and it refuses rather than guesses: a 6-K with no
      // reportDate, or one whose reportDate is not a period this filer reports
      // figures for, is not evidence of an earnings announcement.
      if (!reportDate || !periodEnds.has(reportDate)) continue;
      basis = "6-K near period end";
    }

    const accepted = parseAcceptanceEt(recent.acceptanceDateTime?.[i]);
    // NO ACCEPTANCE TIME, NO EVENT. Falling back to filingDate here is exactly
    // the substitution this module's header rejects: it is a different fact.
    if (!accepted) continue;

    out.push({
      periodEnd: reportDate,
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
  return out;
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

export type NextReportEstimate = {
  /** YYYY-MM-DD. */
  date: string;
  /** Days from period end to announcement, this filer's own median. */
  medianLagDays: number;
  /** How many past announcements the median came from. */
  fromEvents: number;
  /** True when the statutory deadline pulled the estimate earlier. */
  clamped: boolean;
  /** The filer's habitual timing, when its past filings agree. */
  timing: ReportTiming | null;
};

/**
 * Estimate the next announcement from THE FILER'S OWN HABIT, clamped.
 *
 * NOT A FORECAST AND LABELLED AS SUCH WHEREVER IT RENDERS. A median lag over
 * past quarters is a description of a pattern, and a filer is free to break it.
 * `fromEvents` travels with the number so a one-sample "median" cannot be
 * quoted as if it were a habit.
 */
export function estimateNextReport(
  events: readonly ReportEvent[],
  nextPeriodEnd: string,
  category: unknown,
  annual = false
): NextReportEstimate | null {
  const lags = events
    .filter((e) => e.periodEnd)
    .map((e) => daysBetween(e.periodEnd!, e.announcedOn))
    // A NEGATIVE OR ABSURD LAG IS BAD DATA, NOT A HABIT. An 8-K reporting a
    // period before it ended, or a year after, would drag the median silently.
    .filter((d) => d >= 0 && d <= 200);
  const lag = median(lags);
  if (lag === null) return null;

  const raw = new Date(Date.parse(nextPeriodEnd) + lag * DAY);
  const cap = new Date(Date.parse(nextPeriodEnd) + deadlineDays(category, annual) * DAY);
  const clamped = raw.getTime() > cap.getTime();

  // THE FILER'S HABITUAL TIMING, only when its recent filings AGREE. A filer
  // that has moved between before-open and after-close has no habit to report,
  // and inventing one is worse than saying nothing.
  const recent = events.slice(0, 4).map((e) => e.timing);
  const timing = recent.length && recent.every((t) => t === recent[0]) ? recent[0] : null;

  return {
    date: (clamped ? cap : raw).toISOString().slice(0, 10),
    medianLagDays: lag,
    fromEvents: lags.length,
    clamped,
    timing,
  };
}
