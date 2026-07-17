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
// get price/market cap for many symbols in one call; only the single-symbol
// /stable/quote works, and that's the one part of this file that spends a
// real API call per symbol -- capped at BATCH_SIZE per page, agreed with
// the site owner.
//
// Because there's no way to know real market cap before quoting, "priority
// = liquidity" is approximated in two tiers:
//   1. Free pre-sort (no API cost): known mega-caps/index ETFs first
//      (POPULAR_SYMBOLS, kept in sync with app/api/symbols/route.ts), then
//      FMP's own return order for everything else.
//   2. Only the current page's slice (up to 100 rows) is actually quoted;
//      once quoted, that slice is re-sorted by real market cap so what's
//      on screen is accurately ordered -- it's *which* 100 made the cut
//      that's a heuristic, not the order they're shown in.
//
// Each single quote fetch is cached via Next's fetch cache (shared globally
// across Vercel's infra, not per-instance memory) for ~30 days, so a given
// date+batch only spends real FMP calls once per month regardless of how
// many people view it -- the "Show more" button's cooldown (client-side) is
// there to stop rapid double-clicks, not to work around a lack of caching.
//
// --- Rate-limiting + auto-populate system (added 2026-07-17/18) ---
//
// A Redis-backed hourly cap (QUOTE_HOURLY_CAP) limits how many *new*
// (never-quoted-before) symbols this feature spends a real FMP /quote call
// on, shared across every visitor. Symbols already quoted within the last
// ~30 days skip the cap entirely (wasRecentlyQuoted/markQuoted), so re-
// showing cached data is always free -- only genuinely first-time symbols
// compete for the cap.
//
// That cap alone made first-time browsing across many dates feel broken
// (a chunk of the month's tickers would just show blank price/cap once the
// hour's 50 slots were spent). The fix is a background auto-populate loop:
// every real page load quietly checks whether the next upcoming,
// not-yet-fully-quoted date needs filling in, and does a bit of that work
// in the background (see populateNextMissingDate, called from `after()` in
// app/earnings-calendar/page.tsx) -- so the calendar organically stays
// populated further into the future over time, purely from normal traffic,
// without ever exceeding the hourly cap.
//
// A date is tracked as "complete" (isDateComplete/markDateComplete) once a
// getDayEarningsPage call quotes every one of its candidates with nothing
// skipped by the cap. This also doubles as a one-time reconciliation: a
// date whose tickers were already all quoted before this system existed
// gets marked complete on its first pass at zero API cost (every quoteOne
// call for it hits the "already quoted" fast path).
//
// For manual catch-up on a single date at a time (e.g. seeding the next
// couple of months by clicking through), the site owner can use the
// "Backfill" button rendered on app/earnings-calendar/page.tsx (visible
// whenever a date isn't yet fully populated). It posts to
// app/api/earnings-calendar/backfill-date/route.ts with the secret key and
// bypasses the hourly cap entirely for that one date -- gated behind
// EARNINGS_BACKFILL_KEY (lib/server/backfillAuth.ts) so only the owner can
// trigger it, with a 3-attempts/10-minute IP lockout on wrong keys.
//
// bypassCap only ever bypasses THIS file's own 50/hour budget -- it never
// bypasses the site-wide FMP account budget (reserveFmpCallSlot, imported
// from historyCache.ts, ~300 calls/minute across every FMP-calling route on
// the site). Every real quote call, backfill or not, still waits for a slot
// there first, so a large backfill run can't itself trip FMP's real
// plan-level rate limit or starve other pages' FMP calls -- it just runs
// slower under contention instead.

import { Redis } from "@upstash/redis";
import { reserveFmpCallSlot } from "./historyCache";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

// Hard ceiling on real, per-symbol FMP /quote calls this feature is allowed
// to spend in any rolling hour -- global across all visitors, not per-IP.
// Site owner requested 50/hour. Symbols already quoted within the last
// ~30 days (matching the underlying fetch cache's revalidate window) don't
// consume a slot at all, since re-showing them costs nothing new -- only
// genuinely first-time symbols count against the cap.
const QUOTE_HOURLY_CAP = 50;
const QUOTE_COUNTER_PREFIX = "msh:earnings-quote-calls:v1";
const QUOTED_SYMBOL_PREFIX = "msh:earnings-quoted-symbol:v1";
const DAY_COMPLETE_PREFIX = "msh:earnings-day-complete:v1";

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

