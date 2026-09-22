// One symbol, one honest answer to "when does this report next".
//
// ── WHAT THIS REPLACES, AND WHY IT WAS THE URGENT ONE ─────────────────────
// The ticker search on /earnings-calendar rendered
//
//     NVDA next reports on Nov 18, 2026.
//
// from FMP's earnings calendar, through /api/stock-earnings/[symbol] ->
// lib/latest-earnings-data.ts's `nextEarningsDate`. No hedge, no method, no
// "estimated" -- the most confident sentence on a page whose entire spine is
// "this is the filed record, not a forecast". Two measurements in this repo
// say a specific day cannot be supported: cadence prediction put 2 of 48 filers
// inside their own p90 band, and 8-K scheduling announcements put 0 of 276
// inside the band a calendar needs (lib/server/dueToReport.ts's header).
//
// So the day goes and the band arrives. This module answers from the same
// estimator the section below the grid uses, at the same bars, in the same
// words -- one claim with one home, made to one symbol at a time.
//
// ── IT ANSWERS FOUR WAYS, AND THE FIRST IS NOT AN ESTIMATE AT ALL ─────────
//   due            the period has ended with nothing filed. A fact about the
//                  record, so it OUTRANKS the estimate and carries no hedge.
//   expected       an estimate that clears this filer's bar, as a 30-day band.
//   beyond-window  an estimate that clears the bar and lands past 30 days.
//   no-estimate    a named refusal. NOT a shrug: the reason says whose gap it
//                  is, ours or the filer's.
//
// ── THE SEARCH IS NOT LIMITED TO THE TOP-50 CUT ───────────────────────────
// data/due-strip.json's cut exists because the two sections render a LIST and a
// list needs a ranked, bounded population. A search has a population of one,
// chosen by the reader, so this reads the store by symbol and the cut plays no
// part. A symbol the cron has never reached answers "no-record", which is the
// correct answer and a different one from "unavailable".
import { readPickersSymbolsIfCached } from "./pickersBuilder";
import { readReportDates, type StoredReportDates } from "./secReportDatesStore";
import { dueInputFrom } from "./dueInputs";
import { selectDue } from "./dueToReport";
import { dueRowLabel } from "./dueStripState";
import { expectedFrom, type ExpectedBandId } from "./expectedToReport";
import {
  OUTLOOK_HEDGE, OUTLOOK_UNAVAILABLE, outlookBandLabel, outlookBeyondWindowLabel,
  outlookNoEstimateLabel, outlookReasonLabel, habitLabel, lastReportedLabel,
} from "./expectedCopy";

export type OutlookKind = "due" | "expected" | "beyond-window" | "no-estimate" | "unavailable";

/** The named reason behind "no-estimate". Reported, never rendered raw. */
export type OutlookReason =
  "no-record" | "no-period-end" | "thin-history" | "below-precision-bar" | "estimate-in-past";

/**
 * EXACTLY WHAT THE READER SEES, COMPOSED SERVER-SIDE.
 *
 * The route hands back finished sentences rather than a band id and a day
 * count. Two reasons, and the second is the real one:
 *
 *  1. The copy stays in lib/server beside the section's, so a client component
 *     cannot paraphrase a measured band into a promise.
 *  2. A check can assert on the exact bytes a reader gets, instead of on a
 *     shape that a component is then trusted to render honestly. "No date-like
 *     string appears anywhere in the estimated answer" is a property of THIS
 *     object, and it is checked on this object.
 *
 * `band` and `daysAway` travel too, for the check and for any future consumer,
 * and NOTHING in `headline`/`hedge` is derived from `daysAway` past the band.
 */
export type SymbolOutlook = {
  symbol: string;
  kind: OutlookKind;
  /** The one sentence. */
  headline: string;
  /**
   * The line under it. Null ONLY when the headline is not an estimate at all
   * -- the filed-record "due" answer and the "we are broken" one. Every
   * estimated headline carries a hedge, and a check asserts that pairing
   * rather than trusting it.
   */
  hedge: string | null;
  /** Dated, filed, or sample-sized supporting lines. Never a predicted date. */
  evidence: string[];
  /** Present on "no-estimate" only. */
  reason?: OutlookReason;
  /** Present on "expected" only. */
  band?: ExpectedBandId;
};

/**
 * The record to the answer. PURE, so every branch is reachable from a fixture
 * and none of them needs Redis to test -- same split dueInputFrom draws, for
 * the same reason.
 *
 * ORDER IS THE RULE, NOT AN IMPLEMENTATION DETAIL. The due check runs first
 * because a filed-record fact outranks an estimate about the same company: a
 * filer whose period ended three weeks ago with nothing filed is "outstanding",
 * not "expected in about 5 days", even though the estimator would happily say
 * the latter. This is the same precedence getCalendarForwardSections applies
 * between the two sections, made once more in one place.
 */
