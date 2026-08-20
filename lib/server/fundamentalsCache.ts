// The FMP calls below carried `cache: "no-store"`, which opts any route that
// reaches them out of static rendering entirely -- the same class of bailout
// @upstash/redis caused via its own no-store default (lib/server/redisCacheMode.ts).
// They only fire on a Redis miss, so the bailout is intermittent and invisible:
// the route silently renders per request whenever the cache happens to be cold.
// Redis remains the real cache here, with its own TTL; this short Next
// revalidate exists so the call stops forcing the route dynamic, and it dedupes
// identical misses inside one render pass. Same fix as historyCache.ts; see
// claude/picker-pages-isr-2026-08-20.md.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { hasFmpCapacity, reserveFmpCallSlot } from "./historyCache";

// Cron-warmed, Redis-cached fundamentals (market cap, PE ratio, industry) for
// the analyzed picker universe. Mirrors the earnings-warmup pattern already
// used by the pickers pipeline (see app/api/jobs/warm-earnings + the
// readCachedFmpEarningsBulk / queueEarningsWarmupSymbols helpers in
// lib/server/pickersBuilder.ts): a background job fetches from FMP and writes
// Redis, while every page render only ever READS from Redis -- so the new
// list-view columns cost zero FMP calls per request.
//
// Two data classes with different volatilities:
//   * market cap + PE  -> refreshed daily (stored on the combined record, 26h TTL)
//   * industry/sector  -> effectively static, cached 30 days under its own key
//     and merged in, so it is fetched at most once per symbol per month.
//
// All FMP calls go through reserveFmpCallSlot()/hasFmpCapacity() from
// historyCache.ts, so this never breaches the shared 300/min FMP budget.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const FUND_KEY_PREFIX = "msh:pickers:fundamentals:v1:";
const PROFILE_KEY_PREFIX = "msh:pickers:profile:v1:";
const FUND_TTL_SECONDS = 60 * 60 * 26; // 26h -- comfortably spans a daily warm
const PROFILE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d -- industry/sector are static

// STEP 2 (2026-08-06 follow-up session): app/api/market/route.ts already makes
// one stable/company-screener call per master-list rebuild (~daily) to source
// discovery candidates, and that response carries marketCap/sector/industry for
// every row -- it was discarding all of it except `symbol`. Caching those
// fields here (via cacheScreenerFundamentals, called from that same fetch)
// lets warmFundamentals skip the per-symbol `profile` call entirely for any
// symbol the screener covers, which is where the industry/sector backfill tail
// actually comes from (PROFILE_MAX_PER_RUN below). Confirmed via
// /api/debug/fmp-endpoints (STEP 1, same session): the screener's price/volume
// track the live stable/quote feed in near lockstep rather than sitting on a
// stale multi-day average, but marketCap/sector/industry are the fields this
// file actually uses, and those are static-ish regardless.
//
// Only covers symbols the screener's own filter returns (>= its market-cap
// floor, NASDAQ/NYSE, actively trading, equities only) -- everything else
// still falls back to the profile fetch below, unchanged.
const SCREENER_FUND_KEY_PREFIX = "msh:pickers:screener-fundamentals:v1:";
// TTL comfortably spans the master-list rebuild cadence (~daily, gated by
// ensureDailyShuffledMasterList's Eastern-day rollover in app/api/market) so a
// delayed rebuild doesn't empty the cache before the next one lands.
const SCREENER_FUND_TTL_SECONDS = 60 * 60 * 30; // 30h

// Bounds so a single warm run can never run away with the FMP budget.
const QUOTE_CHUNK_SIZE = 50; // batch-quote symbols per FMP call
const PROFILE_MAX_PER_RUN = 120; // cap fresh profile fetches per run
const FMP_MIN_HEADROOM_CALLS = 60; // leave room for history/earnings warmers

// The FMP guard counts calls per MINUTE, so an exhausted budget means "wait a
// few seconds", not "give up". Both stages draw on one shared wait budget for
// the whole run, so total waiting is bounded well inside the function's max
// duration no matter how the stages interleave.
const CAPACITY_POLL_MS = 5_000;
const CAPACITY_WAIT_BUDGET_MS = 90_000;

export type FundamentalsRow = {
  symbol: string;
  marketCap: number | null;
  peRatio: number | null;
  industry: string | null;
  sector: string | null;
  updatedAt: string;
};

