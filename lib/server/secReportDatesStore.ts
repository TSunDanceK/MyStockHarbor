// WHEN THE COMPANY TOLD THE MARKET, STORED ONCE AND READ ON EVERY RENDER.
//
// ── WHY THIS IS A SEPARATE KEY FROM THE FACT SET ─────────────────────────
// The fact set comes from companyfacts and is positionally encoded against
// SEC_FIELD_KEYS — a fieldsHash mismatch discards the whole blob, deliberately,
// because a shifted array means every number means something else. Report dates
// come from a DIFFERENT endpoint (submissions), have no field order, and would
// be thrown away for free every time a financial field is added. They also
// change on a different schedule: an 8-K lands the day results are announced,
// companyfacts days later.
//
// So: its own key, its own write, its own absence. A symbol with facts and no
// dates renders its financials and says nothing about timing, which is the
// honest pairing — not a page that loses both because one endpoint moved.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { canWriteSecState, noteSecWriteBlocked } from "./secWriteGate";
import type {
  EarlyNonResultsPattern, NextReportEstimate, PendingResults, ReportEvent,
} from "./secReportDates";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/** Registered in symbolEviction.PER_SYMBOL_KEYS — see the note there. */
export const SEC_REPORT_DATES_PREFIX = "msh:sec:reportdates:v1";
export const reportDatesKey = (symbol: string) =>
  `${SEC_REPORT_DATES_PREFIX}:${symbol.toUpperCase()}`;

/**
 * HOW MANY EVENTS ARE KEPT.
 *
 * The page charts eight quarters and the estimator reads four lags plus the
 * same quarter a year ago, so twelve would do. Twenty is kept because the
 * BACKTEST is the thing that will want more of them, and because twenty events
 * is under a kilobyte — the read cost is the round trip, not the payload.
 */
export const STORED_EVENT_LIMIT = 20;

export type StoredReportDates = {
  symbol: string;
  cik: string;
  /** When the submissions feed was last read. ISO, for the freshness line. */
  at: string;
  /** Newest first. Only events whose period was MATCHED are stored. */
  events: ReportEvent[];
  /**
   * The period end the estimate is FOR — derived from the stored fact set's
   * own cadence, never from an announcement date. Null means no estimate.
   */
  nextPeriodEnd: string | null;
  next: NextReportEstimate;
  /**
   * A quarter the filer has ANNOUNCED that the stored figures do not contain.
   *
   * OPTIONAL, because records written before this exist and absent must mean
   * "not known", never "nothing pending" — the page renders no notice either
   * way, but a later reader must not be able to mistake one for the other.
   */
  pending?: PendingResults | null;
  /**
   * The filer's SEC category, verbatim from `submissions.category`.
   *
   * ── WHY THIS IS STORED RATHER THAN FETCHED ────────────────────────────
   * `secReportDates.deadlineDays(category, annual)` needs it, and the due
   * strip's overdue cap is the only thing that reads it. Before this field
   * existed, NOTHING persisted it — so a consumer had two options: fetch
   * data/sec/submissions per symbol at render time, or pass null and take
   * DEADLINE_FALLBACK.
   *
   * Neither was acceptable. A live fetch would put ~50 SEC round trips on a
   * page render, in a subsystem where everything else reads the store; and
   * null silently widens the cap, by 5 days on a quarter and by up to 30 on a
   * year (see `annual` below).
   *
   * IT COSTS NOTHING TO STORE. `subs.category` is already a live variable at
   * the writeReportDates() call site in app/api/jobs/sec-facts/route.ts — it is
   * passed to estimateUpcoming() on the line above and then discarded. No extra
   * request, no extra rate-limit exposure.
   *
   * ── MIGRATION, ON THE #484 TEMPLATE ───────────────────────────────────
   * OPTIONAL, and absent means NOT-YET-BACKFILLED — never "this filer has no
   * category". The same convention and the same reason as `pending?` above:
   * records written before the field existed are still valid records, and a
   * reader must not be able to mistake "we have not looked yet" for "we looked
   * and there is nothing". There is NO migration job and none is needed: the
   * sec-facts cron rewrites every record on its own rotation, so the field
   * fills in as that rotation comes round, exactly as #484's reconciliation
   * did. A consumer reading a record without it MUST fall back to
   * deadlineDays(null, …) rather than assuming a category.
   */
  category?: string | null;
  /**
   * Whether `nextPeriodEnd` is an ANNUAL period.
   *
   * ── NOT A DETAIL, AND THE SCOPING MISSED IT ───────────────────────────
   * deadlineDays takes BOTH arguments, and the annual cells are 60/75/90
   * against 40/45 for a quarter. The filer category is worth 5 days on a
   * quarter; getting THIS wrong is worth 15 to 45. It was not stored either,
   * and the question that asked for `category` did not raise it — measured and
   * recorded in claude/due-input-census-2026-09-22.md.
   *
   * SOURCE: `cadence.annual` from nextPeriodEndFrom(), which is also already in
   * hand at the write site. It is the correct pairing for the stored
   * `nextPeriodEnd`: estimateUpcoming() may roll the period forward up to eight
   * cadence steps, but it passes `cadence.annual` UNCHANGED on every iteration,
   * so the annual-ness of the period it returns never differs from the
   * cadence's.
   *
   * Same optionality and same migration as `category` above: absent means
   * not-yet-backfilled, never "quarterly".
   */
  annual?: boolean | null;
  /**
   * The filer's own history of an EARLY Item 2.02 that is not its results
   * (TSLA's delivery numbers), derived at write time from pairing each past
   * period's 2.02s against its 10-Q/10-K. Null: no such habit.
   *
   * STORED BECAUSE NOTHING ELSE CAN RECOVER IT. The pairing reads the
   * submissions feed, and a render has only this record; the events kept here
   * are the winners, so the losers that define the habit are gone from them.
   * It is the evidence the pending-results guard used, kept beside its output.
   *
   * Same optionality as `category`: absent means written before the pairing
   * existed, never "no pattern".
   */
  earlyNonResults?: EarlyNonResultsPattern | null;
  /**
   * THE FISCAL YEAR'S END, month and day ("01-31"), from the stored fact set's
   * newest annual period — so the 30-day band can keep the fiscal-year-end
   * quarter's lags apart from the other three (Q4_SPLIT, #535 COWORK #8). A
   * 10-K reports later than a 10-Q (KO: ~42 days against ~25), and one median
   * over both refused 115 regular filers.
   *
   * Optional: absent on records written before it, and on filers with no annual
   * period; readers then use one pool, exactly as before.
   */
  fye?: string | null;
};

