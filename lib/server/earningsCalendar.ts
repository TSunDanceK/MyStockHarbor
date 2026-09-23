// Data layer for the site-wide Earnings Calendar (distinct from the
// per-stock Company Earnings page, which has its own data in
// app/api/stock-earnings/[symbol]/route.ts).
//
// Two FMP endpoints only, both confirmed working on the Starter plan via
// app/api/debug/earnings-calendar:
//   - /stable/earnings-calendar?from&to -- bulk {symbol, date, epsEstimated,
//     epsActual, revenueEstimated, revenueActual} for every reporting
//     company globally. No company name, no exchange.
//   - /stable/stock-list -- bulk {symbol, companyName} for ~38k symbols,
//     also no exchange. Used purely as a name lookup, cached a day.
//
// Both bulk *quote* endpoints (batch-quote, batch-quote-short) are 402 on
// this plan -- confirmed via the same debug route. So there is no way to
// get price/market cap (or exchange) for many symbols in one call; only the
// single-symbol /stable/quote works, and that's the one part of this file
// that spends a real API call per symbol.
//
// --- Rolling window (added 2026-07-18; INVERTED 2026-09-15) ---
//
// The calendar only ever deals with a bounded, rolling window of dates:
//   start = today - WINDOW_PAST_DAYS
//   end   = today
// Anything outside that window is greyed out in the UI and never populated.
// Both edges advance daily, exactly one day at a time. See getWindowStartDate /
// getWindowEndDate / isDateInWindow (exported for the page to clamp navigation
// and grey cells).
//
// ── WHY IT POINTS BACKWARD NOW ─────────────────────────────────────────────
// The window used to run three days back and three months forward, on the
// assumption that a reliable forward calendar existed. It does not. Both routes
// to one were measured and both failed:
//
//   cadence prediction from filing history   2 of 48 filers landed inside
//                                            their OWN p90 band +/-2 days
//   8-K scheduling announcements             0 of 276 fell in the 14-28 day
//                                            band a calendar would need
//
// So the forward half of the window was never showing confirmed dates; it was
// showing a vendor's guesses, and it emptied within 24 hours of the vendor
// going away. What IS free, exact and permanent is the past: a results filing
// is a dated public document.
//
// PAST DATES SETTLE. That is the property the rest of this file now leans on.
// A date more than a day or two old will not gain new reporters, so "complete"
// means complete forever, and the machinery that existed to re-walk a moving
// future -- a frontier pointer, a park-past-the-end short circuit -- is gone
// rather than reversed. See findNextIncompleteDate.
//
// --- Rate-limiting + auto-populate system ---
//
// A Redis-backed hourly cap (QUOTE_HOURLY_CAP) limits how many *new*
// (never-quoted-before) symbols this feature spends a real FMP /quote call
// on, shared across every visitor. Symbols already quoted within the last
// ~30 days skip the cap entirely (wasRecentlyQuoted/markQuoted), so re-
// showing cached data is always free -- only genuinely first-time symbols
// compete for the cap.
//
// A background auto-populate loop runs after every real page load: it fills
// the next not-yet-complete date in the window, front-to-back from the
// window's start edge (see findNextIncompleteDate / populateNextMissingDate,
// called from `after()` in app/earnings-calendar/page.tsx). A Redis
// "frontier" pointer records how far the contiguous front of the window has
// been filled, so once the whole window is complete these scans short-
// circuit at zero cost until the window rolls forward the next day/month.
//
// A date is tracked as "complete" (isDateComplete/markDateComplete) once
// every one of its candidates has been quoted with nothing skipped by the
// cap. On completion the accurate US-listed count is stored (per-month Redis
// hash, so the calendar's green day-badges self-correct from the raw
// candidate estimate to the real filtered number) and the assembled rows are
// cached as one blob (DAY_ITEMS_PREFIX) so re-viewing a filled date is a
// single Redis read rather than a quote lookup per candidate.
//
// For manual catch-up, the site owner can use the "Backfill" button on
// app/earnings-calendar/page.tsx -> app/api/earnings-calendar/backfill-date,
// gated behind EARNINGS_BACKFILL_KEY (lib/server/backfillAuth.ts). It bypasses
// this file's own hourly cap for one date but never the site-wide FMP account
// budget (reserveFmpCallSlot from historyCache.ts, ~300 calls/minute), which
// every real quote call still waits on.

import { Redis } from "@upstash/redis";
import {
  REFERENCE_TTL_DAILY_SECONDS,
  readReference,
  writeReference,
} from "./referenceCache";
import { fmpFetch } from "./fmpUsage";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { reserveFmpCallSlot } from "./historyCache";
import { readPricePoolBulk } from "./pricePool";
import { priceCoverage, type PriceCoverage } from "./gridPriceCoverage";
import { readResultsDays, symbolsByDay } from "./secResultsDays";
import { gridAdmits, gridCompanyName } from "./secTickerNames";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

// Hard ceiling on real, per-symbol FMP /quote calls this feature is allowed
// to spend in any rolling hour -- global across all visitors, not per-IP.
// Symbols already quoted within the last ~30 days (matching the underlying
// fetch cache's revalidate window) don't consume a slot at all.
const QUOTE_HOURLY_CAP = 50;
const QUOTE_COUNTER_PREFIX = "msh:earnings-quote-calls:v1";
const QUOTED_SYMBOL_PREFIX = "msh:earnings-quoted-symbol:v1";
// ── v2 -> v3, AND THE BUMP IS THE MIGRATION ────────────────────────────────
//
// F2's read side now serves an empty stored blob when the date is marked
// complete, on the basis that post-F1 a `complete` flag can only have been
// written over a clean read. Flags written BEFORE F1 carry no such guarantee:
// they were set by a code path that could not tell a failed quote from a
// company with no exchange.
//
// THE DANGEROUS PRE-FIX STATE HAS NO RETROSPECTIVE SIGNATURE. A fully poisoned
// date is visible (empty blob + flag + candidates) and production had none. A
// PARTIALLY populated date -- some quotes returned, some failed, the day settled
// short -- looks exactly like a correct day with fewer reporters. Nothing stored
// distinguishes them, so there is no query that finds them and re-evaluation is
// the only way to clear them.
//
// PRECEDENT, SAME FILE, SAME TWO KEYS: #378 (91f2cf1) bumped both from v1 to v2
// when the rolling window changed what "complete" meant. A flag whose meaning
// has changed is a new key, not an old key with new semantics.
// v3 -> v4 and v1 -> v2 (2026-09-23): THE GRID'S SOURCE CHANGED, from FMP's
// earnings calendar to SEC's own announcements (#535 COWORK #18 §3). A blob
// materialised from FMP's rows carries FMP's names, estimates and candidates;
// a new key is the migration, as at #378 and v2 -> v3 above.
const DAY_COMPLETE_PREFIX = "msh:earnings-day-complete:v4";
const DAY_ITEMS_PREFIX = "msh:earnings-day-items:v2";

// Rolling window bounds. There is no future bound: the window ENDS today.
//
// 90 days is a full reporting quarter plus a few days' slack, so every company
// that has reported since its last quarter end appears exactly once. Longer
// buys repetition; shorter cuts the tail of a reporting season off the page.
const WINDOW_PAST_DAYS = 90;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getHourBucket(now = new Date()) {
  return (
    `${now.getUTCFullYear()}` +
    `${pad2(now.getUTCMonth() + 1)}` +
    `${pad2(now.getUTCDate())}` +
    `${pad2(now.getUTCHours())}`
  );
}

