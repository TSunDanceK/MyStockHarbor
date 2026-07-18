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
// --- Rolling window (added 2026-07-18) ---
//
// The calendar only ever deals with a bounded, rolling window of dates:
//   start = today - WINDOW_PAST_DAYS (the last few days stay live so recent
//           reporters are still visible)
//   end   = last day of (this month + WINDOW_FUTURE_MONTHS)
// Anything outside that window is greyed out in the UI and never populated.
// The window's future edge only advances on the 1st of a month; its past
// edge advances daily. See getWindowStartDate / getWindowEndDate /
// isDateInWindow (exported for the page to clamp navigation and grey cells).
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
import { reserveFmpCallSlot } from "./historyCache";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

// Hard ceiling on real, per-symbol FMP /quote calls this feature is allowed
// to spend in any rolling hour -- global across all visitors, not per-IP.
// Symbols already quoted within the last ~30 days (matching the underlying
// fetch cache's revalidate window) don't consume a slot at all.
const QUOTE_HOURLY_CAP = 50;
const QUOTE_COUNTER_PREFIX = "msh:earnings-quote-calls:v1";
const QUOTED_SYMBOL_PREFIX = "msh:earnings-quoted-symbol:v1";
const DAY_COMPLETE_PREFIX = "msh:earnings-day-complete:v1";
const DAY_ITEMS_PREFIX = "msh:earnings-day-items:v1";
const US_COUNT_MONTH_PREFIX = "msh:earnings-month-uscount:v1";
const FILL_FRONTIER_KEY = "msh:earnings-fill-frontier:v1";

// Rolling window bounds.
const WINDOW_PAST_DAYS = 3; // today and the previous 3 days stay live
const WINDOW_FUTURE_MONTHS = 3; // through the end of (this month + 3)

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

// First date shown/populatable: today minus WINDOW_PAST_DAYS (so with
// WINDOW_PAST_DAYS=3, today plus the previous 3 days are live).
export function getWindowStartDate(): string {
  const t = utcMidnightToday();
  return toDateStr(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - WINDOW_PAST_DAYS)));
}

// Last date shown/populatable: the final day of the month WINDOW_FUTURE_MONTHS
// ahead. Day 0 of (month + N + 1) is the last day of (month + N).
export function getWindowEndDate(): string {
  const t = utcMidnightToday();
  return toDateStr(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + WINDOW_FUTURE_MONTHS + 1, 0)));
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

// --- Accurate US-listed count (self-correcting green badges) -------------

