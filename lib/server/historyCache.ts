import { Redis } from "@upstash/redis";
import { markRefreshed } from "./stalenessQueue";
import { fmpFetch } from "./fmpUsage";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { timingCache, beginTiming } from "./timing";
import {
  mergeDailyPoints,
  overlapVerdict,
  shiftIsoDate,
  toIsoUtcDate,
} from "./historyMerge";

export type Point = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type HistoryCacheEntry = {
  symbol: string;
  status: "qualified" | "non_qualified";
  checkedAt: number;
  source: "fmp";
  daily?: Point[];
  /**
   * How many bars the parser actually produced, BEFORE the qualification
   * threshold. Recorded so the success/failure TTL split on a `non_qualified`
   * entry is inspectable in Redis rather than being a decision that leaves no
   * trace: 0 means the response was empty (failure, 15 min), 1..29 means a real
   * but short history (success, full TTL).
   */
  parsedRows?: number;
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const REDIS_HISTORY_PREFIX = "msh:history:v7";
// ORDERING CONSTRAINT FOR WHOEVER RAISES THIS. Points already in Redis carrying
// a close of 0 -- written before the typeof allowlist in toFiniteNumber landed
// -- stay until their TTL expires. At 6h that self-heals within a day and needs
// no action. At 24h it does not: the blast radius of every stale zero bar
// becomes four times longer.
//
// So the order is load-bearing. Before raising this value: the parser fix must
// be LIVE, and the history namespace must be CLEAR of entries written before it.
//
// ANSWERED 2026-08-22, MEASURED NOT REASONED (scripts/check-history-ttl.mjs).
// The question was whether the weekend extension below applies to writes made
// DURING the weekend or only to the Friday-after-close write. It applies to
// weekend writes too: getRedisHistoryTtlSeconds() is called with no argument at
// the write site, so it reads the moment of the WRITE, and a Friday-evening,
// Saturday or Sunday write all land on the same next-Monday-open expiry.
//
// CONSEQUENCE: no manual flush is needed. Every entry written after Friday's
// close -- including anything written by the old parser before #349 deployed on
// Saturday -- expires together at the Monday open (13:30 UTC in summer) and is
// refetched through the fixed parser. Raise this value any time after that and
// the namespace is already clean.
//
// The 30-minute margin the original plan assumed was wrong in the other
// direction, and it is worth knowing why: the Monday open was being computed an
// hour LATE, because getNextMondayOpenUtcMsFromEastern hardcoded the winter
// offset. Fixed in the same change; see the note there.
const REDIS_HISTORY_TTL_SECONDS = 50 * 60 * 60;

// SAFE TO RAISE FROM 6h AS OF THIS CHANGE, and the reason is that a TTL is
// stamped at WRITE time and cannot be extended retroactively. Entries written by
// the pre-#349 parser already carry their own 6h (weekday) or next-Monday-open
// (Friday-close/weekend) expiry; raising this constant does not touch them. Only
// writes made after this deploys get 50h, and those go through the fixed parser.
// So the flush described above still completes on its own schedule.
//
// WHY 50 AND NOT 26. 26h was the figure in the measurement doc, chosen when the
// TTL was still doing the scheduling. With a forced 07:00 refetch the TTL is
// only the failure margin, and 50h (Monday 07:00 -> Wednesday 09:00) means ONE
// failed warm leaves Monday's bars serving Tuesday's session instead of leaving
// the cache empty at Tuesday's open. Emptying the cache is not how a failure
// becomes visible -- the warn below and the job-run record are. A stale-but-
// present cache degrades a page; an empty one refetches ~700 symbols mid-session.
//
// MEASURED IN PRODUCTION 2026-08-24, the first forced 07:00 warm. Both of the
// assumptions this whole design rested on are now facts rather than reasoning,
// so they are recorded here rather than only in a conversation:
//
//   1. NO TODAY-DATED STUB EXISTS BEFORE THE OPEN. At 07:00 UK with the market
//      shut, historyNewestBarSeen across the whole 700-symbol universe was
//      2026-08-21 -- Friday's bar. FMP returns no partial bar for the current
//      day ahead of the session, so fetching while the market is closed cannot
//      cache a stub that then freezes as a false close. That was the open
//      question behind "07:00 while closed", and it is answered from our own
//      instrumentation rather than from the probe.
//
//   2. THE ZERO-BAR BUG WAS LATENT, NOT ACTIVE. 831,564 rows parsed, ZERO
//      dropped for a null or blank close. #349's coercion guard is insurance
//      against a payload shape FMP has never actually sent, not a repair of
//      damage already in the cache -- so no namespace flush was ever needed.
//      This is the reading the counter was built for: 0 out of 0 rows says
//      nothing, 0 out of 831k says the bug never fired.
//
// THIS VALUE IS THE SUCCESS PATH ONLY. See HISTORY_FAILURE_TTL_SECONDS.

// The failure floor. DELIBERATELY NOT DERIVED FROM THE SUCCESS TTL, and it must
// stay that way: a 50h failure TTL would mean one bad fetch removes a symbol
// from every picker page until the day after tomorrow. 15 minutes is long enough
// that a genuine FMP outage is not retried on every render, and short enough
// that a transient failure clears well inside one session. Same shape as #337's
// profile empty-marker: a defer marker, not a cache entry.
const HISTORY_FAILURE_TTL_SECONDS = 15 * 60;

// A `non_qualified` entry means "fewer than MIN_QUALIFIED_POINTS usable bars".
// That covers two genuinely different things and they want different TTLs:
//
//   - ZERO parsed rows: almost always a bad response, not a real fact about the
//     symbol. Treated as a FAILURE -> 15 minutes.
//   - 1..29 parsed rows: a real, short history (a recent IPO). Treated as a
//     SUCCESS -> the full TTL. Refetching a genuine 12-bar IPO every 15 minutes
//     would be 96 calls/day/symbol to re-learn a fact that has not changed.
//
// Without this split the failure floor would turn every legitimately short
// history into a permanent 15-minute refetch loop.
const MIN_QUALIFIED_POINTS = 30;

// The FMP "full" history endpoint is bounded to ~5 years of daily bars on
// this account's plan (roughly 1,250-1,260 trading days) regardless of what
// this app asks for -- confirmed against the actual plan, not assumed. This
// trim is a defensive ceiling in case that ever changes (a plan upgrade, or
// FMP altering the endpoint's behavior), set comfortably above the real
// 5-year window rather than at the old 5500-day (~21 year) value, which
// never actually fired and just meant every cached entry -- and therefore
// every Redis pull of it, including the bulk multi-symbol reads in
// getDailyHistoryBulk -- carried no real ceiling on its size. Also see
// app/api/history/route.ts's `days` clamp (currently 5000), the largest
// single-symbol consumer -- that clamp is about how much of the cached
// history a request is allowed to ask for, not how much gets cached.
const MAX_CACHED_HISTORY_DAYS = 1400;

// Keys per MGET when reading history in bulk.
//
// NOT ONE UNBOUNDED MGET. A history entry can carry MAX_CACHED_HISTORY_DAYS
// bars, so the whole universe in a single reply would breach Upstash's 10MB
// per-response ceiling -- the pipeline this replaces was written that way for
// exactly that reason, and it was right about the constraint. It was only wrong
// that a pipeline is the answer: a pipeline of 700 GETs is 700 billed commands,
// where 18 chunked MGETs are 18. Same 40 as pickerChartsCache, same reason.
const HISTORY_MGET_CHUNK = 40;

function chunkHistoryKeys<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const HISTORY_LOCK_PREFIX = "msh:history-lock:v1";
const HISTORY_LOCK_TTL_SECONDS = 45;

const FMP_CALL_COUNTER_PREFIX = "msh:fmp-calls:v1";
/**
 * THE PLAN'S CEILING. A fact about the FMP subscription, not a tuning knob --
 * recorded separately from the working limit below so that lowering our own
 * headroom cannot quietly erase what the plan actually allows.
 */
const FMP_PLAN_CALLS_PER_MINUTE = 300;

/**
 * THE WORKING LIMIT, deliberately under the ceiling.
 *
 * It was 300 -- the ceiling exactly -- which leaves no room for the ways real
 * traffic drifts across a minute boundary: the counter is bucketed per UTC
 * minute, so a burst straddling :59/:00 is two buckets to us and one rolling
 * window to FMP. The 07:02 warm fired ~600 history calls inside one minute and
 * lost 21% to http-429, which is what running at exactly the ceiling looks
 * like.
 *
 * 200 leaves a third of the plan as headroom for the calls this counter does
 * not see -- and until this change, quotes were all of them.
 */
const FMP_SAFE_CALLS_PER_MINUTE = 200;
const FMP_WAIT_STEP_MS = 400;
// Ceiling on the exponential backoff below. A waiter still notices a freed slot
// within ~1.6s, but a full FMP_MAX_WAIT_MS wait now costs ~6 polls instead of 50.
const FMP_WAIT_STEP_MAX_MS = 1_600;
const FMP_MAX_WAIT_MS = 20_000;

type FmpHistoricalRow = {
  date?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
};

type FmpHistoricalResponse = FmpHistoricalRow[] | { Error?: string };

/**
 * A history fetch failure that knows WHY it failed.
 *
 * CLASSIFIED AT THE THROW SITE, NOT BY MATCHING THE MESSAGE LATER. The reason is
 * known exactly where the throw happens and nowhere else; recovering it
 * downstream would mean regexing error strings, which breaks silently the first
 * time someone rewords one -- and this repo has a trap doc about exactly that
 * class of read (claude/traps/grep-finds-the-comment-not-the-code.md, same
 * shape: matching prose instead of structure).
 *
 * WHY IT IS WORTH A CLASS. The first live forced warm produced 20 refetch
 * failures out of 700 and the count alone could not say what they were. A
 * capacity timeout wants FMP_MAX_WAIT_MS raised; an http-429 wants the opposite
 * (slow down); a scatter of network errors wants nothing at all except the
 * knowledge that twenty is the background rate. Those are three different
 * conclusions from one number, and "is it the same twenty tomorrow" cannot
 * separate them -- transient network failure also produces a different twenty
 * every morning.
 */
export type FmpFailureReason =
  | "capacity-timeout"
  | "no-api-key"
  | "fmp-error"
  | "network"
  | "parse"
  | "other"
  | `http-${number}`;

export class FmpHistoryError extends Error {
  readonly reason: FmpFailureReason;

  constructor(message: string, reason: FmpFailureReason) {
    super(message);
    this.name = "FmpHistoryError";
    this.reason = reason;
  }
}

/**
 * Reason for an error that did NOT come from one of our own throw sites.
 *
 * Only two shapes reach here in practice and both are worth separating from
 * "other": undici raises a TypeError for a failed connection, and Response.json
 * raises a SyntaxError for a body that is not JSON (an HTML error page from a
 * proxy, most often). Anything else is genuinely unclassified and says so
 * rather than being folded into a neighbouring bucket.
 */
export function classifyFmpFailure(error: unknown): FmpFailureReason {
  if (error instanceof FmpHistoryError) return error.reason;
  if (error instanceof SyntaxError) return "parse";
  if (error instanceof TypeError) return "network";
  return "other";
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function getEasternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return { weekday, year, month, day, hour, minute };
}

function getNextMondayOpenUtcMsFromEastern(date = new Date()) {
  const { weekday, year, month, day } = getEasternParts(date);

  const weekdayIndex =
    weekday === "Sun"
      ? 0
      : weekday === "Mon"
        ? 1
        : weekday === "Tue"
          ? 2
          : weekday === "Wed"
            ? 3
            : weekday === "Thu"
              ? 4
              : weekday === "Fri"
                ? 5
                : weekday === "Sat"
                  ? 6
                  : 0;

  const jsDate = new Date(Date.UTC(year, month - 1, day));
  const daysUntilMonday =
    weekdayIndex === 0 ? 1 : weekdayIndex === 6 ? 2 : weekdayIndex === 5 ? 3 : 0;

  jsDate.setUTCDate(jsDate.getUTCDate() + daysUntilMonday);

  const mondayYear2 = jsDate.getUTCFullYear();
  const mondayMonthNum = jsDate.getUTCMonth() + 1;
  const mondayDayNum = jsDate.getUTCDate();

  // RESOLVED AGAINST THE ZONE, not against a hardcoded offset.
  //
  // This line read `T09:30:00-05:00`. -05:00 is EST, the WINTER offset; New York
  // is on EDT (-04:00) from mid-March to early November. So for roughly eight
  // months of the year the "next Monday open" this returns is 10:30 ET -- an
  // hour after the real open -- and the weekend TTL held history stale through
  // the first hour of Monday's session. Measured 2026-08-22: a Saturday write
  // expired at 14:30 UTC when the open is 13:30 UTC.
  //
  // Everything else in this file already reads the zone properly through
  // getEasternParts; this was the one place that guessed. Rather than swap one
  // hardcoded offset for another (which breaks the other four months), the two
  // candidates are tested against the zone itself and the one that really is
  // 09:30 in New York wins.
  for (const offsetHours of [4, 5]) {
    const candidate = Date.UTC(mondayYear2, mondayMonthNum - 1, mondayDayNum, 9 + offsetHours, 30);
    const { hour, minute } = getEasternParts(new Date(candidate));
    if (hour === 9 && minute === 30) return candidate;
  }
  // Neither matched -- only reachable if the zone database disagrees with both
  // US offsets. Fall back to EDT rather than throwing: this is a TTL, and a
  // slightly wrong one beats a warm job that fails on a date-maths edge.
  return Date.UTC(mondayYear2, mondayMonthNum - 1, mondayDayNum, 13, 30);
}

export type HistoryTtlOutcome = "success" | "failure";

function getRedisHistoryTtlSeconds(outcome: HistoryTtlOutcome = "success", now = new Date()) {
  // FIRST, AND BEFORE THE WEEKEND BRANCH. A failed fetch on a Saturday must get
  // 15 minutes, not "hold this failure until Monday's open". The failure floor
  // is a fixed number that no other branch may lengthen -- that is the whole
  // point of it not being derived from the success path.
  if (outcome === "failure") return HISTORY_FAILURE_TTL_SECONDS;

  const { weekday, hour, minute } = getEasternParts(now);
  const totalMinutes = hour * 60 + minute;
  const fridayCloseMinutes = 16 * 60;

  const isFridayAfterClose = weekday === "Fri" && totalMinutes >= fridayCloseMinutes;
  const isWeekend = weekday === "Sat" || weekday === "Sun";

  if (isFridayAfterClose || isWeekend) {
    const mondayOpenUtcMs = getNextMondayOpenUtcMsFromEastern(now);
    const diffSeconds = Math.ceil((mondayOpenUtcMs - now.getTime()) / 1000);
    // MAX, not "choose one". At 50h the base TTL is longer than the gap from a
    // Sunday write to the Monday open, so picking the weekend branch outright
    // would SHORTEN the TTL rather than extend it. The weekend branch exists to
    // hold data across a closed market, never to expire it sooner.
    return Math.max(REDIS_HISTORY_TTL_SECONDS, Math.max(60, diffSeconds));
  }

  return REDIS_HISTORY_TTL_SECONDS;
}

function getHistoryRedisKey(symbol: string) {
  return `${REDIS_HISTORY_PREFIX}:${String(symbol).trim().toUpperCase()}`;
}

function getHistoryLockKey(symbol: string) {
  return `${HISTORY_LOCK_PREFIX}:${String(symbol).trim().toUpperCase()}`;
}

function normalizeSymbol(symbol: string) {
  return String(symbol).trim().toUpperCase();
}

function buildFmpSymbol(symbol: string) {
  return normalizeSymbol(symbol).replace(/\./g, "-");
}

function toFiniteNumber(value: unknown) {
  // TYPEOF ALLOWLIST, matching ipoCalendar.ts, indexChanges.ts,
  // stockDataCache.ts, quoteData.ts and marketState.ts. This file was the only
  // coercion helper in lib/server/ that ran Number() first, and it was wrong for
  // it -- one file diverged from a pattern five siblings already applied.
  //
  // WHY A DENYLIST COULD NOT WORK HERE. Number() coerces far more than the empty
  // shapes anyone thinks to list. Measured, all producing a finite number from
  // something that is not a price:
  //
  //   null -> 0      "" -> 0       " " -> 0      "\n" -> 0
  //   []   -> 0      false -> 0    true -> 1     [7]  -> 7
  //
  // The last two are the reason this is an allowlist and not a longer set of
  // guards: `true` becomes a price of 1, and a single-element ARRAY becomes its
  // element -- a bar invented out of a shape that was never a number. A closed
  // form is right about the cases nobody thought of; an enumerated one is only
  // ever right about the cases someone did.
  //
  // A fake zero here is not cosmetic: it drags a 200-day mean, prints a gap on
  // the chart, and next to collapseDuplicateDates' last-wins rule it would
  // REPLACE the real bar for its date.
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// HOW OFTEN DOES THAT ACTUALLY HAPPEN?
//
// Calling the zero-bar bug "latent" was an assumption about FMP's payload, not
// a measurement -- the same shape as calling an unprobed endpoint "probably
// fine". This counts it.
//
// A counter that has fired at least once and then goes quiet is evidence. A
// counter that has never run is not
// (claude/traps/absence-needs-the-producer-to-have-run.md), which is why the
// value is reported alongside the number of rows PARSED: zero drops out of zero
// rows says nothing, zero drops out of 900k rows says the bug was genuinely
// latent.
//
// A SAMPLE, NOT A CENSUS, and worth saying rather than leaving to be inferred:
// this counts only drops that happen during a WARM RUN. History parsed by a live
// request on a cache miss goes through the same parser and is not counted,
// because nothing reads the counter on that path. A non-zero warm figure is
// therefore a floor on the real rate, and a zero warm figure does not prove the
// live path saw none either.
//
// Module state, read-and-reset by the job route. Same shape as fmpUsage's
// buffer and for the same reason: this must not cost a Redis round-trip per
// parsed row. The route discards the counts on its error path -- see the note
// there on why a failed run must not donate its drops to the next good one.
let historyRowsParsed = 0;
let historyRowsDroppedNoClose = 0;
const historyDropSymbols = new Set<string>();
const MAX_DROP_SYMBOLS = 12;

export function readHistoryDropCounts(): {
  rowsParsed: number;
  rowsDroppedNoClose: number;
  symbols: string[];
} {
  const out = {
    rowsParsed: historyRowsParsed,
    rowsDroppedNoClose: historyRowsDroppedNoClose,
    symbols: [...historyDropSymbols],
  };
  historyRowsParsed = 0;
  historyRowsDroppedNoClose = 0;
  historyDropSymbols.clear();
  return out;
}

// ---------------------------------------------------------------------------
// NEWEST-BAR STALENESS
//
// A history fetch can succeed, parse cleanly, and still be wrong: FMP can serve
// a symbol whose newest bar is days old. Every counter above would read zero.
// Row drops measure the parser; this measures the DATA, and they fail
// independently.
//
// WHY TWO TRADING DAYS OF SLACK AND NOT ONE. "More than one trading day old" is
// the requirement, but the previous WEEKDAY is not the same thing as the
// previous TRADING day -- market holidays are weekdays with no bar. On the
// Tuesday after a Monday holiday the newest bar is legitimately Friday's, which
// a one-day rule would flag. A warn that cries wolf every public holiday is a
// warn people learn to ignore, so the threshold absorbs exactly one holiday and
// costs one day of detection latency on a genuine stall.
export const HISTORY_MAX_BAR_AGE_WEEKDAYS = 2;

// Forced refetches that threw and fell back to the cached entry. Reported with
// the run so "the force ran" and "the force actually refreshed things" are two
// different, separately visible facts -- a run where most symbols fell back is a
// successful-looking run that refreshed almost nothing.
let historyForcedRefetchFailures = 0;
// SYMBOL -> REASON, and a separate UNCAPPED histogram.
//
// The histogram is the diagnostic and it is deliberately not sampled: a capped
// list can say "here are up to 40 of them", but only a complete tally can say
// "all twenty were capacity timeouts" or "eighteen were http-429 and two were
// network". Those are different fixes, and the sample cannot distinguish them
// once it saturates. The per-symbol map is kept as well, so the same-symbols
// comparison morning to morning is still possible.
const historyForcedRefetchFailureSymbols = new Map<string, string>();
const historyForcedFailureReasons = new Map<string, number>();

let historyStaleNewestCount = 0;
let historyFreshNewestCount = 0;
// SYMBOL -> ITS NEWEST BAR DATE, not just the symbol.
//
// The date is what distinguishes the two explanations for a stale symbol, and it
// costs nothing extra to record. A newest bar of 2024-05-03 means the ticker
// stopped trading and FMP is correctly serving a frozen historical series; a
// newest bar of last Wednesday means a live symbol genuinely missed its
// refreshes. The first is a UNIVERSE problem, the second is a FETCH problem, and
// the symbol name alone cannot tell them apart -- which is what the first live
// run of this counter demonstrated.
const historyStaleNewest = new Map<string, string>();
let historyNewestBarSeen: string | null = null;

// ITS OWN CAP, larger than MAX_DROP_SYMBOLS. The drop sample answers "is this
// happening at all", so twelve is plenty. These two answer "to WHICH symbols,
// and is it the same ones every morning" -- a truncated list cannot answer that,
// and the first live run returned exactly 12 stale against a cap of 12 and 20
// forced failures against the same cap. A sample that saturates is not a sample.
const MAX_DIAGNOSTIC_SYMBOLS = 40;

/** Weekdays strictly between `isoDate` and today (Eastern), today excluded. */
function weekdaysBehindEastern(isoDate: string, now = new Date()) {
  const barMs = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(barMs)) return null;

  const { year, month, day } = getEasternParts(now);
  const todayMs = Date.UTC(year, month - 1, day);
  if (barMs >= todayMs) return 0;

  let count = 0;
  for (let ms = barMs + 86_400_000; ms < todayMs; ms += 86_400_000) {
    const dow = new Date(ms).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function recordNewestBarAge(symbol: string, daily: Point[]) {
  const newest = daily.length ? daily[daily.length - 1]?.date : null;
  if (!newest) return;

  if (!historyNewestBarSeen || newest > historyNewestBarSeen) {
    historyNewestBarSeen = newest;
  }

  const behind = weekdaysBehindEastern(newest);
  if (behind === null) return;

  if (behind > HISTORY_MAX_BAR_AGE_WEEKDAYS) {
    historyStaleNewestCount++;
    if (historyStaleNewest.size < MAX_DIAGNOSTIC_SYMBOLS) {
      historyStaleNewest.set(symbol, newest);
    }
  } else {
    historyFreshNewestCount++;
  }
}

/**
 * Read-and-reset, same contract as readHistoryDropCounts: the caller owns the
 * numbers once it has read them, and a failed run must discard rather than
 * donate them to the next good one.
 *
 * `fresh` is returned with `stale` for the same reason `rowsParsed` is returned
 * with the drop count -- 0 stale out of 0 fetched is not evidence of anything.
 */
export function readHistoryBarAgeCounts(): {
  stale: number;
  fresh: number;
  symbols: string[];
  newestBarSeen: string | null;
  forcedRefetchFailures: number;
  forcedRefetchFailureSymbols: string[];
  /** "reason:count", uncapped and sorted by count. The diagnostic. */
  forcedRefetchFailureReasons: string[];
} {
  const out = {
    stale: historyStaleNewestCount,
    fresh: historyFreshNewestCount,
    // "SYM@YYYY-MM-DD" rather than "SYM". See the note on historyStaleNewest.
    symbols: [...historyStaleNewest].map(([sym, date]) => `${sym}@${date}`),
    newestBarSeen: historyNewestBarSeen,
    forcedRefetchFailures: historyForcedRefetchFailures,
    // "SYM:reason", so the sample carries its own diagnosis rather than needing
    // to be cross-referenced against the histogram.
    forcedRefetchFailureSymbols: [...historyForcedRefetchFailureSymbols].map(
      ([sym, reason]) => `${sym}:${reason}`
    ),
    forcedRefetchFailureReasons: [...historyForcedFailureReasons]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => `${reason}:${n}`),
  };
  historyStaleNewestCount = 0;
  historyFreshNewestCount = 0;
  historyStaleNewest.clear();
  historyNewestBarSeen = null;
  historyForcedRefetchFailures = 0;
  historyForcedRefetchFailureSymbols.clear();
  historyForcedFailureReasons.clear();
  return out;
}

function parseFmpHistoricalRows(rows: FmpHistoricalRow[] | undefined, symbol = "") {
  if (!Array.isArray(rows) || rows.length === 0) return [] as Point[];

  const daily: Point[] = [];
  historyRowsParsed += rows.length;

  for (const row of rows) {
    const date = typeof row.date === "string" ? row.date.trim() : "";
    const open = toFiniteNumber(row.open);
    const close = toFiniteNumber(row.close);
    const high = toFiniteNumber(row.high);
    const low = toFiniteNumber(row.low);
    const volume = toFiniteNumber(row.volume);

    if (!date || close === null) {
      // Counted, not just skipped. Before the typeof allowlist above these rows
      // did NOT reach here -- Number(null) is 0, so they became bars priced at
      // zero. The counter is what turns "we think that never happened" into
      // something known either way.
      if (date && close === null) {
        historyRowsDroppedNoClose += 1;
        if (symbol && historyDropSymbols.size < MAX_DROP_SYMBOLS) historyDropSymbols.add(symbol);
      }
      continue;
    }

    daily.push({
      date,
      open: open ?? undefined,
      close,
      high: high ?? undefined,
      low: low ?? undefined,
      volume: volume ?? undefined,
    });
  }

  daily.sort((a, b) => a.date.localeCompare(b.date));

  return collapseDuplicateDates(daily);
}

/**
 * One Point per calendar date. Last occurrence after the sort wins.
 *
 * WHY THIS HAS TO EXIST. Nothing upstream guarantees FMP returns one row per
 * date, and nothing downstream survives it if they do not. Every indicator in
 * this codebase reads the series POSITIONALLY -- movingAverage(closes, 200)
 * takes 200 array slots, not 200 trading days -- so a duplicated date silently
 * shifts every window by one and changes MA, RSI, MACD, Bollinger, ATR and the
 * support/resistance detector at once. Nothing throws. The chart still renders.
 * The numbers are just wrong, by an amount nobody can see
 * (claude/traps/a-visible-failure-is-not-a-harmless-one.md).
 *
 * It is a live risk TODAY, before any intraday-synthesis work: the sort above
 * has always ordered by date and never collapsed on it.
 *
 * LAST WINS, and the reason is determinism rather than a claim about which row
 * is better. Two rows for one date carry no signal about which is more correct,
 * and Array.prototype.sort is stable, so "last after the sort" is "last in
 * FMP's own response order" -- a rule that produces the same series every time
 * from the same payload. An arbitrary winner would make the same input yield
 * different indicators on different runs, which is worse than either choice.
 *
 * When a synthesised intraday bar is eventually appended, it is appended after
 * everything else and therefore wins its date here for free -- which is the
 * REPLACE semantics that work needs, arrived at without a special case. That is
 * a convenience, not the reason this exists: the guard is required whichever way
 * the today-bar probe answers.
 */
function collapseDuplicateDates(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && previous.date === point.date) {
      out[out.length - 1] = point;
      continue;
    }
    out.push(point);
  }
  return out;
}