// --- Rolling-window helpers ---------------------------------------------

function utcMidnightToday(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Oldest date shown/populatable: today minus WINDOW_PAST_DAYS.
export function getWindowStartDate(): string {
  const t = utcMidnightToday();
  return toDateStr(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - WINDOW_PAST_DAYS)));
}

// Newest date shown/populatable: TODAY. Not the end of the month, not a
// configurable number of days ahead -- a date that has not happened yet cannot
// have a results filing, and every attempt to show one was a vendor estimate.
export function getWindowEndDate(): string {
  return toDateStr(utcMidnightToday());
}

export function isDateInWindow(date: string): boolean {
  return date >= getWindowStartDate() && date <= getWindowEndDate();
}

// Has this symbol already been through a real FMP quote call recently
// enough that Next's own fetch cache is expected to still be warm for it?
async function wasRecentlyQuoted(symbol: string): Promise<boolean> {
  if (!redis) return false;

  try {
    const hit = await redis.get(`${QUOTED_SYMBOL_PREFIX}:${symbol}`);
    return hit != null;
  } catch {
    return false;
  }
}

async function markQuoted(symbol: string) {
  if (!redis) return;

  try {
    await redis.set(`${QUOTED_SYMBOL_PREFIX}:${symbol}`, 1, {
      ex: QUOTE_REVALIDATE_SECONDS,
    });
  } catch {
    // fail open -- worst case this symbol re-spends a slot next time
  }
}

// Atomically claims one of this hour's new-quote slots. Returns true if
// the caller may actually hit FMP, false if the hour's budget is already
// spent. Always increments the counter (even under bypassCap) so
// getQuoteHourUsage stays accurate. Fails open on Redis error.
async function reserveQuoteSlot(): Promise<boolean> {
  if (!redis) return true;

  const key = `${QUOTE_COUNTER_PREFIX}:${getHourBucket()}`;

  try {
    // THE TTL IS ESTABLISHED BEFORE THE COUNTER MOVES, not after.
    //
    // This was incr-then-expire, and the two are not atomic: if the incr landed
    // and the expire did not, the key had no expiry and nothing would ever set
    // one (the expire only ran when incr returned exactly 1, which had already
    // happened). The bucket name carries the hour, so the result is that one
    // hour-of-history stays permanently at or above the cap -- a slot that can
    // never be reclaimed, for a counter whose whole purpose is to reset hourly.
    //
    // SET NX gives the key its TTL at creation. If the key already exists the
    // SET is a no-op and the TTL is already there; if this SET lands and the
    // INCR then fails, what is left is a zeroed counter that expires on time.
    // Neither order of failure can now produce an immortal key.
    await redis.set(key, 0, { ex: 70 * 60, nx: true }); // just over an hour, covers clock skew
    const current = await redis.incr(key);
    return current <= QUOTE_HOURLY_CAP;
  } catch {
    return true;
  }
}

async function getQuoteHourUsage(): Promise<number> {
  if (!redis) return 0;

  try {
    const current = await redis.get<number>(`${QUOTE_COUNTER_PREFIX}:${getHourBucket()}`);
    return typeof current === "number" && Number.isFinite(current) ? current : 0;
  } catch {
    return 0;
  }
}

async function isDateComplete(date: string): Promise<boolean> {
  if (!redis) return false;

  try {
    const hit = await redis.get(`${DAY_COMPLETE_PREFIX}:${date}`);
    return hit != null;
  } catch {
    return false;
  }
}

// Public wrapper so the earnings-calendar page can decide whether to grey out
// its "Backfill" button.
export async function isDateFullyPopulated(date: string): Promise<boolean> {
  return isDateComplete(date);
}

async function markDateComplete(date: string) {
  if (!redis) return;

  try {
    // A little longer than the quote cache's own TTL, so a date doesn't
    // briefly read as "complete" for a moment after its underlying quotes
    // have already expired -- it'll fall back to "incomplete" first and
    // get picked back up by the auto-populate loop.
    await redis.set(`${DAY_COMPLETE_PREFIX}:${date}`, 1, {
      ex: QUOTE_REVALIDATE_SECONDS + 2 * 24 * 60 * 60,
    });
  } catch {
    // best-effort
  }
}

// --- Materialised per-date row cache -------------------------------------

async function readDayItemsCache(date: string): Promise<EarningsListItem[] | null> {
  if (!redis) return null;
  try {
    const v = await redis.get<EarningsListItem[]>(`${DAY_ITEMS_PREFIX}:${date}`);
    if (Array.isArray(v)) return v;
  } catch {
    // fall through to a live rebuild
  }
  return null;
}

async function writeDayItemsCache(date: string, items: EarningsListItem[]) {
  if (!redis) return;
  try {
    await redis.set(`${DAY_ITEMS_PREFIX}:${date}`, items, {
      ex: QUOTE_REVALIDATE_SECONDS + 3 * 24 * 60 * 60,
    });
  } catch {
    // best-effort -- next view just rebuilds it
  }
}

// One row per symbol (a symbol repeated in FMP's feed collapses to the first
// seen), sorted by market cap descending -- largest companies first, unpriced
// rows (null cap) last. Applied on every serve, so even a blob materialised by
// older code (which could hold FMP's duplicate rows in raw feed order) still
// displays clean and correctly ordered.
function dedupeAndSortItems(items: EarningsListItem[]): EarningsListItem[] {
  const seen = new Set<string>();
  const out: EarningsListItem[] = [];
  for (const it of items) {
    const key = it.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  out.sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1));
  return out;
}

// Read-only accessor for a date's materialised rows -- used by the Show more
// pagination endpoint (app/api/earnings-calendar/day). Never quotes.
export async function getCachedDayItems(date: string): Promise<EarningsListItem[]> {
  return dedupeAndSortItems((await readDayItemsCache(date)) ?? []);
}

// --- Window completeness (read in ONE command, not one per date) ----------

/**
 * Which dates in the window are already marked complete.
 *
 * Returns null when the answer is UNKNOWN -- no Redis, or the read failed.
 * That distinction is the whole point of the return type. An empty Set says
 * "nothing in this window is done, go and fill all 91 dates"; a failed read
 * says nothing at all, and serving it AS an empty Set is the same defect this
 * file spent a release fixing on the day side.
 */
async function readWindowCompleteness(dates: string[]): Promise<Set<string> | null> {
  if (!redis || dates.length === 0) return null;
  try {
    const keys = dates.map((d) => `${DAY_COMPLETE_PREFIX}:${d}`);
    const vals = await redis.mget<unknown[]>(...keys);
    const done = new Set<string>();
    dates.forEach((d, i) => {
      if (vals?.[i] != null) done.add(d);
    });
    return done;
  } catch {
    return null;
  }
}

export type EarningsCandidate = {
  symbol: string;
  company: string;
  date: string;
  epsEstimated: number | null;
  epsActual: number | null;
  revenueEstimated: number | null;
  revenueActual: number | null;
};

export type EarningsListItem = EarningsCandidate & {
  price: number | null;
  marketCap: number | null;
  /**
   * Whether the bar source holds this symbol at all. See
   * lib/server/gridPriceCoverage.ts for why this is NOT a fifth tier of the
   * four market-cap refusals -- it says there is nothing to refuse.
   *
   * OPTIONAL, because rows cached before this existed do not carry it. Absent
   * is read as "covered" at the render site so an old blob keeps rendering what
   * it always did, rather than blanking a whole day's figures on deploy.
   */
  priceCoverage?: PriceCoverage;
};

