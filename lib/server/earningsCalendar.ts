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
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { reserveFmpCallSlot } from "./historyCache";
import { readPricePoolBulk } from "./pricePool";

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
const DAY_COMPLETE_PREFIX = "msh:earnings-day-complete:v2";
const DAY_ITEMS_PREFIX = "msh:earnings-day-items:v1";
const FILL_FRONTIER_KEY = "msh:earnings-fill-frontier:v2";

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

// How many candidates the *render path* will quote to paint a never-yet-seen
// date quickly (they're mega-cap-sorted, so this is the top of the list). The
// rest of the day is filled in the background / by owner Backfill -- this is
// the bound that stops a busy day blocking the page on hundreds of quotes.
const RENDER_SEED_LIMIT = 80;

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

// How complete an FMP earnings row is -- used to pick the best entry when the
// feed lists the same symbol more than once (same date, or across dates). A row
// carrying real estimates/actuals wins over an empty placeholder; ties break to
// the earlier date.
function candidateDataScore(c: EarningsCandidate): number {
  let n = 0;
  if (c.epsEstimated !== null) n++;
  if (c.epsActual !== null) n++;
  if (c.revenueEstimated !== null) n++;
  if (c.revenueActual !== null) n++;
  return n;
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

  // Collapse the feed to ONE entry per symbol for the whole month. FMP's
  // earnings-calendar routinely repeats a symbol -- several rows on the same
  // date, and/or the same symbol across nearby dates -- which surfaced as
  // duplicate table rows (e.g. JOE listed 2-4x on 29-31 Jul). A company reports
  // once per period, so keep the single best entry: most data, ties to the
  // earliest date.
  const bySymbol = new Map<string, EarningsCandidate>();
  for (const row of rows) {
    const symbol = str(row.symbol);
    const date = str(row.date);
    if (!symbol || !date) continue;

    const key = symbol.toUpperCase();
    const company = nameMap.get(key);
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

    const existing = bySymbol.get(key);
    if (
      !existing ||
      candidateDataScore(candidate) > candidateDataScore(existing) ||
      (candidateDataScore(candidate) === candidateDataScore(existing) && candidate.date < existing.date)
    ) {
      bySymbol.set(key, candidate);
    }
  }

  for (const candidate of bySymbol.values()) {
    const list = byDate.get(candidate.date) ?? [];
    list.push(candidate);
    byDate.set(candidate.date, list);
  }

  // Coarse sort within each date: known mega-caps first, ties keep insertion
  // order (Array.sort is stable). The final market-cap ordering happens once
  // quotes are in (dedupeAndSortItems).
  for (const list of byDate.values()) {
    list.sort((a, b) => popularRank(a.symbol) - popularRank(b.symbol));
  }

  candidatesCache.set(key, { at: Date.now(), byDate });
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
  // True when price/marketCap came free from the shared site-wide price pool
  // (a universe symbol). The pool carries no exchange, but every universe
  // symbol is US-listed by construction, so this stands in for the exchange
  // check below.
  usOk?: boolean;
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

    // Site-wide FMP account budget (~300 calls/minute across every FMP-calling
    // route). Only a genuinely new symbol makes a real FMP call, so only it
    // needs a budget slot. Already-quoted symbols resolve from Next's Data
    // Cache below without hitting FMP -- making them queue behind the budget
    // too is what made heavy, mostly-cached days take 10-15s to render.
    try {
      await reserveFmpCallSlot();
    } catch {
      return { price: null, marketCap: null, exchange: null, capped: true };
    }
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
    if (cachedItems) {
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
  const rawItems: EarningsListItem[] = candidates
    .map((candidate): EarningsListItem | null => {
      const quote = quotes[candidate.symbol];
      if (quote?.capped) anyCapped = true;
      // Only US-listed common stock survives -- the pre-sort filter is
      // symbol-shape only; the exchange isn't known until the quote comes back.
      const exchangeOk =
        Boolean(quote?.usOk) ||
        Boolean(quote?.exchange && ALLOWED_EXCHANGES.has(quote.exchange));
      if (!exchangeOk) return null;
      return {
        ...candidate,
        price: quote?.price ?? null,
        marketCap: quote?.marketCap ?? null,
      };
    })
    .filter((item): item is EarningsListItem => item !== null);
  const items = dedupeAndSortItems(rawItems);

  // Always materialise what we have, so the next render -- and Show more --
  // read it back instead of re-quoting.
  await writeDayItemsCache(date, items);

  // Only "complete" once every candidate was quoted with nothing skipped by the
  // cap. A bounded seed render is never complete.
  const complete = quotedEveryCandidate && !anyCapped;
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