function getMinuteBucketParts(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  const minute = String(now.getUTCMinutes()).padStart(2, "0");

  return {
    bucket: `${year}${month}${day}${hour}${minute}`,
    secondsRemaining: 60 - now.getUTCSeconds(),
  };
}

function getFmpCounterKey(now = new Date()) {
  const { bucket } = getMinuteBucketParts(now);
  return `${FMP_CALL_COUNTER_PREFIX}:${bucket}`;
}

/**
 * Reserve one slot in the current minute's FMP budget, waiting for room if the
 * minute is already spoken for.
 *
 * THE WAIT MUST NOT BE A WRITE. This loop used to call INCR on every pass, so a
 * caller waiting for capacity raised the very number it was waiting to see come
 * down -- at a flat FMP_WAIT_STEP_MS against FMP_MAX_WAIT_MS that is up to 50
 * increments for ONE FMP call, and none of them were ever given back. With
 * enough waiters the counter cannot fall: the guard that exists to keep us under
 * FMP's rate limit becomes the reason we breach it.
 *
 * That is the shape the 07:01 warm showed -- http-429 and capacity-timeout side
 * by side. Those two normally point opposite ways (FMP refusing us vs. our own
 * limiter holding us back), and seeing both at once is the tell that the limiter
 * was manufacturing the load it was throttling.
 *
 * So: a reservation is exactly one INCR. If it does not fit it is handed
 * straight back with DECR, and the wait that follows is a plain GET, which
 * cannot inflate anything. The 300/min ceiling and FMP_MAX_WAIT_MS are
 * deliberately unchanged -- this fixes how we wait, not what we wait for.
 */
