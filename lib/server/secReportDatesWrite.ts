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
  latestResultsAnnouncement, pairingPeriodEnds, pendingResults,
  type NextReportEstimate, type PendingResults, type ReportEvent, type Submissions,
} from "./secReportDates";
import { latestResults, writeReportDates, STORED_EVENT_LIMIT, type StoredReportDates } from "./secReportDatesStore";
import { recordResultsDays } from "./secResultsDays";
import { predecessorCikFor } from "./secSuccession";
import type { StoredFactSet } from "./secFactCodec";

/**
 * The record, built and NOT written. Pure (no network, no store, no clock --
 * `todayIso` and `nowIso` come in), so a check can feed it a submissions
 * history and read exactly what production would store.
 */
export function buildReportDatesRecord(
  symbol: string,
  cik: string,
  set: Pick<StoredFactSet, "quarters" | "years">,
  subs: Submissions,
  todayIso: string,
  nowIso: string,
): StoredReportDates {
  const quarterEnds = set.quarters.map((p) => p.e).filter(Boolean);
  const yearEnds = set.years.map((p) => p.e).filter(Boolean);
  // ONE PAIRING, TWO OUTPUTS: the events (each period's results 2.02,
  // chosen against its 10-Q/10-K) and the filer's own history of an
  // EARLY non-results 2.02, which is what keeps the current period --
  // no 10-Q yet -- from reading TSLA's delivery 8-K as its results.
  // MATCHED AGAINST THE FILER'S 10-Q/10-K PERIOD ENDS TOO (see
  // pairingPeriodEnds): the set lags its filings, and a 2.02 must not be
  // grouped into last quarter or dropped past the 120-day window.
  const pairing = resultsPairing(subs, pairingPeriodEnds(quarterEnds, yearEnds, subs));
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
  return {
    symbol, cik,
    at: nowIso,
    events,
    nextPeriodEnd: nextEnd,
    next,
    pending,
    category: typeof subs.category === "string" ? subs.category : null,
    annual: cadence?.annual ?? null,
    // "MM-DD" of the newest annual period end — see StoredReportDates.fye.
    fye: [...yearEnds].sort().at(-1)?.slice(5) ?? null,
    feedShort: feedIsShort(subs, todayIso),
    earlyNonResults,
  };
}

/**
 * HOW FAR BACK A FEED MUST REACH TO NOT COUNT AS SHORT: three years, i.e. the
 * twelve quarters the estimator's eight usable lags need with room to spare.
 */
export const FEED_SHORT_YEARS = 3;

/**
 * Was the filing list cut short (StoredReportDates.feedShort)? Older pages
 * exist AND `recent` reaches back less than FEED_SHORT_YEARS. KO has older
 * pages too, but its `recent` covers eight years, so it is not short.
 */
export function feedIsShort(subs: Submissions, todayIso: string): boolean {
  const files = subs.filings?.files;
  if (!Array.isArray(files) || files.length === 0) return false;
  const dates = (subs.filings?.recent?.filingDate ?? []).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!dates.length) return true;
  const earliest = dates.reduce((m, d) => (d < m ? d : m));
  const cutoff = `${Number(todayIso.slice(0, 4)) - FEED_SHORT_YEARS}${todayIso.slice(4, 10)}`;
  return earliest > cutoff;
}

/**
 * THE PREDECESSOR'S FILINGS, FOR A CITED SUCCESSOR (#552 COWORK #78, XOM).
 *
 * The successor CIK's own list starts at the reorganization (XOM: one results
 * 8-K since 2026-07-01), so its cadence is "too few periods" by construction.
 * The predecessor's list is the same company's history, cited in
 * data/sec/successor-ciks.json, exactly as withPredecessorFacts uses it for
 * the figures. APPENDED AFTER the successor's own rows: the pairing reads each
 * period's 2.02 against its 10-Q/10-K, and the successor's rows come first so
 * they win any overlap. One extra SEC request, for cited successors only; a
 * failed fetch keeps the successor's own list (the old behaviour).
 */
export function mergeSubmissions(own: Submissions, older: Submissions): Submissions {
  const a = own.filings?.recent ?? {};
  const b = older.filings?.recent ?? {};
  const n = (r: SubmissionsFilingsLike) => (Array.isArray(r.accessionNumber) ? r.accessionNumber.length : 0);
  const keys = ["accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "form", "items"] as const;
  const recent: Record<string, unknown[]> = {};
  for (const k of keys) {
    const pad = (r: SubmissionsFilingsLike) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : Array(n(r)).fill(null));
    recent[k] = [...pad(a), ...pad(b)];
  }
  return { ...own, filings: { ...own.filings, recent } };
}
type SubmissionsFilingsLike = NonNullable<NonNullable<Submissions["filings"]>["recent"]>;

export async function withPredecessorSubmissions(
  cik: string,
  subs: Submissions,
  fetchSubmissions: (cik: string) => Promise<Submissions>,
): Promise<Submissions> {
  const pred = predecessorCikFor(cik);
  if (!pred) return subs;
  try {
    return mergeSubmissions(subs, await fetchSubmissions(pred));
  } catch (err) {
    console.warn("[sec-report-dates] predecessor submissions failed", cik, String((err as Error)?.message ?? err));
    return subs;
  }
}