type ProfileLite = {
  industry: string | null;
  sector: string | null;
  marketCap: number | null;
};

export type ScreenerFundamentalsRow = {
  symbol: string;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
  beta: number | null;
  lastAnnualDividend: number | null;
  updatedAt: string;
};

function cleanSymbol(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function uniqueClean(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map(cleanSymbol).filter(Boolean)));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Mutable, shared across both stages of a single warm run. */
type WaitBudget = { remainingMs: number };

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Block until there is FMP headroom, or until the run's shared wait budget is
 * spent. Returns false only in the latter case.
 *
 * This exists because the previous code abandoned a stage the instant the
 * per-minute budget was tight. Since the budget refills every minute, a single
 * busy moment was permanently costing the whole stage -- which is how the
 * profile stage came to fetch ~nothing on nearly every run.
 */
async function awaitFmpCapacity(wait: WaitBudget): Promise<boolean> {
  if (await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS)) return true;
  while (wait.remainingMs > 0) {
    const step = Math.min(CAPACITY_POLL_MS, wait.remainingMs);
    await sleep(step);
    wait.remainingMs -= step;
    if (await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS)) return true;
  }
  return false;
}

/**
 * Redis-ONLY bulk read of the whole universe's cached fundamentals in a single
 * pipelined round-trip. Never touches FMP -- safe to call on every picker page
 * render. Any symbol without a cached record simply won't be in the returned
 * map (the caller shows "--" for those columns).
 */
export async function readCachedFundamentalsBulk(
  symbols: string[]
): Promise<Map<string, FundamentalsRow>> {
  const result = new Map<string, FundamentalsRow>();
  if (!redis) return result;

  const cleanSymbols = uniqueClean(symbols);
  if (!cleanSymbols.length) return result;

  try {
    const keys = cleanSymbols.map((s) => `${FUND_KEY_PREFIX}${s}`);
    const values = await redis.mget<FundamentalsRow[]>(...keys);
    cleanSymbols.forEach((symbol, i) => {
      const row = values[i];
      if (row && typeof row === "object" && row.symbol) {
        result.set(symbol, {
          symbol,
          marketCap: num(row.marketCap),
          peRatio: num(row.peRatio),
          industry: str(row.industry),
          sector: str(row.sector),
          updatedAt: str(row.updatedAt) ?? "",
        });
      }
    });
  } catch {
    // Best-effort: a read failure just means "no fundamentals this render".
  }

  return result;
}

async function readCachedProfilesBulk(
  symbols: string[]
): Promise<Map<string, ProfileLite>> {
  const result = new Map<string, ProfileLite>();
  if (!redis) return result;
  try {
    const keys = symbols.map((s) => `${PROFILE_KEY_PREFIX}${s}`);
    const values = await redis.mget<ProfileLite[]>(...keys);
    symbols.forEach((symbol, i) => {
      const row = values[i];
      if (row && typeof row === "object") {
        result.set(symbol, {
          industry: str(row.industry),
          sector: str(row.sector),
          marketCap: num(row.marketCap),
        });
      }
    });
  } catch {
    // fail open
  }
  return result;
}

/**
 * Cache marketCap/sector/industry/beta/lastAnnualDividend from FMP's
 * company-screener response -- the SAME call app/api/market/route.ts already
 * makes once per master-list rebuild for discovery candidates. That call was
 * discarding every field except `symbol`; this captures the rest instead of a
 * second fetch.
 *
 * These fields are static-ish (they do not need to be live), so this
 * eliminates most of the profile-fetch tail warmFundamentals otherwise needs
 * for industry/sector -- see the profileMisses computation in
 * warmFundamentals below.
 *
 * Fail-open throughout: a caching failure here should never break discovery,
 * which is what actually calls this.
 */
export async function cacheScreenerFundamentals(
  rows: unknown[]
): Promise<number> {
  if (!redis || !Array.isArray(rows) || !rows.length) return 0;

  const now = new Date().toISOString();
  const pipeline = redis.pipeline();
  let queued = 0;

  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const symbol = cleanSymbol(String(row?.symbol ?? ""));
    if (!symbol) continue;

    const entry: ScreenerFundamentalsRow = {
      symbol,
      marketCap: num(row?.marketCap),
      sector: str(row?.sector),
      industry: str(row?.industry),
      beta: num(row?.beta),
      lastAnnualDividend: num(row?.lastAnnualDividend),
      updatedAt: now,
    };

    pipeline.set(`${SCREENER_FUND_KEY_PREFIX}${symbol}`, entry, {
      ex: SCREENER_FUND_TTL_SECONDS,
    });
    queued++;
  }

  if (!queued) return 0;

  try {
    await pipeline.exec();
  } catch {
    return 0; // fail open
  }

  return queued;
}