export async function reserveFmpCallSlot() {
  if (!redis) return;

  const startedAt = Date.now();
  let waitMs = FMP_WAIT_STEP_MS;

  while (true) {
    const now = new Date();
    const key = getFmpCounterKey(now);
    const { secondsRemaining } = getMinuteBucketParts(now);

    try {
      const current = await redis.incr(key);

      if (current === 1) {
        await redis.expire(key, Math.max(2, secondsRemaining + 2));
      }

      if (current <= FMP_SAFE_CALLS_PER_MINUTE) {
        return;
      }

      // Give the slot back before waiting. A reservation that did not fit is
      // not a call we are going to make, and leaving it counted would charge
      // the rest of the minute for a call that never happened.
      await redis.decr(key);
    } catch {
      return;
    }

    // READ-ONLY WAIT. Re-INCR only once this says there is room. If the minute
    // rolls over mid-wait, getFmpMinuteUsage reads the new bucket -- which is
    // empty -- so the next pass reserves immediately rather than sitting out
    // the remainder of a budget that no longer applies.
    while (true) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= FMP_MAX_WAIT_MS) {
        throw new FmpHistoryError("FMP call guard wait timeout", "capacity-timeout");
      }

      await sleep(Math.min(waitMs, FMP_MAX_WAIT_MS - elapsed));
      waitMs = Math.min(waitMs * 2, FMP_WAIT_STEP_MAX_MS);

      if ((await getFmpMinuteUsage()) < FMP_SAFE_CALLS_PER_MINUTE) break;
    }
  }
}