export function outlookFrom(
  symbol: string,
  rec: StoredReportDates | null,
  today: string,
): SymbolOutlook {
  const dueInput = dueInputFrom(symbol, rec);
  if ("input" in dueInput) {
    const [entry] = selectDue([dueInput.input], today);
    if (entry) {
      const last = lastFiled(rec);
      return {
        symbol, kind: "due",
        // BYTE-IDENTICAL to the strip's own row label. The search and the strip
        // describe the same state of the same record; writing a second sentence
        // for it here is how the two start disagreeing.
        headline: dueRowLabel(entry),
        hedge: null,
        evidence: last ? [last] : [],
      };
    }
  }

  // The empty set is not an oversight: `alreadyDue` exists to stop the SECTION
  // double-listing a symbol the STRIP already shows, and there is no list here
  // to collide with. The due case above is this module's version of that
  // precedence, and it has already been taken.
  const got = expectedFrom(symbol, rec, today, new Set());

  if ("row" in got) {
    const row = got.row;
    return {
      symbol, kind: "expected", band: row.band,
      headline: outlookBandLabel(symbol, row.band),
      hedge: OUTLOOK_HEDGE,
      evidence: evidenceFor(row.medianLagDays, row.fromPeriods, row.periodEnd, rec),
    };
  }

  if (got.skip === "beyond-window") {
    const lag = medianLagOf(rec);
    return {
      symbol, kind: "beyond-window",
      headline: outlookBeyondWindowLabel(symbol),
      hedge: OUTLOOK_HEDGE,
      evidence: lag ? evidenceFor(lag.medianLagDays, lag.fromPeriods, null, rec) : compact([lastFiled(rec)]),
    };
  }

  // "already-due" cannot reach here -- the due branch above consumes it, and it
  // is only ever produced by a non-empty `alreadyDue` set, which this call does
  // not pass. It is mapped rather than thrown so a later change to expectedFrom
  // degrades into a named refusal instead of a crash.
  const reason: OutlookReason = got.skip === "already-due" ? "estimate-in-past" : got.skip;
  return {
    symbol, kind: "no-estimate", reason,
    headline: outlookNoEstimateLabel(symbol),
    hedge: outlookReasonLabel(reason),
    evidence: compact([lastFiled(rec)]),
  };
}

const compact = (xs: (string | null)[]): string[] => xs.filter((x): x is string => Boolean(x));

/** The last results filing on record, as a line. A dated public document. */
function lastFiled(rec: StoredReportDates | null): string | null {
  const events = rec?.events;
  if (!Array.isArray(events)) return null;
  for (const e of events) {
    if (e && typeof e.announcedOn === "string" && e.announcedOn) {
      return lastReportedLabel(e.announcedOn, typeof e.periodEnd === "string" ? e.periodEnd : null);
    }
  }
  return null;
}

/** This filer's own habit, when the store carries a dated estimate for it. */
function medianLagOf(rec: StoredReportDates | null): { medianLagDays: number; fromPeriods: number } | null {
  const events = Array.isArray(rec?.events) ? rec.events : [];
  if (rec?.next?.kind !== "date" || !Number.isFinite(rec.next.medianLagDays)) return null;
  return { medianLagDays: rec.next.medianLagDays, fromPeriods: events.length };
}

function evidenceFor(
  medianLagDays: number,
  fromPeriods: number,
  periodEnd: string | null,
  rec: StoredReportDates | null,
): string[] {
  return compact([
    habitLabel(medianLagDays, fromPeriods),
    periodEnd ? `For the period ending ${periodEnd}` : null,
    lastFiled(rec),
  ]);
}

/**
 * The live answer for one symbol.
 *
 * ── THE HEALTH PROBE IS NOT OPTIONAL ──────────────────────────────────────
 * readReportDates returns null for a missing record AND for a failed GET, so
 * "we have never read NVDA" and "Redis is down" arrive identically. Telling a
 * reader we have no filing record for NVDA during an outage is precisely the
 * failure-vs-absence confusion dueStripState was built to prevent, so the
 * analysis-universe key is read alongside as the one signal that fails
 * distinguishably -- the same probe, for the same reason, as
 * getCalendarForwardSections.
 *
 * Both reads are issued together: when the store is healthy this costs one
 * round trip, not two in series.
 */
export async function getSymbolOutlook(symbol: string, today: string): Promise<SymbolOutlook> {
  const [universe, rec] = await Promise.all([
    readPickersSymbolsIfCached(),
    readReportDates(symbol),
  ]);
  if (!Array.isArray(universe) || !universe.length) {
    return {
      symbol, kind: "unavailable",
      headline: OUTLOOK_UNAVAILABLE,
      hedge: null,
      evidence: [],
    };
  }
  return outlookFrom(symbol, rec, today);
}