export type FullDayEarnings = {
  date: string;
  items: EarningsListItem[];
  totalCandidates: number;
  usListedCount: number;
  complete: boolean;
};

export type RawEarningsRow = {
  symbol?: string;
  date?: string;
  epsActual?: number | string | null;
  epsEstimated?: number | string | null;
  revenueActual?: number | string | null;
  revenueEstimated?: number | string | null;
};

const MONTH_CACHE_MS = 6 * 60 * 60_000; // 6 hours -- FMP's own lastUpdated field is daily
const QUOTE_CONCURRENCY = 10;
const QUOTE_REVALIDATE_SECONDS = 30 * 24 * 60 * 60; // ~1 month, per site owner's request

// Safety ceiling on how many candidates a single date will ever quote -- far
// more than any real US-listed day sees, guards against a pathological feed.
const MAX_CANDIDATES_PER_DAY = 600;

// How many dates the background auto-populate loop will attempt per page load.
const AUTO_POPULATE_MAX_DATES = 2;

// How many candidates the *render path* will quote to paint a never-yet-seen
// date quickly (they're mega-cap-sorted, so this is the top of the list). The
// rest of the day is filled in the background / by owner Backfill -- this is
// the bound that stops a busy day blocking the page on hundreds of quotes.
const RENDER_SEED_LIMIT = 80;


// Same curated list used for search-result ranking in
// app/api/symbols/route.ts (POPULAR_SYMBOLS). Duplicated rather than
// imported so this file's cache lifetime isn't coupled to that route's --
// keep the two lists in sync if either changes.
const POPULAR_SYMBOLS = new Set([
  "AAPL", "ABBV", "ABT", "ADBE", "AMD", "AMZN", "ARM", "AVGO", "BA", "BAC",
  "BRK.B", "C", "CAT", "COIN", "COST", "CRM", "CSCO", "CVX", "DIA", "DIS",
  "F", "GE", "GM", "GOOG", "GOOGL", "GS", "HD", "IBM", "INTC", "IWM",
  "JNJ", "JPM", "KO", "LLY", "MA", "MCD", "META", "MRK", "MSFT", "MU",
  "NFLX", "NKE", "NVDA", "ORCL", "PEP", "PFE", "PG", "PLTR", "PYPL", "QCOM",
  "QQQ", "RIVN", "SBUX", "SHOP", "SMCI", "SNAP", "SOFI", "SPY", "T", "TGT",
  "TSLA", "TSM", "TXN", "UBER", "UNH", "V", "VZ", "WFC", "WMT", "XOM",
]);

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function popularRank(symbol: string) {
  return POPULAR_SYMBOLS.has(symbol) ? 0 : 1;
}

const monthCache = new Map<string, { at: number; rows: RawEarningsRow[] }>();
const candidatesCache = new Map<string, { at: number; byDate: Map<string, EarningsCandidate[]> }>();

// ─────────────────────────────────────────────────────────────────────────────
// THE PAGE CAP, AND WHY THE FIX IS SLICING RATHER THAN A BIGGER LIMIT.
//
// #410 added `limit=10000` to this fetch on the theory that the 4,000 rows
// February returned was FMP's default page. /api/debug/earnings-calendar-limit
// then answered, against 2026-02:
//
//     verdict: "limit-ignored: every limit returned the same rows"
//     limit=0      4000 rows  821,701 bytes  dateRange 2026-02-11 -> 2026-02-28
//     limit=4000   4000 rows  821,701 bytes  identical: true
//     limit=10000  4000 rows  821,701 bytes  identical: true
//     limit=20000  4000 rows  821,701 bytes  identical: true
//
// THE PARAMETER IS IGNORED. So `limit` is no longer sent: a request parameter
// that is provably ignored, with an assertion saying we send it, is a claim the
// code makes and cannot keep. The constant it becomes is the OBSERVED CAP,
// which is a fact about the endpoint rather than a wish about it.
//
// AND THE CAP DROPS THE OLDEST DATES, NOT THE NEWEST. We asked for 2026-02-01
// to 2026-02-28 and got 2026-02-11 to 2026-02-28. Ten days of peak Q4 season
// were silently absent and nothing in the response said so.
//
// THIS IS A PRODUCTION BUG, NOT A MEASUREMENT ONE. fetchMonthRows feeds the
// /earnings-calendar pages AND the earnings schedule index (#400,
// earningsSchedule.ts) that decides when a symbol's income statement, cash flow
// and dividends refresh. A symbol whose report date falls in a dropped window
// is invisible to that trigger: it does not refresh on filing, it waits for
// QUARTERLY_FLOOR_DAYS. That is the precise freeze the floor exists to bound,
// arriving through a door nobody checked -- and it is DORMANT until January,
// because every month between now and then is well under the cap. It would
// have surfaced in February as "some companies just stopped refreshing", with
// nothing pointing here.
//
// 4,000 exactly, observed 2026-09-03 and 2026-09-04. Not a guess and not ours.
export const EARNINGS_CALENDAR_PAGE_CAP = 4000;

// HOW MANY FETCHES ONE RANGE MAY COST, and why there is a bound at all. The
// split is binary over a date range, so a month needs at most log2(31) ~ 5
// levels and about 62 fetches even if EVERY slice is capped -- which would mean
// the endpoint had started returning 4,000 rows for a single day, i.e. the API
// changed under us. Bounding it turns that from a runaway into a recorded stop.
const MAX_CALENDAR_FETCHES = 40;

/**
 * Did this ONE FETCH come back at the page cap?
 *
 * NOT "is this month truncated" any more, and the rename is the point: after
 * slicing, a merged February is ~7,000 rows against a 4,000 cap, so the old
 * month-level test would have called every correctly-fetched month truncated.
 * A cap applies to a response, not to a range.
 *
 * PURE, so the invariant check can RUN it. `>=` rather than `===` because a
 * changed cap should still trip it -- the answer to "can I trust this page" is
 * no either way.
 */
export function isCappedPage(rowCount: number, pageCap = EARNINGS_CALENDAR_PAGE_CAP): boolean {
  if (!Number.isFinite(rowCount) || !Number.isFinite(pageCap) || pageCap <= 0) return true;
  return rowCount >= pageCap;
}

function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** The day halfway between two dates, floored. Equal dates return themselves. */
export function midpointDate(from: string, to: string): string {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return from;
  return addDays(from, Math.floor((b - a) / 86_400_000 / 2));
}

/**
 * Merge rows, keeping ONE per (symbol, date).
 *
 * TWO REASONS, and only the first is about slicing. Adjacent slices deliberately
 * OVERLAP by a day (see fetchCalendarRange), so a boundary date arrives twice
 * and would be counted twice by everything downstream -- including the
 * concentration measurement this whole thread exists to fix. Same hazard
 * historyCache.ts's collapseDuplicateDates was written for.
 *
 * The second is that the FEED ITSELF repeats: this module's own
 * getCandidatesByDate already says "earnings-calendar routinely repeats a
 * symbol -- several rows on the same date... which surfaced as duplicate table
 * rows (e.g. JOE listed 2-4x on 29-31 Jul)". So duplicates are not new, they
 * were being collapsed one layer up, and collapsing them here is strictly
 * closer to the truth for every consumer: the calendar page collapses per
 * symbol anyway, the schedule index reads only dates, and the concentration
 * route de-duplicates internally.
 *
 * RICHEST WINS, ties to first seen -- the same rule getCandidatesByDate already
 * applies ("keep the single best entry: most data"). Taking whichever arrived
 * last would let a sparser duplicate erase a populated row.
 */