// Has this symbol already been through a real FMP quote call recently
// enough that Next's own fetch cache is expected to still be warm for it?
// Backed by a separate Redis marker (not a read of Next's cache, which
// isn't inspectable this way) with the same TTL as the fetch cache's
// revalidate window, so the two stay in sync.
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
// spent. Always increments the counter (even when the caller is going to
// ignore the result via bypassCap) so getQuoteHourUsage stays an accurate
// picture of real spend. Fails open if Redis isn't configured or errors,
// matching this file's existing fail-open posture elsewhere.
async function reserveQuoteSlot(): Promise<boolean> {
  if (!redis) return true;

  const key = `${QUOTE_COUNTER_PREFIX}:${getHourBucket()}`;

  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, 70 * 60); // just over an hour, covers clock skew
    }
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

// Public wrapper so callers outside this file (the earnings-calendar page,
// to decide whether to grey out its "Backfill" button) can check whether a
// given date has already had every candidate quoted.
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
};

export type DayEarningsPage = {
  date: string;
  items: EarningsListItem[];
  totalCandidates: number;
  fetchedCount: number;
  hasMore: boolean;
  nextBatch: number | null;
};

type RawEarningsRow = {
  symbol?: string;
  date?: string;
  epsActual?: number | string | null;
  epsEstimated?: number | string | null;
  revenueActual?: number | string | null;
  revenueEstimated?: number | string | null;
};

const MONTH_CACHE_MS = 6 * 60 * 60_000; // 6 hours -- FMP's own lastUpdated field is daily
const NAME_MAP_CACHE_MS = 24 * 60 * 60_000; // 24 hours
const BATCH_SIZE = 100;
const QUOTE_CONCURRENCY = 10;
const QUOTE_REVALIDATE_SECONDS = 30 * 24 * 60 * 60; // ~1 month, per site owner's request

// How many dates the background auto-populate loop will attempt in one
// pass, and how far into the future it's willing to scan looking for the
// next incomplete one. Kept modest for the organic (non-bypass) path so a
// single page load's background work stays fast and cheap; the manual
// backfill route can push more per call via its own maxDates param.
const AUTO_POPULATE_MAX_DATES = 2;
const BACKFILL_SCAN_DAYS = 60;

const ALLOWED_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX"]);

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