/**
 * Redis-ONLY bulk read of the screener-sourced fundamentals rows. Exported
 * (2026-08-07) because the sector index in lib/server/sectorUniverse.ts needs
 * the widest possible sector coverage: the per-symbol `fundamentals` rows above
 * only cover symbols warmFundamentals has actually reached (PROFILE_MAX_PER_RUN
 * caps that at 120/run), whereas these rows land for every symbol the daily
 * company-screener call returns. Reading both and preferring whichever has a
 * sector materially reduces the "unclassified" tail. Body unchanged.
 */
export async function readCachedScreenerFundamentals(
  symbols: string[]
): Promise<Map<string, ScreenerFundamentalsRow>> {
  const result = new Map<string, ScreenerFundamentalsRow>();
  if (!redis || !symbols.length) return result;

  try {
    const keys = symbols.map((s) => `${SCREENER_FUND_KEY_PREFIX}${s}`);
    const values = await redis.mget<ScreenerFundamentalsRow[]>(...keys);
    symbols.forEach((symbol, i) => {
      const row = values[i];
      if (row && typeof row === "object" && row.symbol) {
        result.set(symbol, row);
      }
    });
  } catch {
    // fail open
  }

  return result;
}

// Batch quote -> marketCap + PE for many symbols in one FMP call. Falls back to
// per-symbol stable/quote for a chunk whose batch call fails (so this still
// works on FMP plans without the batch endpoint).
async function fetchQuoteFundamentals(
  symbols: string[],
  apiKey: string,
  wait: WaitBudget
): Promise<Map<string, { marketCap: number | null; peRatio: number | null }>> {
  const out = new Map<string, { marketCap: number | null; peRatio: number | null }>();

  // stable/batch-quote is not on every FMP plan -- it answers 402 on Starter,
  // which is what this project runs. One rejection is enough to know: stop
  // spending a reserved call slot per chunk on a call that cannot succeed.
  let batchAvailable = true;

  for (const group of chunk(symbols, QUOTE_CHUNK_SIZE)) {
    let ok = false;

    if (batchAvailable) {
      if (!(await awaitFmpCapacity(wait))) return out;
      try {
        await reserveFmpCallSlot();
        const url = `https://financialmodelingprep.com/stable/batch-quote?symbols=${encodeURIComponent(
          group.join(",")
        )}&apikey=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          next: { revalidate: 300 },
          headers: { accept: "application/json" },
        });
        if (res.status === 401 || res.status === 402 || res.status === 403) {
          batchAvailable = false;
        } else if (res.ok) {
          const json = await res.json().catch(() => null);
          if (Array.isArray(json) && json.length) {
            for (const row of json) {
              const sym = cleanSymbol(row?.symbol);
              if (!sym) continue;
              out.set(sym, { marketCap: num(row?.marketCap), peRatio: num(row?.pe) });
            }
            ok = true;
          }
        }
      } catch {
        ok = false;
      }
    }

    if (!ok) {
      // Per-symbol fallback for this chunk.
      for (const sym of group) {
        if (!(await awaitFmpCapacity(wait))) return out;
        try {
          await reserveFmpCallSlot();
          const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
            sym
          )}&apikey=${encodeURIComponent(apiKey)}`;
          const res = await fetch(url, {
            next: { revalidate: 300 },
            headers: { accept: "application/json" },
          });
          if (!res.ok) continue;
          const json = await res.json().catch(() => null);
          const row = Array.isArray(json) ? json[0] : json;
          if (row) out.set(sym, { marketCap: num(row?.marketCap), peRatio: num(row?.pe) });
        } catch {
          // skip this symbol
        }
      }
    }
  }

  return out;
}