export function mergeCalendarRows(
  into: Map<string, RawEarningsRow>,
  rows: RawEarningsRow[]
): void {
  const filled = (row: RawEarningsRow) =>
    [row.epsActual, row.epsEstimated, row.revenueActual, row.revenueEstimated].filter(
      (v) => v !== null && v !== undefined && v !== ""
    ).length;

  for (const row of rows) {
    const symbol = String(row?.symbol ?? "").trim().toUpperCase();
    const date = String(row?.date ?? "").slice(0, 10);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const key = `${symbol}|${date}`;
    const existing = into.get(key);
    if (!existing || filled(row) > filled(existing)) into.set(key, row);
  }
}

export type CalendarSlice = { from: string; to: string; rows: number; capped: boolean };

export type CalendarRangeResult = {
  rows: RawEarningsRow[];
  /** Every fetch made, in order, so the split is visible rather than inferred. */
  slices: CalendarSlice[];
  fetches: number;
  /** Bytes as transferred, summed across slices -- including capped ones. */
  bytes: number;
  /**
   * Days that came back AT the cap and cannot be split further. Should be
   * empty forever; if it is not, the cap or the API changed.
   */
  cappedDays: string[];
  /** Set when the fetch budget or the FMP minute budget ended the walk. */
  stoppedEarly: string | null;
  /**
   * Slices whose fetch did not come back -- a non-ok status or a thrown fetch.
   *
   * THE DIFFERENCE BETWEEN AN EMPTY MONTH AND AN UNREADABLE ONE, which nothing
   * recorded before. Both produce `rows: []`, and a reader that cannot tell them
   * apart treats "we could not see this month" as "nobody reports this month".
   * That is what stranded the fill frontier in production.
   */
  sliceFailures: number;
};

/**
 * Fetch a date range, splitting whenever a response comes back at the cap.
 *
 * WHY ADAPTIVE RATHER THAN A FIXED "TWO HALVES PER MONTH". A fixed split
 * hard-codes today's cap and today's report density. FMP can change the cap and
 * a heavier season can breach it again -- at which point a fixed split fails
 * exactly the way the unsliced code did, silently. Detection drives the split,
 * so the code self-corrects: a quiet month costs one fetch, and a February
 * costs as many as its density needs.
 *
 * THE SLICES OVERLAP BY A DAY, DELIBERATELY, and that is instead of assuming an
 * answer about `from`. `to` is demonstrably inclusive -- we asked for
 * 2026-02-28 and got rows dated 2026-02-28 -- but nothing observed so far
 * settles `from`, and this sandbox cannot ask FMP. An overlap is correct under
 * BOTH readings: if `from` is inclusive the shared day arrives twice and is
 * de-duplicated, and if it is exclusive the shared day still arrives once from
 * the earlier slice. Assuming inclusivity and being wrong would drop one day
 * per boundary -- the same silent hole, in smaller pieces.
 *
 * CAPPED ROWS ARE KEPT, NOT DISCARDED. A capped page is incomplete, not wrong;
 * its rows are real and the halves' rows merge over them. Throwing them away
 * would pay for the fetch and bin the data.
 */
export async function fetchCalendarRange(
  from: string,
  to: string,
  options: { pageCap?: number; apiKey?: string } = {}
): Promise<CalendarRangeResult> {
  const pageCap = options.pageCap ?? EARNINGS_CALENDAR_PAGE_CAP;
  const apiKey = options.apiKey ?? process.env.FMP_API_KEY ?? "";
  const merged = new Map<string, RawEarningsRow>();
  const result: CalendarRangeResult = {
    rows: [],
    slices: [],
    fetches: 0,
    bytes: 0,
    cappedDays: [],
    stoppedEarly: null,
    sliceFailures: 0,
  };
  if (!apiKey) {
    result.stoppedEarly = "no-api-key";
    return result;
  }

  const walk = async (sliceFrom: string, sliceTo: string): Promise<void> => {
    if (result.stoppedEarly) return;
    if (result.fetches >= MAX_CALENDAR_FETCHES) {
      result.stoppedEarly = `fetch-budget:${MAX_CALENDAR_FETCHES}`;
      return;
    }

    // COUNTED AGAINST THE MINUTE BUDGET. This fetch never was: fmpFetch records
    // BYTES for the usage meter but does not reserve a call slot, so the
    // calendar has been spending the plan's rate limit invisibly. One
    // unreserved call a day was easy to overlook; several per month, several
    // months per schedule rebuild, is not -- and the warm jobs compute their
    // own backoff from that counter, so an invisible call makes their pacing
    // wrong in the direction of overspending.
    try {
      await reserveFmpCallSlot();
    } catch {
      // Out of budget rather than out of data. Keep what merged so far and say
      // why -- a partial month with a reason beats an empty one with none.
      result.stoppedEarly = "fmp-capacity";
      return;
    }

    // THE SAFETY DAY, for the `from` question above.
    const requestFrom = addDays(sliceFrom, -1);
    let rows: RawEarningsRow[] = [];
    try {
      const res = await fmpFetch(
        `https://financialmodelingprep.com/stable/earnings-calendar?from=${requestFrom}&to=${sliceTo}&apikey=${apiKey}`,
        { next: { revalidate: MONTH_CACHE_MS / 1000 } }
      );
      result.fetches++;
      if (!res.ok) throw new Error(`earnings-calendar failed: ${res.status}`);
      const text = await res.text();
      result.bytes += text.length;
      const json = JSON.parse(text);
      rows = Array.isArray(json) ? (json as RawEarningsRow[]) : [];
    } catch {
      // One bad slice must not lose the rest of the range -- but it must be
      // COUNTED, or the caller cannot tell a month nobody reports in from a
      // month that could not be read.
      result.sliceFailures++;
      result.slices.push({ from: sliceFrom, to: sliceTo, rows: 0, capped: false });
      return;
    }

    mergeCalendarRows(merged, rows);
    const capped = isCappedPage(rows.length, pageCap);
    result.slices.push({ from: sliceFrom, to: sliceTo, rows: rows.length, capped });
    if (!capped) return;

    // THE FLOOR OF THE RECURSION. A single day cannot be split, so a day at the
    // cap is a day we cannot read completely -- and it must SAY so rather than
    // returning short as though it were whole. It should be unreachable: the
    // busiest day measured is 710 symbols against a 4,000 cap, so a capped day
    // means the cap moved or the endpoint changed.
    if (sliceFrom === sliceTo) {
      result.cappedDays.push(sliceFrom);
      console.error(
        `[earnings-calendar] ${sliceFrom} returned ${rows.length} rows at the ${pageCap} ` +
          `page cap and CANNOT BE SPLIT FURTHER. That day is incomplete and every ` +
          `count derived from it is a floor. The cap or the endpoint has changed -- ` +
          `re-run /api/debug/earnings-calendar-limit.`
      );
      return;
    }

    const mid = midpointDate(sliceFrom, sliceTo);
    await walk(sliceFrom, mid);
    await walk(addDays(mid, 1), sliceTo);
  };

  await walk(from, to);

  // TRIMMED BACK TO WHAT WAS ASKED FOR. The safety day pulls in a row from the
  // day before the range; the caller asked for a month and the cache is keyed
  // by month.
  result.rows = [...merged.values()].filter((row) => {
    const date = String(row?.date ?? "").slice(0, 10);
    return date >= from && date <= to;
  });
  return result;
}