/**
 * Reserve one slot WITHOUT EVER WAITING. Returns false instead of blocking.
 *
 * WHY THE RENDER PATH NEEDS ITS OWN DOOR. reserveFmpCallSlot waits up to
 * FMP_MAX_WAIT_MS (20s) for room. That is right for a warm job, which has
 * nothing better to do and a whole universe to get through. It is wrong for a
 * page render: a visitor waiting 20 seconds for a quote is a worse outcome than
 * the quote being briefly unavailable, and it would turn a budget shortage into
 * an availability incident.
 *
 * SO: count, do not queue. The problem being fixed is that quote calls were
 * INVISIBLE to the counter -- 575 in a 15-minute window spending the plan
 * limit while every warm job believed it had room. Making them visible fixes
 * the accounting, which is what the warm jobs' own backoff reads. Making them
 * wait would fix nothing further, because a render cannot usefully defer: it
 * either has a price to show or it does not.
 *
 * REFUSAL IS DELIBERATE, AND IT IS THE CHEAPER REFUSAL. When the minute is
 * already spent, this returns false and the caller skips the request. FMP would
 * answer that request with a 429 anyway; being turned away locally is faster,
 * costs no plan quota, and does not deepen the shortage that caused it.
 *
 * Worst-case added latency: one Redis INCR. Not one wait.
 */