async function fetchProfile(sym: string, apiKey: string): Promise<ProfileLite | null> {
  try {
    await reserveFmpCallSlot();
    const url = `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(
      sym
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { next: { revalidate: 300 }, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const row = Array.isArray(json) ? json[0] : json;
    if (!row) return null;
    return {
      industry: str(row?.industry),
      sector: str(row?.sector),
      marketCap: num(row?.marketCap) ?? num(row?.mktCap),
    };
  } catch {
    return null;
  }
}

/**
 * Cron/warm worker: refresh cached fundamentals for the given universe.
 *   - industry/sector: reuse cached profiles, then the screener-fundamentals
 *     cache (free -- see cacheScreenerFundamentals), and only THEN fall back to
 *     a fresh profile fetch for whatever neither source covers, capped per run
 *   - then market cap + PE via quote (daily-fresh)
 * Writes one combined FundamentalsRow per symbol (26h TTL). Fail-open and
 * budget-guarded throughout. Returns a small summary for the job response.
 */
export async function warmFundamentals(symbols: string[]) {
  const apiKey = process.env.FMP_API_KEY;
  const cleanSymbols = uniqueClean(symbols);

  if (!redis || !apiKey || !cleanSymbols.length) {
    return {
      ok: false,
      reason: !redis ? "no-redis" : !apiKey ? "no-fmp-key" : "no-symbols",
      written: 0,
    };
  }

  const wait: WaitBudget = { remainingMs: CAPACITY_WAIT_BUDGET_MS };

  // 1) industry/sector. Reuse cached profiles first, then the screener
  // fundamentals cache (zero FMP cost -- populated as a side effect of the
  // company-screener call app/api/market/route.ts already makes), and only
  // fetch a fresh profile for whatever neither source already covers. This
  // stage runs before quotes deliberately. Quotes need one call per symbol on
  // plans without batch-quote -- roughly the whole universe -- so running it
  // first left the profile stage staring at a drained budget, and profiles
  // (or the screener cache) are the only source of industry/sector. Profiles
  // are also far cheaper in aggregate: they carry a 30-day TTL, so in the
  // steady state this stage fetches a handful of symbols a day, not the whole
  // universe -- and with the screener cache in place, that handful is now
  // just the symbols the screener's own filter excludes (sub-$1B market cap,
  // non NASDAQ/NYSE, or funds/ETFs).
  const cachedProfiles = await readCachedProfilesBulk(cleanSymbols);
  const screenerFund = await readCachedScreenerFundamentals(cleanSymbols);
  const profileMisses = cleanSymbols.filter(
    (s) => !cachedProfiles.has(s) && !screenerFund.has(s)
  );
  let profileFetches = 0;
  for (const sym of profileMisses) {
    if (profileFetches >= PROFILE_MAX_PER_RUN) break;
    if (!(await awaitFmpCapacity(wait))) break;
    const profile = await fetchProfile(sym, apiKey);
    if (profile) {
      cachedProfiles.set(sym, profile);
      profileFetches++;
      try {
        await redis.set(`${PROFILE_KEY_PREFIX}${sym}`, profile, { ex: PROFILE_TTL_SECONDS });
      } catch {
        // fail open
      }
    }
  }

  // 2) market cap + PE for everyone.
  const quoteMap = await fetchQuoteFundamentals(cleanSymbols, apiKey, wait);

  // 3) write combined records for every symbol we have any data for.
  const now = new Date().toISOString();
  let written = 0;
  const writePipeline = redis.pipeline();
  for (const sym of cleanSymbols) {
    const q = quoteMap.get(sym);
    const p = cachedProfiles.get(sym);
    const sc = screenerFund.get(sym);
    if (!q && !p && !sc) continue;
    const row: FundamentalsRow = {
      symbol: sym,
      marketCap: q?.marketCap ?? p?.marketCap ?? sc?.marketCap ?? null,
      peRatio: q?.peRatio ?? null,
      industry: p?.industry ?? sc?.industry ?? null,
      sector: p?.sector ?? sc?.sector ?? null,
      updatedAt: now,
    };
    writePipeline.set(`${FUND_KEY_PREFIX}${sym}`, row, { ex: FUND_TTL_SECONDS });
    written++;
  }
  if (written > 0) {
    try {
      await writePipeline.exec();
    } catch {
      // fail open -- a failed warm just means "--" columns until next run
    }
  }

  return {
    ok: true,
    universe: cleanSymbols.length,
    quotesFetched: quoteMap.size,
    screenerCovered: screenerFund.size,
    profileMisses: profileMisses.length,
    profileFetches,
    profilesKnown: cachedProfiles.size,
    waitedMs: CAPACITY_WAIT_BUDGET_MS - wait.remainingMs,
    written,
  };
}