export type FetchMonthOptions = {
  /**
   * Skip the shared reference cache and go to FMP.
   *
   * EXISTS FOR THE RE-MEASUREMENT, and it is not a convenience. The reference
   * key holds a DAILY TTL, so the truncated 4,000-row February written on
   * 2026-09-03 would be served for another 24 hours -- a re-run of the probe
   * after fixing the fetch would read the same truncated month and report that
   * the fix did nothing. A fix that looks like a failure for a day is how a
   * correct change gets reverted.
   *
   * Still WRITES what it fetches, so the site gets the better data too.
   */
  bypassCache?: boolean;
  /** Override the observed page cap. Only the probes pass this. */
  pageCap?: number;
};

export type MonthFetchResult = CalendarRangeResult & { month: string; fromCache: boolean };

// ── PER-MONTH VISIBILITY ────────────────────────────────────────────────────
//
// "known"   the month's feed was actually read -- from the in-process cache, the
//           shared reference copy, or a clean fetch. Its dates can be trusted,
//           including when it lists nobody.
// "unknown" the feed could not be read. Its dates say nothing at all.
//
// WHY THIS IS NOT THE SAME QUESTION AS "DID THIS MONTH HAVE CANDIDATES".
// findNextIncompleteDate used to ask only whether it had seen candidates
// ANYWHERE in the window, which the near month satisfies on its own. In
// production the near month read fine and was already filled while the later
// in-window months were cold, so every date in them looked like a day nobody
// reports, the walk ran to the end, and the pointer parked past all of them at
// 2027-01-01 with 59 dates still unfilled behind it. Reproduced in
// scripts/check-earnings-failure-not-absence.mjs §6b.
//
// A month that could not be read is UNKNOWN, and a scan must not advance past
// unknown. Per instance, like monthCache, because that is where the read
// happened.
const monthVisibility = new Map<string, "known" | "unknown">();

export function getMonthVisibility(year: number, month: number): "known" | "unknown" | "unseen" {
  return monthVisibility.get(monthKey(year, month)) ?? "unseen";
}

/** The detailed form, for the probes. fetchMonthRows is this minus the detail. */
export async function fetchMonthRowsDetailed(
  year: number,
  month: number,
  options: FetchMonthOptions = {}
): Promise<MonthFetchResult> {
  const key = monthKey(year, month);
  const empty = (rows: RawEarningsRow[], fromCache: boolean): MonthFetchResult => ({
    month: key,
    fromCache,
    rows,
    slices: [],
    fetches: 0,
    bytes: 0,
    cappedDays: [],
    stoppedEarly: null,
    sliceFailures: 0,
  });

  const cached = monthCache.get(key);
  if (!options.bypassCache && cached && Date.now() - cached.at < MONTH_CACHE_MS) {
    monthVisibility.set(key, "known");
    return empty(cached.rows, true);
  }

  // REDIS BETWEEN THE MODULE CACHE AND FMP. The Map above is per-instance, so
  // before this every cold lambda refetched the whole month.
  //
  // ── AND IT IS READ BEFORE THE KEY IS ASKED FOR ────────────────────────────
  // The no-key return below used to sit ABOVE this read. A cold lambda with a
  // lapsed or unset FMP_API_KEY then answered "unknown, no rows" for a month
  // Redis was holding — the shared copy is a real read that needs no key, and
  // the order made it unreachable exactly when FMP is gone, which is the case
  // it matters for. check-month-rows-without-key asserts the order with the key
  // unset and the month in Redis.
  if (!options.bypassCache) {
    const shared = await readReference<RawEarningsRow[]>(`earnings-calendar:${key}`);
    // Same refusal as the write side below and as getMonthCandidates: an empty
    // array read back is not an answer to hold for six hours. Writing empty is
    // already refused, so this should be unreachable -- it is here because "should
    // be unreachable" is what the in-process candidate cache also assumed.
    if (Array.isArray(shared) && shared.length > 0) {
      monthCache.set(key, { at: Date.now(), rows: shared });
      monthVisibility.set(key, "known");
      return empty(shared, true);
    }
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    // No key means no way to read a month that neither cache holds. A cached
    // copy — in-process, even past its TTL, or the shared one above — is still
    // a real read; nothing else is.
    monthVisibility.set(key, cached ? "known" : "unknown");
    return empty(cached?.rows ?? [], Boolean(cached));
  }

  const from = `${key}-01`;
  const to = `${key}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  const result = await fetchCalendarRange(from, to, { pageCap: options.pageCap, apiKey });

  // A month is only known if every slice of it came back. A partial read is not
  // a smaller month -- it is a month with holes, and the holes look like dates
  // nobody reports on.
  monthVisibility.set(key, result.sliceFailures > 0 ? "unknown" : "known");

  if (result.rows.length) {
    monthCache.set(key, { at: Date.now(), rows: result.rows });
    // EMPTY IS NOT CACHED. A failed or restricted response parses to [] here,
    // and storing that for a day would blank every calendar consumer until it
    // expired -- an absence held as though it were an answer.
    await writeReference(`earnings-calendar:${key}`, result.rows, REFERENCE_TTL_DAILY_SECONDS);
  }
  return { ...result, month: key, fromCache: false };
}

export async function fetchMonthRows(
  year: number,
  month: number,
  options: FetchMonthOptions = {}
): Promise<RawEarningsRow[]> {
  return (await fetchMonthRowsDetailed(year, month, options)).rows;
}

// Builds, per date-in-month, the full candidate list (SEC announcements,
// SEC-admitted, named, coarse-sorted) -- but does NOT quote anything. One
// HGETALL per month build (cached), no per-symbol cost.
async function getMonthCandidates(year: number, month: number): Promise<Map<string, EarningsCandidate[]>> {
  const key = monthKey(year, month);
  const cached = candidatesCache.get(key);
  if (cached && Date.now() - cached.at < MONTH_CACHE_MS) return cached.byDate;

  // ── SEC'S OWN ANNOUNCEMENTS, NOT FMP'S CALENDAR (#535 COWORK #18 §3) ─────
  // Candidates: the day index the report-dates job writes (an Item 2.02 8-K,
  // or today's pending announcement), one HGETALL. Admission: a Nasdaq or NYSE
  // listing in SEC's own ticker file — the record itself exists only for a
  // tracked filer, so "in the manifest AND on an SEC exchange". Names: the
  // committed directory snapshot, else SEC's. No estimates: SEC publishes
  // none, and the columns are hidden (EarningsDayList).
  const index = await readResultsDays();
  const byDate = new Map<string, EarningsCandidate[]>();
  if (!index) return byDate; // unreadable is not "nobody reported": not cached below
  const prefix = `${year}-${pad2(month)}-`;
  for (const [date, symbols] of symbolsByDay(index, gridAdmits)) {
    if (!date.startsWith(prefix)) continue;
    const list: EarningsCandidate[] = [];
    for (const symbol of symbols) {
      const company = gridCompanyName(symbol);
      if (!company) continue;
      list.push({ symbol, company, date, epsEstimated: null, epsActual: null, revenueEstimated: null, revenueActual: null });
    }
    list.sort((a, b) => popularRank(a.symbol) - popularRank(b.symbol));
    if (list.length) byDate.set(date, list);
  }

  // EMPTY IS NOT CACHED, as before: a month with no reporters anywhere is not
  // a real state, and a per-instance cache of it would outlive the outage.
  if (byDate.size > 0) {
    candidatesCache.set(key, { at: Date.now(), byDate });
  }
  return byDate;
}

// Which in-month dates have at least one company reporting. The calendar grid
// shows only a presence dot (no number), so this never needs a quote or a
// stored tally -- it's derived straight from the free, already-cached monthly
// candidate feed. Nothing to over-count, nothing to self-correct.
export async function getMonthDaysWithEarnings(year: number, month: number): Promise<Set<string>> {
  const byDate = await getMonthCandidates(year, month);
  const days = new Set<string>();
  for (const [date, list] of byDate) {
    if (list.length > 0) days.add(date);
  }
  return days;
}

async function getDayCandidates(date: string): Promise<EarningsCandidate[]> {
  const [yearStr, monthStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return [];
  const byDate = await getMonthCandidates(year, month);
  return byDate.get(date) ?? [];
}

// How many companies are (estimated to be) reporting on a date, without
// quoting -- used by the page to decide whether the Backfill button has
// anything to do.
export async function getDayCandidateCount(date: string): Promise<number> {
  return (await getDayCandidates(date)).length;
}

type QuoteResult = {
  price: number | null;
  marketCap: number | null;
  exchange: string | null;
  // True when this symbol was skipped because the hourly cap was already
  // spent (and bypassCap wasn't set). Used only to decide whether a date can
  // be marked "complete"; never shown in the UI.
  capped: boolean;
  // True when the quote was ATTEMPTED and did not come back — a non-ok status
  // (401/402/403/5xx) or a thrown fetch.
  //
  // THE ROOT CAUSE THIS EXISTS TO FIX. Every one of those used to return the
  // same shape as a successful quote for a company with no exchange: nulls and
  // capped:false. `capped` was the only signal the completeness test read, so
  // "every quote failed" and "every quote succeeded, none were US-listed" were
  // indistinguishable — and the second is a legitimate empty that gets cached
  // and marked complete. A dead provider therefore wrote an empty day and
  // flagged it done for 32 days. Reproduced 2026-09-14.
  //
  // A missing quote is NOT the same fact as an absent company, and the two must
  // never again share a representation. This survives the FMP removal: the
  // SEC-fed calendar has the same shape and the same trap.
  failed: boolean;
  // True when price/marketCap came free from the shared site-wide price pool
  // (a universe symbol). The pool carries no exchange, but every universe
  // symbol is US-listed by construction, so this stands in for the exchange
  // check below.
  usOk?: boolean;
};

async function quoteOne(symbol: string, bypassCap: boolean): Promise<QuoteResult> {
  const apiKey = process.env.FMP_API_KEY;
  // NO KEY IS NO PRICE, NOT A FAILURE — since the grid moved to SEC's own
  // announcements (#535 COWORK #18 §3). A row is admitted by SEC's ticker file
  // before any quote, so a missing quote no longer hides whether the company
  // is US-listed; it only leaves price and market cap as "—" (owner ruling,
  // COWORK #23: off-pool shows "—"). With FMP_API_KEY unset the page renders
  // and every date can settle. A key that is SET and answers badly is still a
  // failure below, and still keeps its date from settling.
  if (!apiKey) return { price: null, marketCap: null, exchange: null, capped: false, failed: false };

  // Symbols already quoted within the fetch-cache window don't spend an
  // hourly slot -- only genuinely new symbols compete for the cap.
  const alreadyQuoted = await wasRecentlyQuoted(symbol);
  if (!alreadyQuoted) {
    const allowed = await reserveQuoteSlot();
    if (!allowed && !bypassCap) {
      // Capped, not failed: a deliberate decision not to call, already handled.
      return { price: null, marketCap: null, exchange: null, capped: true, failed: false };
    }

    // Site-wide FMP account budget (~300 calls/minute across every FMP-calling
    // route). Only a genuinely new symbol makes a real FMP call, so only it
    // needs a budget slot. Already-quoted symbols resolve from Next's Data
    // Cache below without hitting FMP -- making them queue behind the budget
    // too is what made heavy, mostly-cached days take 10-15s to render.
    try {
      await reserveFmpCallSlot();
    } catch {
      // Also a throttle rather than an upstream failure — the call was never made.
      return { price: null, marketCap: null, exchange: null, capped: true, failed: false };
    }
  }

  try {
    const res = await fmpFetch(
      `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
      { next: { revalidate: QUOTE_REVALIDATE_SECONDS } }
    );
    // THE LAPSED-LICENCE SHAPE. A dead or downgraded key answers 401/402/403
    // with a JSON body, which is a perfectly well-formed HTTP response — there
    // is no exception to catch, which is exactly why this read as success.
    if (!res.ok) return { price: null, marketCap: null, exchange: null, capped: false, failed: true };
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;

    if (!alreadyQuoted) await markQuoted(symbol);

    return {
      price: num(row?.price),
      marketCap: num(row?.marketCap),
      exchange: str(row?.exchange),
      capped: false,
      failed: false,
    };
  } catch {
    return { price: null, marketCap: null, exchange: null, capped: false, failed: true };
  }
}