export async function tryReserveFmpCallSlot(): Promise<boolean> {
  if (!redis) return true;

  const now = new Date();
  const key = getFmpCounterKey(now);
  const { secondsRemaining } = getMinuteBucketParts(now);

  try {
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, Math.max(2, secondsRemaining + 2));
    }

    if (current <= FMP_SAFE_CALLS_PER_MINUTE) return true;

    // Hand the slot back, exactly as the waiting path does: a reservation that
    // did not fit is not a call anyone is going to make, and leaving it counted
    // would charge the rest of the minute for nothing.
    await redis.decr(key);
    return false;
  } catch {
    // Fail OPEN. The counter is a pacing aid; a Redis blip must not stop a page
    // rendering a price.
    return true;
  }
}

export async function getFmpMinuteUsage() {
  if (!redis) return 0;

  try {
    const current = await redis.get<number>(getFmpCounterKey(new Date()));
    return typeof current === "number" && Number.isFinite(current) ? current : 0;
  } catch {
    return 0;
  }
}

/** The plan's own ceiling, for anything that needs to report the real limit. */
export function getFmpPlanCallsPerMinute() {
  return FMP_PLAN_CALLS_PER_MINUTE;
}

export async function hasFmpCapacity(requiredCalls = 1, minHeadroomCalls = 0) {
  const current = await getFmpMinuteUsage();
  return current + requiredCalls + minHeadroomCalls <= FMP_SAFE_CALLS_PER_MINUTE;
}

async function acquireHistoryLock(symbol: string) {
  if (!redis) return "no-redis";

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const key = getHistoryLockKey(symbol);

  try {
    const result = await redis.set(key, token, {
      nx: true,
      ex: HISTORY_LOCK_TTL_SECONDS,
    });

    if (result === "OK") return token;
    return null;
  } catch {
    return null;
  }
}

async function releaseHistoryLock(symbol: string, token: string | null) {
  if (!redis || !token || token === "no-redis") return;

  const key = getHistoryLockKey(symbol);

  try {
    const current = await redis.get<string>(key);
    if (current === token) {
      await redis.del(key);
    }
  } catch {
    // fail open
  }
}

async function waitForHistoryCache(symbol: string, maxWaitMs = 12_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const cached = await readHistoryEntry(symbol);
    if (cached) return cached;
    await sleep(300);
  }

  return null;
}

export async function readHistoryEntry(symbol: string) {
  const normalized = normalizeSymbol(symbol);

  if (!redis) {
    timingCache("history", "redis", "skip", "no-credentials");
    return null;
  }

  try {
    const entry = await redis.get<HistoryCacheEntry>(getHistoryRedisKey(normalized));

    // Each of these rejections means the caller falls through to a live FMP
    // fetch behind a 45s lock, with concurrent requests WAITING on it. The
    // reason is logged because "miss" and "miss because the entry was there
    // but stale-shaped" want different fixes.
    if (!entry || typeof entry !== "object") {
      timingCache("history", "redis", "miss", `${normalized} absent`);
      return null;
    }
    if (entry.symbol !== normalized) {
      timingCache("history", "redis", "miss", `${normalized} symbol-mismatch`);
      return null;
    }
    if (entry.status !== "qualified" && entry.status !== "non_qualified") {
      timingCache("history", "redis", "miss", `${normalized} status=${entry.status}`);
      return null;
    }
    if (entry.source !== "fmp") {
      timingCache("history", "redis", "miss", `${normalized} source=${entry.source}`);
      return null;
    }

    timingCache("history", "redis", "hit", normalized);
    return entry;
  } catch {
    timingCache("history", "redis", "miss", `${normalized} threw`);
    return null;
  }
}