function monthOf(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

async function storeDateUsCount(date: string, count: number) {
  if (!redis) return;
  const key = `${US_COUNT_MONTH_PREFIX}:${monthOf(date)}`;
  try {
    await redis.hset(key, { [date]: count });
    await redis.expire(key, QUOTE_REVALIDATE_SECONDS + 3 * 24 * 60 * 60);
  } catch {
    // best-effort -- badge just keeps showing the raw estimate
  }
}

async function getMonthUsCounts(ym: string): Promise<Record<string, number>> {
  if (!redis) return {};
  try {
    const h = await redis.hgetall<Record<string, unknown>>(`${US_COUNT_MONTH_PREFIX}:${ym}`);
    if (!h) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(h)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  } catch {
    return {};
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

// --- Fill frontier (so a full window costs nothing to rescan) ------------

async function getFillFrontier(): Promise<string> {
  const start = getWindowStartDate();
  if (!redis) return start;
  try {
    const v = await redis.get<string>(FILL_FRONTIER_KEY);
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && v > start) return v;
  } catch {
    // fall through to window start
  }
  return start;
}

async function setFillFrontier(date: string) {
  if (!redis) return;
  try {
    await redis.set(FILL_FRONTIER_KEY, date);
  } catch {
    // best-effort -- worst case the next scan re-checks a few completed dates
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

export type FullDayEarnings = {
  date: string;
  items: EarningsListItem[];
  totalCandidates: number;
  usListedCount: number;
  complete: boolean;
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
const QUOTE_CONCURRENCY = 10;
const QUOTE_REVALIDATE_SECONDS = 30 * 24 * 60 * 60; // ~1 month, per site owner's request

// Safety ceiling on how many candidates a single date will ever quote -- far
// more than any real US-listed day sees, guards against a pathological feed.
const MAX_CANDIDATES_PER_DAY = 600;

// How many dates the background auto-populate loop will attempt per page load.
const AUTO_POPULATE_MAX_DATES = 2;

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
// which is only used as a sort tiebreak, not a filter). A 5+ letter symbol
// ending in Y or F is almost always the OTC/ADR representation of a foreign
// company already reporting under its primary listing elsewhere.
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
  // own original order (Array.sort is stable).
  for (const list of byDate.values()) {
    list.sort((a, b) => popularRank(a.symbol) - popularRank(b.symbol));
  }

  candidatesCache.set(key, { at: Date.now(), byDate });
  return byDate;
}

// Day counts for the calendar grid. Prefers the accurate, stored US-listed
// count for any date that has already been fully populated; otherwise falls
// back to the raw candidate estimate (which over-counts, since the true
// exchange isn't known until a symbol is quoted). So badges start as an
// estimate and self-correct to the real number once a date fills in.
export async function getMonthDayCounts(year: number, month: number): Promise<Record<string, number>> {
  const byDate = await getMonthCandidates(year, month);
  const realCounts = await getMonthUsCounts(monthKey(year, month));
  const counts: Record<string, number> = {};
  for (const [date, list] of byDate) {
    const real = realCounts[date];
    counts[date] = typeof real === "number" ? real : list.length;
  }
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

  // Site-wide FMP account budget (~300 calls/minute across every FMP-calling
  // route) -- enforced unconditionally, bypassCap or not. Waits for a slot;
  // if it still can't get one within its own timeout, treat this symbol as
  // capped (retried next pass) rather than "no data".
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
  opts: { bypassCap?: boolean; forceRefresh?: boolean } = {}
): Promise<FullDayEarnings> {
  const bypassCap = opts.bypassCap ?? false;
  const forceRefresh = opts.forceRefresh ?? false;

  const candidates = (await getDayCandidates(date)).slice(0, MAX_CANDIDATES_PER_DAY);
  const totalCandidates = candidates.length;

  if (totalCandidates === 0) {
    return { date, items: [], totalCandidates: 0, usListedCount: 0, complete: false };
  }

  if (!forceRefresh) {
    const cachedItems = await readDayItemsCache(date);
    if (cachedItems && (await isDateComplete(date))) {
      return {
        date,
        items: cachedItems,
        totalCandidates,
        usListedCount: cachedItems.length,
        complete: true,
      };
    }
  }

  const quotes = await quoteBatch(candidates.map((c) => c.symbol), bypassCap);

  let anyCapped = false;
  const items: EarningsListItem[] = candidates
    .map((candidate): EarningsListItem | null => {
      const quote = quotes[candidate.symbol];
      if (quote?.capped) anyCapped = true;
      // Only US-listed common stock survives -- the pre-sort filter is
      // symbol-shape only; the exchange isn't known until the quote comes back.
      const exchangeOk = Boolean(quote?.exchange && ALLOWED_EXCHANGES.has(quote.exchange));
      if (!exchangeOk) return null;
      return {
        ...candidate,
        price: quote?.price ?? null,
        marketCap: quote?.marketCap ?? null,
      };
    })
    .filter((item): item is EarningsListItem => item !== null)
    .sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1));

  const complete = !anyCapped;
  if (complete) {
    await markDateComplete(date);
    await storeDateUsCount(date, items.length);
    await writeDayItemsCache(date, items);
  }

  return { date, items, totalCandidates, usListedCount: items.length, complete };
}

// Walks the window front-to-back from the fill frontier and returns the first
// date that still has candidates left to quote. Dates with no reporters at all
// (weekends/holidays) count as "done" and are skipped. Advances the frontier
// so completed leading dates aren't re-scanned; parks it past the window end
// when everything is filled, so a full window costs one Redis read to confirm.
async function findNextIncompleteDate(): Promise<string | null> {
  const endStr = getWindowEndDate();
  const endTime = new Date(`${endStr}T00:00:00Z`).getTime();

  const frontierStr = await getFillFrontier();
  let cur = new Date(`${frontierStr}T00:00:00Z`).getTime();

  while (cur <= endTime) {
    const ds = toDateStr(new Date(cur));
    const candidates = await getDayCandidates(ds);
    if (candidates.length > 0 && !(await isDateComplete(ds))) {
      await setFillFrontier(ds);
      return ds;
    }
    cur += 86_400_000;
  }

  // Everything in the window is complete -- park the frontier just past the
  // end so subsequent scans short-circuit until the window rolls forward.
  await setFillFrontier(toDateStr(new Date(endTime + 86_400_000)));
  return null;
}

// Finds and populates the next not-yet-complete date(s) in the window, front-
// to-back. Called fire-and-forget from every real page load (respecting the
// hourly cap) and directly with bypassCap:true from the owner Backfill route.
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