// Normalize a symbol the same way the price pool keys it, so a pool lookup hits.
function normSymbol(s: string) {
  return s.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

async function quoteBatch(symbols: string[], bypassCap: boolean): Promise<Record<string, QuoteResult>> {
  const results: Record<string, QuoteResult> = {};

  // Shared-cache fast path: any reporting company that's in the site-wide
  // rolling universe already has a ~15-min-fresh price + market cap in the
  // price pool (msh:price-pool:v1). Serve those for FREE -- no per-symbol FMP
  // /quote call and no hourly-cap slot -- so the cap is reserved for the
  // small-cap long tail that isn't cached anywhere. One bulk HMGET total.
  const poolHits = new Set<string>();
  try {
    const pool = await readPricePoolBulk(symbols);
    for (const symbol of symbols) {
      const p = pool.get(normSymbol(symbol));
      if (p && p.price != null) {
        results[symbol] = {
          price: p.price,
          marketCap: p.marketCap,
          exchange: null,
          usOk: true, // universe symbols are US-listed by construction
          capped: false,
          failed: false,
        };
        poolHits.add(symbol);
      }
    }
  } catch {
    // fall through -- a pool read failure just means we quote everything
  }

  const remaining = symbols.filter((symbol) => !poolHits.has(symbol));
  for (let i = 0; i < remaining.length; i += QUOTE_CONCURRENCY) {
    const slice = remaining.slice(i, i + QUOTE_CONCURRENCY);
    const quotes = await Promise.all(slice.map((symbol) => quoteOne(symbol, bypassCap)));
    slice.forEach((symbol, idx) => {
      results[symbol] = quotes[idx];
    });
  }
  return results;
}

// The one function that spends real, per-symbol API calls. Quotes *every*
// candidate for the date (no 100-cap / no pagination -- the whole US-listed
// set for a day is shown at once), further capped globally by QUOTE_HOURLY_CAP
// new symbols per hour unless opts.bypassCap is set. Marks the date complete
// (and stores its accurate US count + assembled rows) when every candidate
// was quoted with nothing skipped by the cap.
//
// Fast path: a fully-populated date serves its cached assembled rows in a
// single Redis read. Pass opts.forceRefresh to skip that and re-quote (used
// by the auto-populate loop and the owner backfill).
export async function getFullDayEarnings(
  date: string,
  opts: { bypassCap?: boolean; forceRefresh?: boolean; maxQuote?: number } = {}
): Promise<FullDayEarnings> {
  const bypassCap = opts.bypassCap ?? false;
  const forceRefresh = opts.forceRefresh ?? false;

  const allCandidates = await getDayCandidates(date);
  const totalCandidates = allCandidates.length;

  if (totalCandidates === 0) {
    return { date, items: [], totalCandidates: 0, usListedCount: 0, complete: false };
  }

  // Fast path: any materialised rows (partial OR full) are served straight
  // from Redis with zero quoting. This is what keeps changing dates instant --
  // the render never re-quotes a date it has already touched.
  if (!forceRefresh) {
    const cachedItems = await readDayItemsCache(date);
    // AN EMPTY BLOB IS ONLY A HIT WHERE EMPTY IS THE TRUE ANSWER. `[]` is
    // truthy, so this used to serve a stored empty day as a populated one --
    // which is what made the poisoned entry stick for its full 33 days rather
    // than being rebuilt on the next render.
    //
    // WHAT MAKES AN EMPTY DAY TRUE: either the feed lists nobody, or the day was
    // fully quoted with nothing failing and nobody turned out to be US-listed.
    // The second is what the completeness flag now means, and ONLY because F1
    // and the write guard below stop that flag being set over a failure. The
    // coupling is deliberate and load-bearing in both directions: if F1 ever
    // regresses, a poisoned empty becomes servable again from here. §4 of the
    // check pins the write half; this line is the read half of the same rule.
    const emptyIsSettled =
      cachedItems != null &&
      (cachedItems.length > 0 || totalCandidates === 0 || (await isDateComplete(date)));
    if (cachedItems && emptyIsSettled) {
      const cleaned = dedupeAndSortItems(cachedItems);
      // Persist the cleaned blob if the stored copy carried duplicate rows, so
      // the fix sticks and Show more paginates the deduped set -- no re-quoting.
      if (cleaned.length !== cachedItems.length) {
        await writeDayItemsCache(date, cleaned);
      }
      return {
        date,
        items: cleaned,
        totalCandidates,
        usListedCount: cleaned.length,
        complete: await isDateComplete(date),
      };
    }
  }

  // No materialised rows yet. Quote at most maxQuote candidates (mega-cap
  // sorted): the render path passes a small seed so a never-seen date still
  // paints in well under a second, while the background job and owner Backfill
  // pass no limit and finish the whole set off.
  const limit = Math.min(opts.maxQuote ?? MAX_CANDIDATES_PER_DAY, MAX_CANDIDATES_PER_DAY);
  const candidates = allCandidates.slice(0, limit);
  const quotedEveryCandidate = candidates.length >= Math.min(totalCandidates, MAX_CANDIDATES_PER_DAY);

  const quotes = await quoteBatch(candidates.map((c) => c.symbol), bypassCap);

  let anyCapped = false;
  let anyFailed = false;
  const rawItems: EarningsListItem[] = candidates
    .map((candidate): EarningsListItem | null => {
      const quote = quotes[candidate.symbol];
      if (quote?.capped) anyCapped = true;
      // A candidate whose quote never came back cannot be judged US-listed or
      // not, so the date it belongs to is not finished being built.
      if (quote?.failed) anyFailed = true;
      // ADMITTED UPSTREAM, BY SEC'S OWN TICKER FILE (gridAdmits: Nasdaq or
      // NYSE), before any quote. The quote only prices the row now; it no
      // longer decides whether the row exists.
      return {
        ...candidate,
        price: quote?.price ?? null,
        marketCap: quote?.marketCap ?? null,
        // `usOk` IS the pool hit: it is set only on the branch that reads the
        // shared price pool, which is the bar source the analysis universe is
        // warmed into. Reusing it here keeps one fact with one producer rather
        // than adding a second, separately-maintained universe test.
        priceCoverage: priceCoverage({ fromPricePool: Boolean(quote?.usOk) }),
      };
    })
    .filter((item): item is EarningsListItem => item !== null);
  const items = dedupeAndSortItems(rawItems);

  // ── THE WRITE GUARD ────────────────────────────────────────────────────
  //
  // THE SAME FAILURE, IN THE SAME REPO, SOLVED ONCE ALREADY. benchmarksBuilder.ts
  // carries hasRealData() for precisely this: "A payload whose every row is null
  // is what a total FMP failure produces. It must never be cached: before this
  // module had a shared cache it poisoned one instance for 5 minutes, but writing
  // it to Redis would poison EVERY instance, and for as long as the entry lives."
  // This module had a shared cache and no such check, so it did exactly that --
  // for 33 days rather than 5 minutes.
  //
  // THE CANDIDATE COUNT IS THE DISCRIMINATOR, NOT THE ITEM COUNT. A date with no
  // candidates at all is a legitimate empty: a weekend, a holiday, a day nobody
  // reports. It should be cached, and it is. A date whose own month feed lists
  // companies, which resolves to zero rows, is contradicting itself.
  //
  // TRADE-OFF, ACCEPTED DELIBERATELY: a date whose candidates are genuinely all
  // non-US-listed also resolves to zero rows against a positive candidate count,
  // so it is re-quoted on every render instead of settling. That costs repeated
  // work on a rare kind of date. It is the right side to err on -- the other side
  // publishes an empty day as fact -- but it IS a cost, not a free win.
  // REFINED ONTO anyFailed once F1 existed. The candidate count was the
  // discriminator only because, before F1, there was no way to tell a failed
  // quote from a company with no exchange -- so "empty against a positive
  // candidate count" was the best available proxy for "something went wrong".
  //
  // With F1 landed the real question is answerable directly, and the proxy is
  // now too broad: a date whose candidates are genuinely all non-US-listed is a
  // LEGITIMATE terminal state. Under the candidate-count form it could never
  // settle and was re-quoted on every render, forever. Only an empty day we
  // could not fully SEE is poison.
  const emptyAndUnverifiable = items.length === 0 && totalCandidates > 0 && anyFailed;

  if (!emptyAndUnverifiable) {
    // Materialise what we have, so the next render -- and Show more -- read it
    // back instead of re-quoting.
    await writeDayItemsCache(date, items);
  }

  // Only "complete" once every candidate was quoted, nothing skipped by the cap,
  // and NOTHING FAILED. A bounded seed render is never complete. `!anyFailed`
  // already implies `!emptyAndUnverifiable`, so the latter is not repeated here
  // -- a second term that can never independently fire reads as a guard and is
  // not one.
  const complete = quotedEveryCandidate && !anyCapped && !anyFailed;
  if (complete) {
    await markDateComplete(date);
  }

  return { date, items, totalCandidates, usListedCount: items.length, complete };
}

// Render-path entry point: serves any materialised rows instantly, or paints a
// bounded seed (top RENDER_SEED_LIMIT candidates) for a never-seen date so the
// page never blocks on hundreds of quotes. The rest is filled in the
// background (see the page's after() -> getFullDayEarnings forceRefresh) and by
// owner Backfill.
export async function getDayEarningsForRender(date: string): Promise<FullDayEarnings> {
  return getFullDayEarnings(date, { maxQuote: RENDER_SEED_LIMIT });
}

// Returns the newest date in the window that still has candidates left to
// quote, or null when there is nothing to do. Dates with no reporters at all
// (weekends, holidays) are skipped.
//
// ── NEWEST FIRST, AND NO POINTER ───────────────────────────────────────────
// The old walk ran front-to-back from a stored "fill frontier", because the
// front edge of the window was the near future and that is where new dates
// appeared. Inverting the window inverts both halves of that:
//
//   PRIORITY. New dates now appear at the BACK edge (today), and that is also
//   the end a visitor lands on. A front-to-back walk over a backward window
//   spends the hourly quote budget on dates three months old while today sits
//   empty. So the walk runs newest first.
//
//   THE POINTER IS GONE, NOT REVERSED. It existed so a finished window cost one
//   Redis read instead of ~126, and it is what produced the production incident
//   this file's last release was about: a single dead-FMP render parked it at
//   2027-01-01, past the window end, with 59 in-window dates unfilled behind
//   it; forward-only movement and no TTL meant it never recovered on its own.
//   A batched MGET over the window's completeness keys buys the same saving --
//   ONE command for the whole window, same as the pointer -- and there is no
//   state left to strand. Deleting the failure mode beats guarding it.
//
// Past dates settle, so a date marked complete stays complete and this walk is
// monotone: it shortens every day by one and grows by one.
async function findNextIncompleteDate(): Promise<string | null> {
  const startStr = getWindowStartDate();
  const endStr = getWindowEndDate();
  const startTime = new Date(`${startStr}T00:00:00Z`).getTime();

  const dates: string[] = [];
  for (let t = new Date(`${endStr}T00:00:00Z`).getTime(); t >= startTime; t -= 86_400_000) {
    dates.push(toDateStr(new Date(t)));
  }

  // ── AN UNREADABLE COMPLETENESS MAP IS NOT AN EMPTY ONE ────────────────────
  // Treating a failed read as "nothing is complete" would send the scan to
  // re-quote all 91 dates on a Redis blip. Doing nothing this round costs one
  // five-minute scan slot and is recoverable; the other is not.
  const completed = await readWindowCompleteness(dates);
  if (!completed) {
    console.error(
      `[earnings-calendar] could not read which of ${startStr}..${endStr} are complete, so ` +
        `which dates have work outstanding is UNKNOWN rather than "all of them". Skipping this ` +
        `scan rather than re-quoting the whole window.`
    );
    return null;
  }

  // WHETHER THE SCAN SAW ANY CANDIDATES AT ALL, anywhere in the window.
  let sawAnyCandidates = false;
  const unreadableMonths = new Set<string>();

  for (const ds of dates) {
    const d = new Date(`${ds}T00:00:00Z`);

    // getDayCandidates resolves the whole month behind this date, so asking for
    // any date in the month is what populates its visibility.
    const candidates = await getDayCandidates(ds);
    if (getMonthVisibility(d.getUTCFullYear(), d.getUTCMonth() + 1) === "unknown") {
      // ── DIAGNOSTIC, NOT LOAD-BEARING, AND SAY SO ────────────────────────
      // Under the pointer this branch was the guard: it stopped the scan dead,
      // because advancing past an unreadable month parked the pointer past 59
      // real dates. Deleting the pointer took the danger with it, and this
      // branch with it -- an unreadable month yields [] for every one of its
      // dates, so the emptiness check below skips them anyway.
      //
      // What is left is the distinction itself. "We could not read August" and
      // "nobody reported in August" produce identical data and mean opposite
      // things, and this is the only place that difference is recorded. Safety
      // now comes from the STRUCTURE: the walk only ever returns a date with
      // candidates, so a month with none is never quoted, never marked, and
      // arrives whole when the feed does. Do not re-add a stop here on the
      // belief that this is still a guard.
      unreadableMonths.add(monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1));
      continue;
    }

    if (candidates.length === 0) continue;
    sawAnyCandidates = true;
    if (!completed.has(ds)) return ds;
  }

  if (unreadableMonths.size > 0) {
    console.error(
      `[earnings-calendar] ${[...unreadableMonths].sort().join(", ")} could not be read. Their ` +
        `dates are UNKNOWN, not empty, and were skipped rather than counted as having no ` +
        `reporters. Nothing marks them done; they fill when the feed recovers.`
    );
  }

  // A whole window with not one reporting company on any of ~91 readable days
  // is not a real market state; it is the provider being gone. There is no
  // longer any state to corrupt by getting this wrong -- the scan simply found
  // nothing -- but it is still the difference between "quiet" and "dead", and
  // it is the only place that difference is visible.
  if (!sawAnyCandidates) {
    console.error(
      `[earnings-calendar] scanned ${endStr}..${startStr} and found NO candidates on any ` +
        `readable date. That is a dead upstream feed, not an empty market.`
    );
  }
  return null;
}

