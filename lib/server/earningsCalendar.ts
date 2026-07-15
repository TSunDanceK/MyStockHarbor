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

type QuoteResult = { price: number | null; marketCap: number | null; exchange: string | null };

async function quoteOne(symbol: string): Promise<QuoteResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { price: null, marketCap: null, exchange: null };

  try {
    const res = await fetch(
      `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
      { next: { revalidate: QUOTE_REVALIDATE_SECONDS } }
    );
    if (!res.ok) return { price: null, marketCap: null, exchange: null };
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    return {
      price: num(row?.price),
      marketCap: num(row?.marketCap),
      exchange: str(row?.exchange),
    };
  } catch {
    return { price: null, marketCap: null, exchange: null };
  }
}

async function quoteBatch(symbols: string[]): Promise<Record<string, QuoteResult>> {
  const results: Record<string, QuoteResult> = {};
  for (let i = 0; i < symbols.length; i += QUOTE_CONCURRENCY) {
    const slice = symbols.slice(i, i + QUOTE_CONCURRENCY);
    const quotes = await Promise.all(slice.map((symbol) => quoteOne(symbol)));
    slice.forEach((symbol, idx) => {
      results[symbol] = quotes[idx];
    });
  }
  return results;
}

// The one function that spends real, per-symbol API calls -- capped at
// BATCH_SIZE (100) candidates per call. batchIndex 0 is the first 100
// (coarse-sorted) candidates for the date, batchIndex 1 is the next 100,
// etc. ("Show more" on the client advances batchIndex.)
export async function getDayEarningsPage(date: string, batchIndex: number): Promise<DayEarningsPage> {
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

  const quotes = await quoteBatch(slice.map((c) => c.symbol));

  const quoted: Array<EarningsListItem & { exchangeOk: boolean }> = slice.map((candidate) => {
    const quote = quotes[candidate.symbol];
    return {
      ...candidate,
      price: quote?.price ?? null,
      marketCap: quote?.marketCap ?? null,
      // Drop anything that, once actually quoted, turns out not to be a US-
      // listed common stock after all -- the pre-sort filter is symbol-shape
      // only and can't be perfect without spending the quote call first.
      exchangeOk: Boolean(quote?.exchange && ALLOWED_EXCHANGES.has(quote.exchange)),
    };
  });

  const items: EarningsListItem[] = quoted
    .filter((item) => item.exchangeOk)
    .map(({ exchangeOk: _exchangeOk, ...rest }) => rest)
    // Real market-cap sort now that we actually have it -- this is the
    // accurate liquidity order for whatever's on screen, even though which
    // candidates got quoted in the first place was a heuristic.
    .sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1));

  const fetchedCount = Math.min(start + BATCH_SIZE, candidates.length);
  const hasMore = fetchedCount < candidates.length;

  return {
    date,
    items,
    totalCandidates: candidates.length,
    fetchedCount,
    hasMore,
    nextBatch: hasMore ? batchIndex + 1 : null,
  };
}