// Guess at "is this even worth showing" without any paid lookup: a "." or
// "-" in the symbol is usually a preferred share or foreign-exchange
// listing (BRK.B is a deliberate exception -- it's in POPULAR_SYMBOLS,
// which is only used as a sort tiebreak, not a filter, so it's unaffected
// by this check running on every candidate). A 5+ letter symbol ending in Y
// or F is almost always the OTC/ADR representation of a foreign company
// already reporting under its primary listing elsewhere (seen directly in
// the raw feed: DANOY, TEFOF, HLTOY, KPELF).
function looksNonUsOrDerivative(symbol: string): boolean {
  if (symbol.includes(".") || symbol.includes("-")) return true;
  if (symbol.length >= 5 && /[YF]$/.test(symbol)) return true;
  return false;
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
let nameMapCache: { at: number; map: Map<string, string> } | null = null;
const candidatesCache = new Map<string, { at: number; byDate: Map<string, EarningsCandidate[]> }>();

async function fetchMonthRows(year: number, month: number): Promise<RawEarningsRow[]> {
  const key = monthKey(year, month);
  const cached = monthCache.get(key);
  if (cached && Date.now() - cached.at < MONTH_CACHE_MS) return cached.rows;

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return cached?.rows ?? [];

  const from = `${key}-01`;
  const to = `${key}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

  try {
    const res = await fetch(
      `https://financialmodelingprep.com/stable/earnings-calendar?from=${from}&to=${to}&apikey=${apiKey}`,
      { next: { revalidate: MONTH_CACHE_MS / 1000 } }
    );
    if (!res.ok) throw new Error(`earnings-calendar failed: ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json) ? (json as RawEarningsRow[]) : [];
    monthCache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    return cached?.rows ?? [];
  }
}

async function getNameMap(): Promise<Map<string, string>> {
  if (nameMapCache && Date.now() - nameMapCache.at < NAME_MAP_CACHE_MS) {
    return nameMapCache.map;
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return nameMapCache?.map ?? new Map();

  try {
    const res = await fetch(`https://financialmodelingprep.com/stable/stock-list?apikey=${apiKey}`, {
      next: { revalidate: NAME_MAP_CACHE_MS / 1000 },
    });
    if (!res.ok) throw new Error(`stock-list failed: ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json)
      ? (json as Array<{ symbol?: string; companyName?: string }>)
      : [];

    const map = new Map<string, string>();
    for (const row of rows) {
      const symbol = str(row.symbol);
      const name = str(row.companyName);
      if (symbol && name) map.set(symbol.toUpperCase(), name);
    }

    nameMapCache = { at: Date.now(), map };
    return map;
  } catch {
    return nameMapCache?.map ?? new Map();
  }
}

// Builds, per date-in-month, the full candidate list (name-resolved,
// heuristically US-filtered, coarse-sorted) -- but does NOT quote anything.
// This is the free part: two bulk calls total per month (both cached), no
// per-symbol cost regardless of how many dates in the month get viewed.
async function getMonthCandidates(year: number, month: number): Promise<Map<string, EarningsCandidate[]>> {
  const key = monthKey(year, month);
  const cached = candidatesCache.get(key);
  if (cached && Date.now() - cached.at < MONTH_CACHE_MS) return cached.byDate;

  const [rows, nameMap] = await Promise.all([fetchMonthRows(year, month), getNameMap()]);

  const byDate = new Map<string, EarningsCandidate[]>();

  for (const row of rows) {
    const symbol = str(row.symbol);
    const date = str(row.date);
    if (!symbol || !date) continue;

    const company = nameMap.get(symbol.toUpperCase());
    if (!company) continue; // no name match -- rare given stock-list's ~38k coverage, skip rather than show a blank name

    if (looksNonUsOrDerivative(symbol)) continue;

    const candidate: EarningsCandidate = {
      symbol,
      company,
      date,
      epsEstimated: num(row.epsEstimated),
      epsActual: num(row.epsActual),
      revenueEstimated: num(row.revenueEstimated),
      revenueActual: num(row.revenueActual),
    };

    const list = byDate.get(date) ?? [];
    list.push(candidate);
    byDate.set(date, list);
  }

  // Coarse sort within each date: known mega-caps first, ties keep FMP's
  // own original order (Array.sort is stable, and `list` was built by
  // pushing in feed order).
  for (const list of byDate.values()) {
    list.sort((a, b) => popularRank(a.symbol) - popularRank(b.symbol));
  }

  candidatesCache.set(key, { at: Date.now(), byDate });
  return byDate;
}

// Day counts for the calendar grid -- the "known total" the Show More
// button counts down from. Uses the same free candidate list as above (no
// quoting), so it's safe to compute for an entire visible month at once.
export async function getMonthDayCounts(year: number, month: number): Promise<Record<string, number>> {
  const byDate = await getMonthCandidates(year, month);
  const counts: Record<string, number> = {};
  for (const [date, list] of byDate) counts[date] = list.length;
  return counts;
}

async function getDayCandidates(date: string): Promise<EarningsCandidate[]> {
  const [yearStr, monthStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return [];
  const byDate = await getMonthCandidates(year, month);
  return byDate.get(date) ?? [];
}

type QuoteResult = {
  price: number | null;
  marketCap: number | null;
  exchange: string | null;
  // True when this symbol was skipped because the hourly cap was already
  // spent (and bypassCap wasn't set) -- distinct from a real FMP call that
  // simply returned no usable data. Only used to decide whether a date can
  // be marked "complete"; never shown in the UI.
  capped: boolean;
};

async function quoteOne(symbol: string, bypassCap: boolean): Promise<QuoteResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { price: null, marketCap: null, exchange: null, capped: false };

  // Symbols already quoted within the fetch-cache window don't spend an
  // hourly slot -- only genuinely new symbols compete for the cap.
  const alreadyQuoted = await wasRecentlyQuoted(symbol);
  if (!alreadyQuoted) {
    const allowed = await reserveQuoteSlot();
    if (!allowed && !bypassCap) {
      return { price: null, marketCap: null, exchange: null, capped: true };
    }
  }

  // Site-wide FMP account budget (~300 calls/minute across every
  // FMP-calling route) -- enforced unconditionally, bypassCap or not, since
  // this protects FMP's real plan-level rate limit rather than our own
  // internal cost cap. reserveFmpCallSlot waits for a slot rather than
  // failing immediately; if it still can't get one within its own timeout,
  // treat this symbol as capped (not "no data") so the date isn't marked
  // complete and gets retried on the next pass instead of silently missing
  // this ticker forever.
  try {
    await reserveFmpCallSlot();
  } catch {
    return { price: null, marketCap: null, exchange: null, capped: true };
  }

  try {
    const res = await fetch(
      `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
      { next: { revalidate: QUOTE_REVALIDATE_SECONDS } }
    );
    if (!res.ok) return { price: null, marketCap: null, exchange: null, capped: false };
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;

    if (!alreadyQuoted) await markQuoted(symbol);

    return {
      price: num(row?.price),
      marketCap: num(row?.marketCap),
      exchange: str(row?.exchange),
      capped: false,
    };
  } catch {
    return { price: null, marketCap: null, exchange: null, capped: false };
  }
}