// Finds and populates the next not-yet-complete date(s) in the window, front-
// to-back. Called fire-and-forget from every real page load (respecting the
// hourly cap) and directly with bypassCap:true from the owner Backfill route.
// ─────────────────────────────────────────────────────────────────────────────
// ONE BACKGROUND SCAN PER WINDOW, NOT ONE PER VISITOR.
//
// /earnings-calendar runs populateNextMissingDate in after() on every request.
// In steady state that is cheap -- the frontier is parked past the window end,
// so the scan loop runs zero times and the whole thing is three commands.
//
// THE COST IS AT THE MOMENT THE WINDOW ROLLS FORWARD. Then every concurrent
// visitor starts walking the frontier and calling getFullDayEarnings against
// the SAME dates: the same Redis reads, the same writes, the same work, N
// times over. QUOTE_HOURLY_CAP bounds the FMP side globally and nothing bounded
// the rest.
//
// Five minutes because the window moves once a day. A scan that runs 288 times
// a day instead of once per visitor is already the whole win, and a shorter
// gate buys nothing the frontier does not already give.
const CALENDAR_SCAN_GATE_KEY = "msh:earnings-cal:scan-gate:v1";
const CALENDAR_SCAN_GATE_SECONDS = 5 * 60;

/**
 * Claim the right to run the background fill. True for at most one caller per
 * CALENDAR_SCAN_GATE_SECONDS.
 *
 * SET NX makes the claim and the test one round trip, so two instances cannot
 * both win it. Fails CLOSED with no Redis -- without a shared marker there is
 * nothing to serialise on, and an ungated scan is what this exists to stop.
 */
export async function claimCalendarScan(nowMs = Date.now()): Promise<boolean> {
  if (!redis) return false;
  try {
    const res = await redis.set(CALENDAR_SCAN_GATE_KEY, String(nowMs), {
      ex: CALENDAR_SCAN_GATE_SECONDS,
      nx: true,
    });
    return res === "OK";
  } catch {
    return false;
  }
}

export async function populateNextMissingDate(
  opts: { bypassCap?: boolean; maxDates?: number } = {}
): Promise<{ populated: string[] }> {
  const bypassCap = opts.bypassCap ?? false;
  const maxDates = opts.maxDates ?? AUTO_POPULATE_MAX_DATES;
  const populated: string[] = [];

  for (let i = 0; i < maxDates; i++) {
    if (!bypassCap) {
      const usage = await getQuoteHourUsage();
      // This hour's budget is already spent -- stop rather than queue up
      // FMP calls that'll just come back capped anyway.
      if (usage >= QUOTE_HOURLY_CAP) break;
    }

    const nextDate = await findNextIncompleteDate();
    if (!nextDate) break; // everything in the window is already populated

    await getFullDayEarnings(nextDate, { bypassCap, forceRefresh: true });
    populated.push(nextDate);
  }

  return { populated };
}