/**
 * DOES THE RECORD LAG THE FIGURES BESIDE IT? (#552 COWORK #78, KO.)
 *
 * KO's snapshot showed Q2 (filled from the 10-Q, filed 2026-07-29) while its
 * "Last reported" line said 2026-04-28: the record was last written on
 * 2026-09-23 under the older pairing, and nothing queues a record whose set
 * moved through the filing job rather than through sec-facts. Rebuilt when:
 *   - there is no record; or
 *   - it was written before the set it sits beside was built; or
 *   - its newest results event is for an OLDER period than the set's newest,
 *     and it is at least REBUILD_AFTER_MS old (a filer with no results 8-K for
 *     its newest quarter would otherwise be rebuilt on every nightly check).
 */
export const REBUILD_AFTER_MS = 20 * 60 * 60 * 1000;

export function reportDatesNeedRebuild(
  rec: StoredReportDates | null,
  set: Pick<StoredFactSet, "at" | "quarters" | "years">,
  nowMs: number,
): boolean {
  if (!rec) return true;
  const at = Date.parse(rec.at);
  if (!Number.isFinite(at) || at < set.at) return true;
  const newest = [...set.quarters, ...set.years].map((p) => p.e).filter(Boolean).sort().at(-1) ?? null;
  const last = latestResults(rec)?.periodEnd ?? null;
  return newest !== null && (last === null || last < newest) && nowMs - at >= REBUILD_AFTER_MS;
}

export async function buildAndWriteReportDates(
  symbol: string,
  cik: string,
  set: Pick<StoredFactSet, "quarters" | "years">,
  subs: Submissions,
  todayIso: string,
): Promise<{ ok: boolean; events: ReportEvent[]; next: NextReportEstimate; pending: PendingResults | null }> {
  const rec = buildReportDatesRecord(symbol, cik, set, subs, todayIso, new Date().toISOString());
  const ok = await writeReportDates(rec);
  // THE GRID'S DAY INDEX FOLLOWS THE RECORD (lib/server/secResultsDays.ts).
  if (ok) await recordResultsDays(symbol, rec);
  return { ok, events: rec.events, next: rec.next, pending: rec.pending ?? null };
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
  /** Slots held for the never-written backfill. Default 0 keeps the old order. */
  backfillSlice?: number;
}): { queue: string[]; tier1: number; tier2: number; tier3: number } {
  const { entries, eventQueued, cut, changedThisRun, limit, now, backfillSlice = 0 } = args;
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
  const has = (s: string) => Boolean(entries[s]?.cik);
  const onCut = new Set(cut);
  // TIER 1 IS ORDERED BY NEED, NEVER BY NAME. In earnings season an 8-K is
  // not only Item 2.02, so tier 1 can exceed the cap; alphabetical order would
  // cut MU, NVDA and TSLA every run. Due-strip members first (the strip is what
  // a reader sees), then the stalest record first, a never-written one staler
  // than any. Ties keep manifest order -- no sort key is a name.
  const age = (s: string) => entries[s]?.reportDatesAt ?? -Infinity;
  const tier1 = Object.keys(entries)
    .filter((s) => {
      const e = entries[s];
      if (!e?.cik) return false;
      if (eventQueued.has(s)) return true;
      return Boolean(e.lastEventFiled) && (!e.reportDatesAt || (e.lastEventFiled as string) > ymd(e.reportDatesAt));
    })
    .map((s, i) => ({ s, i }))
    .sort((a, b) =>
      Number(onCut.has(b.s)) - Number(onCut.has(a.s)) || age(a.s) - age(b.s) || a.i - b.i)
    .map(({ s }) => s);
  const tier2 = cut.filter((s) => {
    const at = entries[s]?.reportDatesAt;
    return has(s) && (!at || now - at > STALE_CUT_DAYS * 86_400_000);
  });
  const backfill = Object.keys(entries).filter((s) => has(s) && !entries[s].reportDatesAt);
  const tier3 = [...changedThisRun.filter(has), ...backfill];
  // THE NEVER-WRITTEN BACKFILL GETS ITS OWN SLICE (#535 COWORK #18 §3). In
  // season tiers 1-2 filled the run (64 + 33 of 100 on 2026-09-23) and the
  // backfill drained at ~3 a run: 101 filers with a 2.02 on EDGAR had no record
  // at all. Up to `backfillSlice` slots are held for it; unused slots go back.
  const ahead = [...new Set([...tier1, ...tier2, ...changedThisRun.filter(has)])];
  const held = Math.min(backfillSlice, backfill.filter((s) => !ahead.includes(s)).length);
  const queue = [...new Set([...ahead.slice(0, limit - held), ...backfill, ...ahead])].slice(0, limit);
  return { queue, tier1: tier1.length, tier2: tier2.length, tier3: tier3.length };
}

/**
 * Keep an event-queued symbol in tier 1 when this run did not write it.
 *
 * `eventQueued` is the Sep 20–22 "unconfirmed" re-reads, captured from
 * needsReverify before the fact-set loop clears that flag. A symbol the cap or
 * the budget left out would otherwise drop out of tier 1 for good. Stamping
 * lastEventFiled (today) keeps it there: lastEventFiled is then newer than its
 * reportDatesAt, which is the ordinary tier-1 test. Mutates the entries.
 */
export function carryEventQueued(
  entries: Record<string, { lastEventFiled?: string | null }>,
  eventQueued: ReadonlySet<string>,
  written: ReadonlySet<string>,
  todayYmd: string,
): string[] {
  const carried: string[] = [];
  for (const s of eventQueued) {
    const e = entries[s];
    if (!e || written.has(s)) continue;
    if (!e.lastEventFiled || e.lastEventFiled < todayYmd) e.lastEventFiled = todayYmd;
    carried.push(s);
  }
  return carried;
}