export async function writeHistoryEntry(
  symbol: string,
  entry: HistoryCacheEntry,
  outcome: HistoryTtlOutcome = "success"
) {
  const normalized = normalizeSymbol(symbol);

  if (!redis) return;

  try {
    // NOT markRefreshed on the failure path. A 15-minute defer marker is not a
    // refresh, and recording it as one would let a dataset of nothing but failed
    // fetches read as perfectly fresh on /cache-health -- the exact shape
    // claude/traps/absence-needs-the-producer-to-have-run.md is about.
    if (outcome === "success") {
      await markRefreshed("dailyHistory", [normalized]);
    }
    await redis.set(getHistoryRedisKey(normalized), entry, {
      // STILL CALLED WITH THE WRITE INSTANT, not a hoisted or passed-in time --
      // the weekend behaviour measured in #354 depends on this reading the
      // moment of the write. The outcome is the only new argument.
      ex: getRedisHistoryTtlSeconds(outcome),
    });
  } catch {
    // fail open
  }
}

// ---------------------------------------------------------------------------
// INCREMENTAL FETCH
//
// WHY THIS EXISTS. Until 2026-08-31 every refresh of a symbol's history threw
// away the copy in Redis and pulled the whole series back over the wire -- ~1,188
// rows, ~184 KB -- to learn one new closing price. Across a 755-symbol universe
// that is ~133 MB per pass, and at ~2.5 passes/day it was ~9.7 GB/month against
// a 20 GB / 30-day FMP cap. It put the account at 97.8% and FMP's penalty at the
// cap is suspension. See claude/fmp-bandwidth-97pct-2026-08-30.md and
// claude/fmp-history-payload-audit-2026-08-30.md.
//
// A closed daily bar is a finished fact. The only reason to re-read one is that
// the series has been RESTATED -- a split or an adjustment rewrites every close
// before its effective date. So: ask only for bars at or after the newest one
// already held, plus a short overlap, and use the overlap to detect restatement.
//
// THE OVERLAP IS THE CORRECTNESS GUARD, NOT AN OPTIMISATION. Appending blindly
// would stitch pre-split bars onto post-split bars and produce a fabricated gap
// -- a 4:1 split becomes a fake 75% crash in the chart and a false signal in
// every pattern builder. That failure is silent and wrong, which is worse than
// the bandwidth problem being loud and expensive. If the overlapping bars do not
// agree with what is stored, the series is refetched in full.
//
// DEPTH IS UNCHANGED. Redis still holds up to MAX_CACHED_HISTORY_DAYS bars and
// every consumer -- the 260-week macro S/R pass in pickersBuilder, the 1300-day
// HISTORY_DAYS in the bull-flag/plays/triangle builders, the charts -- reads
// exactly what it read before. This changes how the data is REFRESHED, not what
// it contains.
//
// NOTE FOR WHOEVER READS THE NEXT WARM RUN RECORD. historyRowsParsed will drop
// from ~831k to a few thousand, because the parser now sees only new rows. That
// is this change working, not the warm failing.

// Calendar days, not trading days -- it only has to span a weekend plus a public
// holiday or two so that a Monday refresh still overlaps Friday's bar. Too short
// and a long market closure yields no shared dates (handled: "unverifiable"
// forces a full refetch, which is safe but costs the bytes this exists to save).
const HISTORY_INCREMENTAL_OVERLAP_DAYS = 7;

/**
 * One FMP history request. `range` omitted means the endpoint's full default
 * window; supplied means only that slice. Everything else -- the call-slot
 * reservation, the error classification, the parse -- is identical either way,
 * which is the point of having it in one place.
 */
