// Which companies have a fiscal period that has ended and no results filing for
// it yet -- the "Due to report" strip.
//
// ── THIS IS NOT A FORECAST, AND THE DISTINCTION IS THE WHOLE DESIGN ────────
// Two routes to an actual forward calendar were measured and both failed:
//
//   cadence prediction from filing history   2 of 48 filers landed inside their
//                                            OWN p90 band +/-2 days
//   8-K scheduling announcements (7.01/8.01) 0 of 276 fell in the 14-28 day
//                                            band a calendar would need
//
// So this does not say when a company WILL report. It says a period has ended,
// nothing has been filed for it, and enough time has passed that a filing is
// plausible. Every one of those three is a present-tense fact about the public
// record. The copy has to match: "Results have not yet been filed", never
// "will report".
//
// ── THE RULE, AND THE MEASUREMENTS BEHIND EACH CONSTANT ────────────────────
// A symbol is due on day D when its period P has ended, no results filing for P
// is observed, and D >= P + medianLag(symbol) - k.
//
// k = 7 is a measurement, not a preference. Swept over 12 months across the
// full ~700-symbol analysis universe and then restricted to the top 50 by
// market cap, which is the cut that actually ships:
//
//   k=3   peak median 3.0   FN 5.3%
//   k=5   peak median 4.0   FN ~4%
//   k=7   peak median 5.5   peak max 21   FN 3.0%   dwell median 7d
//   k=10  larger list, FN gains flatten
//
// k=7 is where the false-negative rate stops improving materially and the list
// is still small enough to render whole. Peak max 21 is why the strip shows the
// nearest 8-10 with an expand rather than a fixed slice.
//
// medianLag is PER SYMBOL and causal -- computed only from filings known before
// the period ended. A universe-wide median is a different and worse rule: the
// spread across filers is the thing being exploited.

/** One symbol's outstanding period, as the manifest knows it. */
export type DueInput = {
  symbol: string;
  /** Fiscal period end with no observed results filing, YYYY-MM-DD. */
  periodEnd: string;
  /** This symbol's own median days from period end to results filing. */
  medianLagDays: number;
  /**
   * Large accelerated filers get 40 days to file the periodic report, everyone
   * else 45. Only the overdue cap reads this.
   */
  largeAccelerated: boolean;
};

export type DueEntry = {
  symbol: string;
  periodEnd: string;
  /** First day this symbol appears in the strip: periodEnd + medianLag - k. */
  dueFrom: string;
  /** The symbol's own median results date for this period. NOT a prediction of
   *  the actual date -- see the header. Used for ordering only. */
  expectedOn: string;
  /** Whole days from the period end to `today`. */
  daysOutstanding: number;
};

/** k. See the header for the sweep this comes from. */
export const DUE_LEAD_DAYS = 7;

/** Statutory deadlines for the periodic report, in days after the period end. */
export const DEADLINE_LARGE_ACCELERATED_DAYS = 40;
export const DEADLINE_OTHER_DAYS = 45;

/**
 * How far past the statutory deadline a symbol may stay in the strip.
 *
 * ── A SAFEGUARD THAT HAS NEVER FIRED. DO NOT "FIX" IT. ────────────────────
 * Measured inside the shipped cut -- top 50 by market cap, k=7, 12 months --
 * the overdue state occurred TWICE, for 4 symbol-days in total, and BOTH were
 * cleared by a real filing rather than by this cap. The cap clears 0 of 2.
 *
 * It exists for the case the measurement cannot contain: a company that stops
 * filing entirely, where nothing else ever removes it and it would sit in the
 * strip forever. There is deliberately NO UI for it -- no "Overdue" badge --
 * because a badge would advertise a state that occurs four days in a year and
 * would read as a judgement about the company rather than a fact about the
 * record.
 *
 * If this looks like dead code in a later audit: it is inert by design, and the
 * measurement above is why. Deleting it reinstates the unbounded case.
 */
export const OVERDUE_GRACE_DAYS = 30;

// ── NO ATTRIBUTION-HORIZON CLAUSE, AND HERE IS WHY NOT ────────────────────
// A first draft also refused anything past secResultsDate's MAX_ATTRIBUTION_DAYS
// (120), reasoning that the strip should not claim a period the attribution
// layer could never clear. It is unreachable: the widest the overdue cap allows
// is DEADLINE_OTHER_DAYS + OVERDUE_GRACE_DAYS = 75 days, well inside 120, so the
// clause could never fire and would have shipped as a branch no test can reach.
//
// The relationship is the real thing, so it is ASSERTED in
// scripts/check-due-to-report.mjs rather than expressed as a dead branch here.
// If OVERDUE_GRACE_DAYS ever grows past 75, that check fails and says so.

const DAY = 86_400_000;
const parse = (d: string): number => Date.parse(`${d}T00:00:00.000Z`);
const valid = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(parse(d));
const shift = (d: string, days: number): string =>
  new Date(parse(d) + days * DAY).toISOString().slice(0, 10);

/**
 * The strip's contents for a given day.
 *
 * Ordered by the symbol's own expected results date, EARLIEST FIRST, so the
 * strip's first entries are the ones that have been outstanding longest
 * relative to their own history. The brief asks for "the nearest 8-10 with
 * expand"; this is the ordering that slice is taken from, and it is an
 * interpretation of "nearest" rather than something measured -- flagging it,
 * because the alternative reading (soonest-expected first) is equally
 * defensible and produces a different strip.
 */
export function selectDue(inputs: DueInput[], today: string): DueEntry[] {
  if (!valid(today)) return [];
  const D = parse(today);
  const out: DueEntry[] = [];

  for (const it of inputs) {
    if (!valid(it.periodEnd)) continue;
    if (!Number.isFinite(it.medianLagDays) || it.medianLagDays < 0) continue;
    const P = parse(it.periodEnd);
    if (P > D) continue; // the period has not ended yet

    // ── NOT DUE YET ──────────────────────────────────────────────────────
    if (D < P + (it.medianLagDays - DUE_LEAD_DAYS) * DAY) continue;

    // ── THE OVERDUE CAP ──────────────────────────────────────────────────
    const deadline = it.largeAccelerated ? DEADLINE_LARGE_ACCELERATED_DAYS : DEADLINE_OTHER_DAYS;
    if (D > P + (deadline + OVERDUE_GRACE_DAYS) * DAY) continue;

    out.push({
      symbol: it.symbol,
      periodEnd: it.periodEnd,
      dueFrom: shift(it.periodEnd, it.medianLagDays - DUE_LEAD_DAYS),
      expectedOn: shift(it.periodEnd, it.medianLagDays),
      daysOutstanding: Math.round((D - P) / DAY),
    });
  }

  out.sort((a, b) => (a.expectedOn < b.expectedOn ? -1 : a.expectedOn > b.expectedOn ? 1 : a.symbol < b.symbol ? -1 : 1));
  return out;
}
