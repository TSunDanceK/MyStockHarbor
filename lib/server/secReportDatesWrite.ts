// ONE REPORT-DATES RECORD, BUILT AND WRITTEN IN ONE PLACE.
//
// Two jobs write these records: the sec-facts cron (symbols whose fact set
// changed, and the first-time backfill) and the pairing rewrite
// (/api/jobs/sec-report-dates-rewrite). Both call this, so the record shape,
// the pairing and the pending-results guard cannot drift between them
// (claude/traps/two-validators-for-one-value.md). The write goes through
// writeReportDates, which is behind the production write gate.
import {
  resultsPairing, earlyNonResultsPattern, estimateUpcoming, nextPeriodEndFrom,
  latestResultsAnnouncement, pendingResults,
  type NextReportEstimate, type PendingResults, type ReportEvent, type Submissions,
} from "./secReportDates";
import { writeReportDates, STORED_EVENT_LIMIT } from "./secReportDatesStore";
import type { StoredFactSet } from "./secFactCodec";

export async function buildAndWriteReportDates(
  symbol: string,
  cik: string,
  set: Pick<StoredFactSet, "quarters" | "years">,
  subs: Submissions,
  todayIso: string,
): Promise<{ ok: boolean; events: ReportEvent[]; next: NextReportEstimate; pending: PendingResults | null }> {
  const quarterEnds = set.quarters.map((p) => p.e).filter(Boolean);
  const yearEnds = set.years.map((p) => p.e).filter(Boolean);
  // ONE PAIRING, TWO OUTPUTS: the events (each period's results 2.02,
  // chosen against its 10-Q/10-K) and the filer's own history of an
  // EARLY non-results 2.02, which is what keeps the current period --
  // no 10-Q yet -- from reading TSLA's delivery 8-K as its results.
  const pairing = resultsPairing(subs, new Set([...quarterEnds, ...yearEnds]));
  const events = pairing.events
    .filter((e) => e.periodEnd)
    .slice(0, STORED_EVENT_LIMIT);
  const earlyNonResults = earlyNonResultsPattern(pairing.periods);
  // ROLLED FORWARD PAST WHAT HAS ALREADY BEEN REPORTED. The fact set
  // lags the filings — companyfacts carries a period once it is FILED —
  // so one cadence step past its newest period can be a date in the
  // past, rendered under "next expected".
  const cadence = nextPeriodEndFrom(quarterEnds, yearEnds);
  const { estimate: next, periodEnd: nextEnd } = estimateUpcoming(
    events, cadence, subs.category, todayIso
  );
  // ── ANNOUNCED BUT NOT YET IN THE FEED ─────────────────────────────
  // Read from the SAME submissions payload already in hand, so this
  // costs nothing beyond the arithmetic. See pendingResults for why it
  // cannot come out of `events`.
  const pending = pendingResults(
    events, latestResultsAnnouncement(subs), cadence, todayIso, earlyNonResults
  );
  // ── category AND annual: ALREADY IN HAND, PREVIOUSLY DISCARDED ────
  // Both were live variables three lines up -- `subs.category` goes into
  // estimateUpcoming and `cadence.annual` decides which deadline column
  // it uses -- and both were then thrown away. The due strip's overdue
  // cap needs exactly these two, and nothing persisted them, so a
  // consumer had to choose between ~50 live SEC fetches per page render
  // and silently taking DEADLINE_FALLBACK.
  //
  // Storing them costs one field each and NO extra request. See the
  // migration note on StoredReportDates.category.
  //
  // `cadence?.annual ?? null` rather than `?? false`: a filer with too
  // thin a history for nextPeriodEndFrom to find a cadence has no
  // annual-ness to record, and writing `false` there would assert
  // "quarterly" about a filer we could not read. Absent means
  // not-yet-known, which is the whole point of the optionality.
  const ok = await writeReportDates({
    symbol, cik,
    at: new Date().toISOString(),
    events,
    nextPeriodEnd: nextEnd,
    next,
    pending,
    category: typeof subs.category === "string" ? subs.category : null,
    annual: cadence?.annual ?? null,
    earlyNonResults,
  });
  return { ok, events, next, pending };
}

/** The queue, pure: listed, not yet done, cut first. Pure, so the check can run it. */
export function rewriteQueue(
  listed: readonly string[],
  done: ReadonlySet<string>,
  cut: ReadonlySet<string>,
): string[] {
  return listed
    .filter((s) => !done.has(s))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => Number(cut.has(b.s)) - Number(cut.has(a.s)) || a.i - b.i)
    .map(({ s }) => s);
}


/**
 * The report-dates phase's queue, in the order the review set (2026-09-22):
 *
 *   1. FILED SINCE THE RECORD WAS WRITTEN -- the daily index saw an 8-K or 6-K
 *      newer than the symbol's reportDatesAt, or the symbol is queued for a
 *      re-read because of one (`eventQueued`, captured before the fact-set loop
 *      clears the flag). This is how MU leaves the due strip the day after it
 *      files: its fact set does not change until the 10-K.
 *   2. THE DUE-STRIP CUT, where the record is more than STALE_CUT_DAYS old or
 *      was never written. Not every run: a cut record only moves on an event
 *      (tier 1) or when its estimate rolls, and 50 of the 100 slots every day
 *      would starve tier 3.
 *   3. Everything else: symbols whose fact set changed this run, then the
 *      never-written backfill.
 *
 * Pure: the manifest entries, the run's changed list and the clock come in.
 */
export const STALE_CUT_DAYS = 7;

export function reportDatesQueue(args: {
  entries: Readonly<Record<string, { cik?: string | null; reportDatesAt?: number | null; lastEventFiled?: string | null }>>;
  eventQueued: ReadonlySet<string>;
  cut: readonly string[];
  changedThisRun: readonly string[];
  limit: number;
  now: number;
}): { queue: string[]; tier1: number; tier2: number; tier3: number } {
  const { entries, eventQueued, cut, changedThisRun, limit, now } = args;
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
  const has = (s: string) => Boolean(entries[s]?.cik);
  const tier1 = Object.keys(entries).filter((s) => {
    const e = entries[s];
    if (!e?.cik) return false;
    if (eventQueued.has(s)) return true;
    return Boolean(e.lastEventFiled) && (!e.reportDatesAt || (e.lastEventFiled as string) > ymd(e.reportDatesAt));
  }).sort();
  const tier2 = cut.filter((s) => {
    const at = entries[s]?.reportDatesAt;
    return has(s) && (!at || now - at > STALE_CUT_DAYS * 86_400_000);
  });
  const backfill = Object.keys(entries).filter((s) => has(s) && !entries[s].reportDatesAt).sort();
  const tier3 = [...changedThisRun.filter(has), ...backfill];
  const queue = [...new Set([...tier1, ...tier2, ...tier3])].slice(0, limit);
  return { queue, tier1: tier1.length, tier2: tier2.length, tier3: tier3.length };
}