async function quoteBatch(symbols: string[], bypassCap: boolean): Promise<Record<string, QuoteResult>> {
  const results: Record<string, QuoteResult> = {};
  for (let i = 0; i < symbols.length; i += QUOTE_CONCURRENCY) {
    const slice = symbols.slice(i, i + QUOTE_CONCURRENCY);
    const quotes = await Promise.all(slice.map((symbol) => quoteOne(symbol, bypassCap)));
    slice.forEach((symbol, idx) => {
      results[symbol] = quotes[idx];
    });
  }
  return results;
}

// The one function that spends real, per-symbol API calls -- capped at
// BATCH_SIZE (100) candidates per call, and further capped globally by
// QUOTE_HOURLY_CAP new symbols per hour (see quoteOne/reserveQuoteSlot
// above) unless opts.bypassCap is set. batchIndex 0 is the first 100
// (coarse-sorted) candidates for the date, batchIndex 1 is the next 100,
// etc. ("Show more" on the client advances batchIndex.) Marks the date
// complete (see markDateComplete) when this call covers every candidate
// for the date and none were skipped by the cap.
export async function getDayEarningsPage(
  date: string,
  batchIndex: number,
  opts: { bypassCap?: boolean } = {}
): Promise<DayEarningsPage> {
  const bypassCap = opts.bypassCap ?? false;
  const candidates = await getDayCandidates(date);
  const start = batchIndex * BATCH_SIZE;
  const slice = candidates.slice(start, start + BATCH_SIZE);

  if (slice.length === 0) {
    return {
      date,
      items: [],
      totalCandidates: candidates.length,
      fetchedCount: Math.min(start, candidates.length),
      hasMore: false,
      nextBatch: null,
    };
  }

  const quotes = await quoteBatch(slice.map((c) => c.symbol), bypassCap);

  const quoted: Array<EarningsListItem & { exchangeOk: boolean; capped: boolean }> = slice.map((candidate) => {
    const quote = quotes[candidate.symbol];
    return {
      ...candidate,
      price: quote?.price ?? null,
      marketCap: quote?.marketCap ?? null,
      // Drop anything that, once actually quoted, turns out not to be a US-
      // listed common stock after all -- the pre-sort filter is symbol-shape
      // only and can't be perfect without spending the quote call first.
      exchangeOk: Boolean(quote?.exchange && ALLOWED_EXCHANGES.has(quote.exchange)),
      capped: quote?.capped ?? false,
    };
  });

  const items: EarningsListItem[] = quoted
    .filter((item) => item.exchangeOk)
    .map(({ exchangeOk: _exchangeOk, capped: _capped, ...rest }) => rest)
    // Real market-cap sort now that we actually have it -- this is the
    // accurate liquidity order for whatever's on screen, even though which
    // candidates got quoted in the first place was a heuristic.
    .sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1));

  const fetchedCount = Math.min(start + BATCH_SIZE, candidates.length);
  const hasMore = fetchedCount < candidates.length;

  if (!hasMore && candidates.length > 0 && !quoted.some((item) => item.capped)) {
    await markDateComplete(date);
  }

  return {
    date,
    items,
    totalCandidates: candidates.length,
    fetchedCount,
    hasMore,
    nextBatch: hasMore ? batchIndex + 1 : null,
  };
}

// Walks forward from today (UTC), skipping dates with no reporters at all
// (weekends/holidays), and returns the first date that isn't fully quoted
// yet. Returns null if everything within the scan window is already
// complete (or there's nothing to populate at all).
async function findNextIncompleteDate(): Promise<string | null> {
  const now = new Date();

  for (let i = 0; i < BACKFILL_SCAN_DAYS; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    const dateStr = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

    const candidates = await getDayCandidates(dateStr);
    if (candidates.length === 0) continue; // nothing reporting that day -- skip

    if (!(await isDateComplete(dateStr))) return dateStr;
  }

  return null;
}

// Finds and populates the next not-yet-complete upcoming date(s). Called
// two ways:
//   - Fire-and-forget after every real /earnings-calendar page load (see
//     `after()` in app/earnings-calendar/page.tsx), a couple of dates at a
//     time and respecting the normal hourly cap -- this is what keeps the
//     calendar populated further into the future purely from organic
//     traffic, without ever exceeding QUOTE_HOURLY_CAP in a given hour.
//   - getDayEarningsPage itself, called directly with bypassCap:true from
//     app/api/earnings-calendar/backfill-date/route.ts (the in-page
//     "Backfill" button), for a one-time owner-run catch-up on a single
//     date at a time.
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
    if (!nextDate) break; // everything in the scan window is already populated

    await getDayEarningsPage(nextDate, 0, { bypassCap });
    populated.push(nextDate);
  }

  return { populated };
}