/**
 * The latest results event, DERIVED from the stored record rather than copied
 * into the manifest beside it.
 *
 * ── WHY THIS IS A FUNCTION AND NOT THREE MANIFEST FIELDS ──────────────────
 * The v1 earnings-calendar build briefly added lastResultsDate,
 * lastResultsPeriod and lastResultsAccn to SecManifestEntry, arguing that one
 * field in the manifest beat "a parallel store". The manifest's own docblock
 * fifteen lines below already said the opposite, and it was right: this record
 * is the single home, and flattening its newest event into strings elsewhere
 * gives the page two homes for one value that can then disagree
 * (claude/traps/two-validators-for-one-value.md).
 *
 * Nothing is lost by deriving it -- every field those three carried is here,
 * and reading it costs the round trip the caller was already making.
 *
 * FIRST MATCHED EVENT, NOT events[0]. Events are stored newest first and the
 * writer keeps only period-matched ones, so the two are normally the same
 * event. `periodEnd` is nullable on the type, and a null one cannot answer
 * "which period did this report on" -- so it is skipped rather than returned
 * with a null period a caller would have to re-check.
 */
export function latestResults(
  rec: StoredReportDates | null,
): { announcedOn: string; periodEnd: string; accession: string; basis: ReportEvent["basis"] } | null {
  if (!rec || !Array.isArray(rec.events)) return null;
  for (const e of rec.events) {
    if (!e || typeof e.announcedOn !== "string" || typeof e.periodEnd !== "string") continue;
    if (!e.announcedOn || !e.periodEnd) continue;
    return { announcedOn: e.announcedOn, periodEnd: e.periodEnd, accession: e.accession, basis: e.basis };
  }
  return null;
}

/**
 * Has this record been written under the paired rule? The drain condition for
 * data/sec/report-dates-rewrite.json.
 *
 * THE KEY, NOT THE VALUE. Every write from the paired rule sets
 * `earlyNonResults` -- to the pattern for the 84 repeat filers and to NULL for
 * everyone else, the 125 one-off filers included -- and JSON keeps a null key
 * where it drops an undefined one. So presence is the marker and a null is a
 * finished record, not an unfinished one. Testing the value instead would
 * requeue every filer without a pattern on every run, forever.
 */
export function pairingRewriteDone(rec: StoredReportDates | null): boolean {
  return rec !== null && typeof rec === "object" && "earlyNonResults" in rec;
}

/**
 * One read, with "we could not read it" kept apart from "there is nothing".
 *
 * readReportDates below folds a failed GET into null, which is right for the
 * callers that only want the record, and wrong for a page that TELLS a reader
 * whether we have a filing record for a company: "we have no SEC filing record
 * for it yet" during a Redis outage is the failure-vs-absence confusion
 * dueStripState exists to prevent. The stock page and its earnings page read
 * through this, and symbolOutlook.outlookFromRead turns `ok: false` into the
 * same "unavailable" answer the search gives -- at no extra round trip, unlike
 * the universe probe getSymbolOutlook uses.
 */
export type ReportDatesRead = { ok: true; rec: StoredReportDates | null } | { ok: false };

export async function readReportDatesChecked(symbol: string): Promise<ReportDatesRead> {
  if (!redis) return { ok: false };
  try {
    const raw = await redis.get<StoredReportDates>(reportDatesKey(symbol));
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.events)) return { ok: true, rec: null };
    return { ok: true, rec: raw };
  } catch (err) {
    console.error("[sec-report-dates] read failed", symbol, err);
    return { ok: false };
  }
}

export async function readReportDates(symbol: string): Promise<StoredReportDates | null> {
  const got = await readReportDatesChecked(symbol);
  return got.ok ? got.rec : null;
}

export async function writeReportDates(rec: StoredReportDates): Promise<boolean> {
  if (!redis) return false;
  if (!canWriteSecState()) { noteSecWriteBlocked("writeReportDates"); return false; }
  try {
    await redis.set(reportDatesKey(rec.symbol), rec);
    return true;
  } catch (err) {
    console.error("[sec-report-dates] write failed", rec.symbol, err);
    return false;
  }
}