async function requestHistoryRows(
  normalized: string,
  fmpSymbol: string,
  apiKey: string,
  range?: { from: string; to: string }
) {
  await reserveFmpCallSlot();

  const params = new URLSearchParams({ symbol: fmpSymbol, apikey: apiKey });

  if (range) {
    params.set("from", range.from);
    params.set("to", range.to);
  }

  const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?${params.toString()}`;

  // `cache: "no-store"` here used to opt every route that reached this call out
  // of static rendering entirely -- the same class of bailout @upstash/redis
  // caused via its own no-store default (see lib/server/redisCacheMode.ts and
  // claude/picker-pages-isr-2026-08-20.md). It only fires on a Redis miss, so it
  // is intermittent and invisible: the route silently renders per request.
  //
  // Redis remains the real cache for this data, with its own market-aware TTL
  // (getRedisHistoryTtlSeconds). This short Next revalidate is not a second
  // cache tier of any consequence -- it exists so the call stops forcing the
  // route dynamic, and it dedupes a burst of identical misses inside one render
  // pass. It is deliberately far shorter than the Redis TTL, so Redis still
  // decides when this data is stale.
  const res = await fmpFetch(url, {
    next: { revalidate: 300 },
    headers: {
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    throw new FmpHistoryError(
      `FMP history request failed with status ${res.status} for ${normalized}`,
      `http-${res.status}`
    );
  }

  const payload = (await res.json()) as FmpHistoricalResponse;

  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "Error" in payload &&
    typeof payload.Error === "string" &&
    payload.Error.trim()
  ) {
    throw new FmpHistoryError(`FMP history error for ${normalized}: ${payload.Error}`, "fmp-error");
  }

  return parseFmpHistoricalRows(Array.isArray(payload) ? payload : undefined, normalized);
}

export async function fetchAndCacheDailyHistory(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const fmpSymbol = buildFmpSymbol(normalized);
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    throw new FmpHistoryError("Missing FMP_API_KEY environment variable", "no-api-key");
  }

  // READ HERE RATHER THAN TAKING IT AS AN ARGUMENT, so every caller gets the
  // incremental path without a signature change -- including the forced warm,
  // which deliberately skips its own read. On the ordinary miss path this
  // returns null and costs one GET; under force it costs one GET and saves
  // ~184 KB of FMP bandwidth. That trade is not close.
  const existing = await readHistoryEntry(normalized);
  const stored =
    existing?.status === "qualified" && Array.isArray(existing.daily) && existing.daily.length
      ? existing.daily
      : null;

  if (stored) {
    const newestStored = stored[stored.length - 1]?.date;
    const from = newestStored ? shiftIsoDate(newestStored, -HISTORY_INCREMENTAL_OVERLAP_DAYS) : null;

    if (from) {
      const fetched = await requestHistoryRows(normalized, fmpSymbol, apiKey, {
        from,
        // UTC is at or ahead of Eastern, so "today" here can never truncate a
        // bar the US session has already closed.
        to: toIsoUtcDate(Date.now()),
      });

      // NO NEW BARS IS NOT A FAILURE. No session has closed since the newest
      // stored bar -- a weekend, a holiday, or simply before today's close. The
      // stored series is still correct, so keep it and re-stamp the TTL. This is
      // also the self-healing case: if refreshes are missed for days, `from`
      // still starts from the last bar actually held.
      //
      // "restated" means a corporate action rewrote the series and "unverifiable"
      // means there were no shared dates to check it against. Neither can be
      // appended to safely, so both fall through to the full refetch below --
      // see the block comment on overlapVerdict for why that matters.
      const verdict = fetched.length === 0 ? "agrees" : overlapVerdict(stored, fetched);

      if (verdict === "agrees") {
        const daily =
          fetched.length === 0
            ? stored
            : mergeDailyPoints(stored, fetched, MAX_CACHED_HISTORY_DAYS);

        const entry: HistoryCacheEntry = {
          symbol: normalized,
          status: "qualified",
          checkedAt: Date.now(),
          source: "fmp",
          daily,
          parsedRows: daily.length,
        };

        recordNewestBarAge(normalized, daily);
        await writeHistoryEntry(normalized, entry, "success");
        return entry;
      }
    }
  }

  // THE FULL PATH, DELIBERATELY UNCHANGED FROM BEFORE THE INCREMENTAL FETCH
  // LANDED. Everything above is an early return; if it does not take, this runs
  // exactly as it always did. `parsed` stays bound here rather than being hoisted
  // and shared with the incremental path, because the failure/success TTL split
  // below has to mean "how many rows did the RESPONSE contain" -- a merged series
  // length cannot answer that, and scripts/check-history-ttl.mjs asserts on this
  // very expression to keep it honest.
  const parsed = await requestHistoryRows(normalized, fmpSymbol, apiKey);
  const daily =
    parsed.length > MAX_CACHED_HISTORY_DAYS
      ? parsed.slice(-MAX_CACHED_HISTORY_DAYS)
      : parsed;

  if (daily.length >= MIN_QUALIFIED_POINTS) {
    const entry: HistoryCacheEntry = {
      symbol: normalized,
      status: "qualified",
      checkedAt: Date.now(),
      source: "fmp",
      daily,
      parsedRows: parsed.length,
    };

    recordNewestBarAge(normalized, daily);
    await writeHistoryEntry(normalized, entry, "success");
    return entry;
  }

  const entry: HistoryCacheEntry = {
    symbol: normalized,
    status: "non_qualified",
    checkedAt: Date.now(),
    source: "fmp",
    parsedRows: parsed.length,
  };

  // See the HISTORY_FAILURE_TTL_SECONDS comment: an EMPTY response is a failure,
  // a short one is a fact. Only the first gets the 15-minute floor.
  await writeHistoryEntry(normalized, entry, parsed.length === 0 ? "failure" : "success");
  return entry;
}

// One in-process fetch per symbol, the same shape as the inFlight map in
// quoteData.ts.
//
// WHY THE REDIS LOCK IS NOT ALREADY ENOUGH. /stock/[symbol] calls this TWICE for
// a single render -- once in generateMetadata and once in the page body -- and
// on a cold symbol the two race each other. One takes the history lock and
// fetches; the sibling finds nothing cached, loses the lock, and sits in
// waitForHistoryCache polling every 300ms for up to 12s. That is up to 40 GETs
// spent waiting on a fetch already running inside its own process. The lock
// makes the duplicate wait politely; this removes it.
//
// FORCED CALLS DELIBERATELY BYPASS IT. A forced refetch that adopted an
// in-flight ordinary one would report success having refreshed nothing.
const historyInFlight = new Map<string, ReturnType<typeof getDailyHistoryInner>>();

export async function getDailyHistory(symbol: string, opts: { force?: boolean } = {}) {
  const force = opts.force ?? false;
  const endTiming = beginTiming("history", "getDailyHistory");

  try {
    if (force) return await getDailyHistoryInner(symbol, true);

    const key = normalizeSymbol(symbol);
    const existing = historyInFlight.get(key);
    if (existing) return await existing;

    const promise = (async () => {
      try {
        return await getDailyHistoryInner(symbol, false);
      } finally {
        // Cleared in a finally so a rejected fetch cannot pin a permanently
        // failing promise in the map for the life of the instance.
        historyInFlight.delete(key);
      }
    })();

    historyInFlight.set(key, promise);
    return await promise;
  } finally {
    endTiming();
  }
}

async function getDailyHistoryInner(symbol: string, force = false) {
  const normalized = normalizeSymbol(symbol);
  // FORCE SKIPS THE READ, NOT THE LOCK. Under force we refetch regardless of
  // what is cached, but if another caller already holds this symbol's lock it is
  // already doing a live fetch -- waiting on that is a fresh result, so the
  // wait-for-other-request path below stays exactly as it is. Force means
  // "ignore the TTL", not "ignore the other fetch in flight".
  const cached = force ? null : await readHistoryEntry(normalized);

  if (cached) {
    if (cached.status === "qualified" && Array.isArray(cached.daily)) {
      return cached.daily;
    }

    return [] as Point[];
  }

  const lockToken = await acquireHistoryLock(normalized);

  if (!lockToken) {
    const waited = await waitForHistoryCache(normalized);

    if (waited) {
      if (waited.status === "qualified" && Array.isArray(waited.daily)) {
        return waited.daily;
      }

      return [] as Point[];
    }
  }

  try {
    const fresh = await fetchAndCacheDailyHistory(normalized);

    if (fresh.status === "qualified" && Array.isArray(fresh.daily)) {
      return fresh.daily;
    }

    return [] as Point[];
  } finally {
    await releaseHistoryLock(normalized, lockToken);
  }
}

// Small local concurrency limiter, same shape as the one in
// pickersBuilder.ts -- kept local here rather than shared/exported so this
// module has no dependency on the picker builder. Used to cap how many
// concurrent FMP fetches getDailyHistoryBulk's cache-miss fallback can
// trigger at once (e.g. right after a Redis flush, when a large fraction
// of a 200-symbol universe could otherwise all miss simultaneously).
function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

// Batch version of getDailyHistory(): reads the whole requested symbol list's
// cached history in a single Redis round-trip instead of one individual REST
// call per symbol -- for a 200-symbol universe this was ~200 separate
// Upstash calls just to check "is this already cached" before any FMP fetch
// even happens. Only symbols that miss the bulk read (no entry yet, or a
// corrupt/unexpected entry shape) fall back to the existing single-symbol
// getDailyHistory() path, which still handles the distributed lock + FMP
// fetch + wait-for-other-request's-fetch logic exactly as before. On a warm
// cache (the common case, given the 6h TTL and the daily warm-up cron) this
// fallback runs for zero or very few symbols.
//
// This uses a Redis *pipeline* of individual GETs, not MGET. Both send the
// whole batch to Upstash as a single HTTP round-trip, so neither costs extra
// network calls -- the difference is how the reply is measured. MGET
// combines every key's value into one single command reply; on a warm cache
// with the full ~200+ symbol universe, that single reply routinely blew past
// Upstash's per-pull size ceiling (this is what triggered a "single pull
// exceeded 10MB" warning from Upstash in production). A pipeline sends the
// same N commands in one request, but Upstash measures and returns each
// command's reply separately, so no single reply is ever larger than one
// symbol's cached history -- the batch as a whole is unbounded, but no
// individual piece of it is, which is what the size ceiling actually cares
// about.
export async function getDailyHistoryBulk(
  symbols: string[],
  opts: { force?: boolean } = {}
): Promise<Map<string, Point[]>> {
  const force = opts.force ?? false;
  const result = new Map<string, Point[]>();

  const normalized = Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))
  );
  if (!normalized.length) return result;

  if (!redis) {
    const limitNoRedis = createLimiter(10);
    await Promise.all(
      normalized.map((symbol) =>
        limitNoRedis(async () => {
          result.set(symbol, await getDailyHistory(symbol, { force }));
        })
      )
    );
    return result;
  }

  const keys = normalized.map((symbol) => getHistoryRedisKey(symbol));
  let entries: (HistoryCacheEntry | null)[] = normalized.map(() => null);

  // THE READ HAPPENS EVEN UNDER FORCE, and that is deliberate. What force
  // changes is the CLASSIFICATION below, not this round-trip.
  //
  // Under force every symbol is refetched regardless of what is cached -- that
  // is the whole point, because this path is otherwise MISS-ONLY and, with a TTL
  // longer than 24h, the daily morning warm would find every symbol present, fetch
  // nothing, and still report success. But the cached entry is still worth
  // having: it is the fallback when a forced refetch fails, which is what stops
  // a forced run from ever producing a THINNER universe than a non-forced one.
  // Skipping the read would have thrown that away to save one Redis round-trip
  // per build.
  try {
    // Accumulated separately and assigned only once every chunk has landed, so
    // a throw partway leaves `entries` in its all-null state. A half-filled
    // array would still be index-aligned for the symbols it reached and
    // silently wrong for the rest.
    const fetched: (HistoryCacheEntry | null)[] = [];
    for (const group of chunkHistoryKeys(keys, HISTORY_MGET_CHUNK)) {
      fetched.push(...(await redis.mget<(HistoryCacheEntry | null)[]>(...group)));
    }
    entries = fetched;
  } catch {
    // Best-effort; every symbol just falls through to the per-symbol path.
  }

  const usable = (entry: HistoryCacheEntry | null | undefined, symbol: string) =>
    entry &&
    typeof entry === "object" &&
    entry.symbol === symbol &&
    (entry.status === "qualified" || entry.status === "non_qualified") &&
    entry.source === "fmp";

  const pointsOf = (entry: HistoryCacheEntry) =>
    entry.status === "qualified" && Array.isArray(entry.daily) ? entry.daily : [];

  const misses: string[] = [];
  const cachedBySymbol = new Map<string, HistoryCacheEntry>();

  normalized.forEach((symbol, i) => {
    const entry = entries[i];
    const ok = usable(entry, symbol);

    if (ok) cachedBySymbol.set(symbol, entry as HistoryCacheEntry);

    if (ok && !force) {
      result.set(symbol, pointsOf(entry as HistoryCacheEntry));
    } else {
      misses.push(symbol);
    }
  });

  if (misses.length) {
    const limit = createLimiter(10);
    await Promise.all(
      misses.map((symbol) =>
        limit(async () => {
          try {
            result.set(symbol, await getDailyHistory(symbol, { force }));
          } catch (error) {
            // A FORCED RUN MUST NOT MAKE THE UNIVERSE THINNER THAN NOT RUNNING.
            //
            // getDailyHistory has no catch, so a single reserveFmpCallSlot
            // timeout (it waits FMP_MAX_WAIT_MS and then THROWS) propagates out
            // of this Promise.all and aborts the entire build. Without force
            // that is rare -- a warm cache means few misses. With force every
            // symbol is a miss, so ~700 fetches contend for a 300/min budget and
            // some WILL time out waiting for a slot. Letting that abort the run,
            // or silently drop the symbol, would mean forcing a refresh made the
            // picker universe worse than leaving it alone.
            //
            // Only under force, and only when a usable cached entry exists: fall
            // back to it. Without force the throw still propagates, because there
            // the caller's cache fallback is the right handler and swallowing it
            // here would hide a real outage.
            const fallback = cachedBySymbol.get(symbol);
            if (!force || !fallback) throw error;

            historyForcedRefetchFailures++;
            const reason = classifyFmpFailure(error);
            historyForcedFailureReasons.set(reason, (historyForcedFailureReasons.get(reason) ?? 0) + 1);
            if (historyForcedRefetchFailureSymbols.size < MAX_DIAGNOSTIC_SYMBOLS) {
              historyForcedRefetchFailureSymbols.set(symbol, reason);
            }
            result.set(symbol, pointsOf(fallback));
          }
        })
      )
    );
  }

  return result;
}

/**
 * Cache-ONLY bulk history read: the pipelined half of getDailyHistoryBulk with
 * the on-miss fetch removed. Added 2026-08-07 for the sector breadth panel,
 * which needs closes for ~20 symbols on a page render and must NEVER spend an
 * FMP call to get them -- getDailyHistoryBulk's miss path would fire up to one
 * fetch per uncached symbol, which is fine for a cron and wrong for a render.
 * Uncached symbols are simply absent from the returned map; the caller reports
 * how many it actually had.
 */
export async function getCachedDailyHistoryBulk(
  symbols: string[]
): Promise<Map<string, Point[]>> {
  const result = new Map<string, Point[]>();

  const normalized = Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))
  );
  if (!normalized.length || !redis) return result;

  try {
    const entries: (HistoryCacheEntry | null)[] = [];
    for (const group of chunkHistoryKeys(normalized, HISTORY_MGET_CHUNK)) {
      const keys = group.map((symbol) => getHistoryRedisKey(symbol));
      entries.push(...(await redis.mget<(HistoryCacheEntry | null)[]>(...keys)));
    }

    normalized.forEach((symbol, i) => {
      const entry = entries[i];
      if (
        entry &&
        typeof entry === "object" &&
        entry.symbol === symbol &&
        entry.status === "qualified" &&
        Array.isArray(entry.daily) &&
        entry.daily.length
      ) {
        result.set(symbol, entry.daily);
      }
    });
  } catch {
    // Best-effort: an empty map means the caller shows fewer names, not an error.
  }

  return result;
}

export async function getCachedDailyHistory(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const cached = await readHistoryEntry(normalized);

  if (
    cached &&
    cached.status === "qualified" &&
    Array.isArray(cached.daily)
  ) {
    return cached.daily;
  }

  return [] as Point[];
}

export async function ensureQualifiedHistory(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const cached = await readHistoryEntry(normalized);

  if (cached) {
    return cached.status === "qualified";
  }

  const daily = await getDailyHistory(normalized);
  return Array.isArray(daily) && daily.length >= MIN_QUALIFIED_POINTS;
}
