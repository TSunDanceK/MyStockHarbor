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
import { readPricePoolBulk } from "./pricePool";
import { fmpFetch, flushFmpUsage } from "./fmpUsage";
import { claimStalest, deferSymbol, markRefreshed, registerSymbols } from "./stalenessQueue";
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
// SETs per Upstash pipeline. Matches the 500 dynamicUniverseCache already uses
// for the same reason: the command count is unchanged, this only bounds the
// size of one request body.
const SCREENER_WRITE_CHUNK = 500;
const SCREENER_FUND_KEY_PREFIX = "msh:pickers:screener-fundamentals:v1:";
// TTL comfortably spans the master-list rebuild cadence (~daily, gated by
// ensureDailyShuffledMasterList's Eastern-day rollover in app/api/market) so a
// delayed rebuild doesn't empty the cache before the next one lands.
const SCREENER_FUND_TTL_SECONDS = 60 * 60 * 30; // 30h

// A symbol FMP genuinely has no industry for (an ETF, a trust, a recent
// listing). Recorded so it is retried periodically rather than either
// re-fetched on every single run or excluded forever.
//
// Both of those failure modes are real and this key sits exactly between them.
// Excluding forever is the bug fixed below -- it is what kept GFS/TSEM/ALAB off
// /semiconductor-stocks. Re-fetching every run is what the naive form of that
// fix produces: `fetchProfile` returns a truthy object with `industry: null`
// for such a symbol, so it never stops qualifying as a miss, and it would
// occupy the PROFILE_MAX_PER_RUN budget every day forever, starving genuinely
// new symbols and slowing the very backfill this change exists to enable.
//
// A week is chosen against the daily cron: long enough that a permanently
// empty symbol costs one attempt a week rather than seven, short enough that a
// newly listed company picks up its industry within a week of FMP having it.
const PROFILE_EMPTY_KEY_PREFIX = "msh:pickers:profile-noindustry:v1:";
const PROFILE_EMPTY_TTL_SECONDS = 60 * 60 * 24 * 7; // 7d

// Where the quote stage stopped last run, as an index into the universe.
//
// The quote stage cannot finish in one run: stable/batch-quote answers 402 on
// this plan (see fetchQuoteFundamentals), so it falls back to ONE FMP call per
// symbol, and the shared 90s wait budget runs out partway. Measured 2026-08-22:
// quotesFetched 357 of 755, waitedMs 90000 -- the entire budget spent.
//
// It restarted from index 0 every run, so it re-fetched the same head of the
// list every day and the tail beyond the cut was NEVER covered -- not "covered
// slowly", never. Raising the cadence without this would just redo the same
// head more often.
//
// Deliberately NOT a TTL'd key: the offset is progress, not a cache. Losing it
// costs a restart from the top rather than a wrong answer, so it fails safe,
// but there is no reason to expire it.
const QUOTE_OFFSET_KEY = "msh:pickers:quote-offset:v1";

// Bounds so a single warm run can never run away with the FMP budget.
const QUOTE_CHUNK_SIZE = 50; // batch-quote symbols per FMP call

// ─────────────────────────────────────────────────────────────────────────────
// THE QUOTE STAGE IS A FALLBACK NOW, NOT THE SOURCE.
//
// This stage existed to fetch marketCap and peRatio -- exactly two fields --
// and batch-quote answers 402 on this plan, so it was ONE stable/quote CALL PER
// SYMBOL, hourly, forever. The price pool has held both for every symbol in the
// same universe the whole time: PricePoolRow carries `marketCap` and `pe`, and
// readPricePoolBulk returns them in a single HMGET with no FMP call at all.
// Both jobs take their work list from the same getWarmTargetSymbols, so the
// coverage is identical by construction.
//
// So the pool is read first and FMP is asked only about symbols the pool has no
// row for -- a newly admitted ticker, or one the price rotation has not reached
// yet.
//
// WHAT THIS ALSO REMOVES. The comment further down records that the profile
// stage spends the shared 90s wait budget FIRST and that the quote stage then
// "return out"s when it is dry -- "the cost of fixing sectors is paid in P/E
// coverage, silently". That trade is gone: the pool read costs no budget, so
// the two stages have stopped competing. Sectors no longer cost P/E.
//
// THE FALLBACK IS CAPPED so that a cold or emptied pool degrades visibly rather
// than silently reinstating the old per-symbol rotation. If poolMisses exceeds
// this the run says so on its record instead of quietly spending the universe.
const QUOTE_FALLBACK_MAX_PER_RUN = 100;
// ─────────────────────────────────────────────────────────────────────────────
// Cap on fresh profile fetches per run.
//
// Overridable via MSH_PROFILE_MAX_PER_RUN for a BACKFILL. Fixing the exclusion
// below turns every previously locked-out symbol into a miss at once, and the
// cron is daily (`30 7 * * *` in vercel.json), so at 120 a backlog of N takes
// ceil(N/120) DAYS to clear. Raise the env var for a few runs, then remove it.
//
// Raising it is safe but not free: every profile fetch still goes through
// reserveFmpCallSlot (300/min) and the shared 90s wait budget, so a large
// value does not breach the FMP limit -- it just means the run spends longer
// waiting, against `maxDuration = 300` on the route. Values into the low
// hundreds are fine; the whole universe in one run is not.
const PROFILE_MAX_PER_RUN = (() => {
  const raw = Number(process.env.MSH_PROFILE_MAX_PER_RUN);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120;
})();
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
 * Symbols we asked FMP about within PROFILE_EMPTY_TTL_SECONDS and which came
 * back with no industry. See PROFILE_EMPTY_KEY_PREFIX.
 *
 * Fails OPEN to the empty set, and that direction is deliberate: a Redis blip
 * then means "retry these symbols", costing at most one extra run of profile
 * fetches. Failing closed would mean "skip them", which is the exclusion this
 * whole change removes -- and it would be invisible, because a skipped symbol
 * and a symbol with no industry render identically.
 */
async function readEmptyProfileMarks(symbols: string[]): Promise<Set<string>> {
  const marked = new Set<string>();
  if (!redis || !symbols.length) return marked;
  try {
    const keys = symbols.map((s) => `${PROFILE_EMPTY_KEY_PREFIX}${s}`);
    const values = await redis.mget<(string | number | null)[]>(...keys);
    symbols.forEach((symbol, i) => {
      if (values[i] != null) marked.add(symbol);
    });
  } catch {
    // fail open -- see above, the open direction is the safe one here
  }
  return marked;
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
  const entries: Array<{ symbol: string; entry: ScreenerFundamentalsRow }> = [];

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

    entries.push({ symbol, entry });
  }

  if (!entries.length) return 0;

  const written: string[] = [];

  try {
    // CHUNKED, NOT ONE PIPELINE. This built a single pipeline over every row,
    // which was ~1,000 SETs and fine. SCREENER_LIMIT is now 3,000, and 3,000
    // JSON-encoded SETs in one Upstash REST call is a several-hundred-KB POST
    // approaching the request-size limit.
    //
    // THE FAILURE WOULD HAVE BEEN SILENT AND TOTAL. The catch below returns 0,
    // and this function is the ONLY producer of the industry/sector backfill --
    // so an oversized pipeline writes nothing, reports `cached: 0`, and the
    // warning that fires says "industry backfill has no free source this
    // cycle". That reads as FMP having failed, which is exactly the
    // absence-vs-failure confusion the header of screenerFundamentals.ts exists
    // to record (claude/traps/absence-needs-the-producer-to-have-run.md).
    //
    // Chunking also means a partial failure is partial: 2,500 rows written and
    // one chunk lost beats losing all 3,000.
    for (let i = 0; i < entries.length; i += SCREENER_WRITE_CHUNK) {
      const group = entries.slice(i, i + SCREENER_WRITE_CHUNK);
      const pipeline = redis.pipeline();
      for (const { symbol, entry } of group) {
        pipeline.set(`${SCREENER_FUND_KEY_PREFIX}${symbol}`, entry, {
          ex: SCREENER_FUND_TTL_SECONDS,
        });
      }
      await pipeline.exec();
      for (const { symbol } of group) written.push(symbol);
    }
    // Staleness bookkeeping for the dataset this function IS the producer of.
    // Without it screenerFundamentals sits in the DATASETS registry with no
    // queue behind it, and the health page can only say "not instrumented" --
    // honest, but a gap where a one-line write would do.
    if (written.length) await markRefreshed("screenerFundamentals", written);
  } catch {
    // Whatever chunks landed before the throw are real and already written, so
    // report them rather than claiming nothing happened.
    return written.length; // fail open
  }

  return written.length;
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
/**
 * The universe reordered to start at `offset` and wrap around.
 *
 * ROTATE, do not slice. A slice would stop at the end of the list and a run
 * with budget to spare would sit idle rather than wrapping onto the head, so
 * the last window before the wrap would always be short-changed. Rotating keeps
 * every symbol eligible in a single run and lets the offset decide only where
 * the covering STARTS.
 *
 * The modulo is normalised for negative and non-integer input because the
 * offset comes back from Redis, where anything could have been written.
 */
function rotateFrom<T>(items: T[], offset: number): T[] {
  if (!items.length) return items;
  const n = items.length;
  const start = (((Math.floor(offset) || 0) % n) + n) % n;
  return start === 0 ? items : [...items.slice(start), ...items.slice(0, start)];
}

/**
 * Where the next run should start.
 *
 * `consumed <= 0` returns the offset unchanged: a run starved before it
 * attempted anything must not move the cursor, or it would skip a window that
 * nothing ever covered.
 */
function advanceOffset(offset: number, consumed: number, length: number): number {
  if (!length) return 0;
  const base = (((Math.floor(offset) || 0) % length) + length) % length;
  if (!Number.isFinite(consumed) || consumed <= 0) return base;
  return (base + Math.floor(consumed)) % length;
}

/**
 * Quote fundamentals for as many of `symbols` as the FMP budget allows, IN THE
 * ORDER GIVEN, reporting how far down the list it got.
 *
 * `consumed` is the number of list POSITIONS attempted, not the number of
 * successful quotes, and the caller advances its rotation offset by it. Those
 * differ whenever a symbol 404s or returns an unparseable row, and counting
 * successes instead would make the offset stall on a permanently bad ticker --
 * re-attempting it every run and never reaching the symbols behind it. Position
 * is what "where did I stop" means.
 */
async function fetchQuoteFundamentals(
  symbols: string[],
  apiKey: string,
  wait: WaitBudget
): Promise<{
  quotes: Map<string, { marketCap: number | null; peRatio: number | null }>;
  consumed: number;
  batchQuoteAvailable: boolean;
}> {
  const out = new Map<string, { marketCap: number | null; peRatio: number | null }>();
  let consumed = 0;

  // stable/batch-quote is not on every FMP plan -- it answers 402 on Starter,
  // which is what this project runs. One rejection is enough to know: stop
  // spending a reserved call slot per chunk on a call that cannot succeed.
  let batchAvailable = true;

  for (const group of chunk(symbols, QUOTE_CHUNK_SIZE)) {
    let ok = false;

    if (batchAvailable) {
      if (!(await awaitFmpCapacity(wait))) return { quotes: out, consumed, batchQuoteAvailable: batchAvailable };
      try {
        await reserveFmpCallSlot();
        const url = `https://financialmodelingprep.com/stable/batch-quote?symbols=${encodeURIComponent(
          group.join(",")
        )}&apikey=${encodeURIComponent(apiKey)}`;
        const res = await fmpFetch(url, {
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
      // One call covered the whole chunk, so the whole chunk is behind us.
      if (ok) consumed += group.length;
    }

    if (!ok) {
      // Per-symbol fallback for this chunk.
      for (const sym of group) {
        if (!(await awaitFmpCapacity(wait))) return { quotes: out, consumed, batchQuoteAvailable: batchAvailable };
        consumed++;
        try {
          await reserveFmpCallSlot();
          const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
            sym
          )}&apikey=${encodeURIComponent(apiKey)}`;
          const res = await fmpFetch(url, {
            next: { revalidate: 300 },
            headers: { accept: "application/json" },
          });
          if (!res.ok) continue;
          const json = await res.json().catch(() => null);
          const row = Array.isArray(json) ? json[0] : json;
          if (row) out.set(sym, { marketCap: num(row?.marketCap), peRatio: num(row?.pe) });
        } catch {
          // skip this symbol -- still consumed, see the `consumed` note above
        }
      }
    }
  }

  return { quotes: out, consumed, batchQuoteAvailable: batchAvailable };
}

async function fetchProfile(sym: string, apiKey: string): Promise<ProfileLite | null> {
  try {
    await reserveFmpCallSlot();
    const url = `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(
      sym
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fmpFetch(url, { next: { revalidate: 300 }, headers: { accept: "application/json" } });
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
  // universe.
  //
  // WHAT COUNTS AS A MISS IS THE WHOLE POINT, and it was wrong until
  // 2026-08-22. This tested `screenerFund.has(s)` -- that a screener ROW
  // EXISTS -- when what the stage needs is that the row has an INDUSTRY.
  // `ScreenerFundamentalsRow.industry` is `string | null`, and
  // cacheScreenerFundamentals stores a row whenever `row.symbol` is truthy, so
  // any symbol whose screener row carried a null industry was treated as
  // covered and never sent to the profile fetch -- the one call that could
  // have supplied it. Nothing expired it back into contention either: the
  // screener call refreshes that row every rebuild, so the exclusion renewed
  // itself indefinitely. Re-running the cron could never fix it, because the
  // filter ran before the fetch loop and skipped the same symbols every time.
  //
  // The user-visible damage was silent and was NOT a missing column.
  // /semiconductor-stocks selects on `industry === "Semiconductors"` and
  // /cheap-tech-stocks on `sector === "Technology"`, so an affected company was
  // not shown with a dash -- it was absent from the page. The best-performing
  // page in that cluster had been serving an incomplete list.
  //
  // Same fix as claude/seo-recovery-progress-2026-08-17.md ("prefer whichever
  // source has a sector"), which was applied to the read path and never to this
  // one. The write below already does the right thing
  // (`p?.industry ?? sc?.industry ?? null`); only the SELECTION of what to
  // fetch was still asking the wrong question.
  //
  // What the remaining misses actually are: symbols no source has an industry
  // for yet -- those outside the screener's own filter (sub-floor market cap,
  // non NASDAQ/NYSE, funds/ETFs) AND those inside it whose row came back with a
  // null industry.
  const cachedProfiles = await readCachedProfilesBulk(cleanSymbols);
  const screenerFund = await readCachedScreenerFundamentals(cleanSymbols);
  const emptyProfileMarks = await readEmptyProfileMarks(cleanSymbols);
  // BOTH FIELDS, not just industry. `sector` and `industry` are SEPARATE
  // nullable columns on ScreenerFundamentalsRow, and a row can carry one without
  // the other. Testing only `industry` marked such a symbol as covered, so it
  // never got a profile fetch and its sector stayed null forever -- which left
  // /cheap-tech-stocks (`sector` = Technology) permanently truncated. Exactly the
  // defect #337 fixed for /semiconductor-stocks, one field over.
  const needsIndustry = cleanSymbols.filter((s) => {
    const profile = cachedProfiles.get(s);
    const screener = screenerFund.get(s);
    const noIndustry = !profile?.industry && !screener?.industry;
    const noSector = !profile?.sector && !screener?.sector;
    return noIndustry || noSector;
  });
  // Asked recently and FMP had nothing. Deferred, never excluded -- the mark
  // expires (PROFILE_EMPTY_TTL_SECONDS) and the symbol returns to the queue.
  const profileMisses = needsIndustry.filter((s) => !emptyProfileMarks.has(s));
  // THE TRADE THIS CHANGE MAKES, MEASURED RATHER THAN ASSUMED.
  //
  // Widening the filter above turns every sector-only gap into a profile miss at
  // once, so the profile stage now reaches PROFILE_MAX_PER_RUN on runs where it
  // previously ran out of work. That stage spends the SHARED 90s wait budget
  // FIRST, and fetchQuoteFundamentals `return out`s when the budget is dry
  // rather than degrading -- so the cost of fixing sectors is paid in P/E
  // coverage, silently, unless it is counted.
  //
  // Recorded before and after so the split is a number in the run summary. If
  // waitAfterProfilesMs collapses toward zero, run the backlog out of band with
  // MSH_PROFILE_MAX_PER_RUN instead of letting the daily job absorb it.
  const waitBeforeProfilesMs = wait.remainingMs;
  let profileFetches = 0;
  let profileIndustriesFound = 0;
  let profileEmptyMarked = 0;
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
      // ALSO BOTH FIELDS. The marker used to be set on `!profile.industry`
      // alone, so a profile carrying an industry but no sector was cached,
      // never marked, and never revisited -- it would be re-selected by the
      // filter above every run and re-fetched forever, or (before that filter
      // was fixed) never selected at all. Either way the sector never arrived.
      if (profile.industry && profile.sector) {
        profileIndustriesFound++;
        // Staleness bookkeeping. Only on a REAL industry: a profile that came
        // back without one has not been refreshed in any sense the health page
        // cares about, and scoring it as fresh would make a permanently empty
        // symbol read green.
        await markRefreshed("profile", [sym]);
      } else {
        // Asked, and FMP had no industry. Mark it so the next few runs spend
        // their budget on symbols that might actually yield one.
        //
        // Only ever set after a SUCCESSFUL fetch that genuinely lacked an
        // industry. `fetchProfile` returns null on a network error, a non-ok
        // status or a parse failure, and that path deliberately falls through
        // here without marking -- otherwise one bad FMP minute would defer a
        // healthy symbol for a week, which is a small version of the bug being
        // fixed.
        profileEmptyMarked++;
        try {
          await redis.set(`${PROFILE_EMPTY_KEY_PREFIX}${sym}`, 1, { ex: PROFILE_EMPTY_TTL_SECONDS });
        } catch {
          // fail open
        }
        // Queue rule 1: defer, never exclude. Without this a symbol FMP has no
        // industry for is permanently the stalest thing in the set and holds
        // the front of the queue forever, so "do the stalest first" quietly
        // becomes "retry the broken ones forever". Same window as the
        // empty-marker above so the two cannot disagree.
        await deferSymbol("profile", sym, PROFILE_EMPTY_TTL_SECONDS);
      }
    }
  }

  // 2) market cap + PE, resuming where the last run stopped.
  //
  // The list is ROTATED rather than sliced, so a run that gets further than
  // expected simply wraps onto the head again instead of stopping short. Every
  // symbol is still eligible in a single run if the budget allows; the offset
  // only decides where the covering starts.
  let quoteOffset = 0;
  if (redis) {
    try {
      const stored = Number(await redis.get<number>(QUOTE_OFFSET_KEY));
      if (Number.isFinite(stored) && stored >= 0) quoteOffset = Math.floor(stored) % cleanSymbols.length;
    } catch {
      // fail open -- start from the top, which is exactly the old behaviour
    }
  }
  // STALEST-FIRST when the queue can answer, rotation when it cannot.
  //
  // The rotation is a good approximation of "cover everything eventually": it
  // guarantees no symbol is skipped forever, but it spends calls in list order
  // regardless of what actually went stale. The staleness set knows, so ask it
  // (spec, "Shared plumbing" -- the warm job pops the stalest N).
  //
  // THE FALLBACK IS NOT DECORATION. On the deploy that ships this the set is
  // empty, and it stays partial until a few runs have populated it. Switching
  // unconditionally would mean a run that quotes nothing, on the job whose
  // coverage this whole line of work exists to fix -- a fix that breaks the
  // thing it fixes on the way in. So the set is used only when it can order
  // essentially the whole universe, and the rotation carries it until then.
  const stalestFirst = await claimStalest("fundamentals", cleanSymbols.length);
  const known = new Set(stalestFirst);
  const useStalest = stalestFirst.length >= Math.floor(cleanSymbols.length * 0.9);
  // Anything the queue has not heard of yet goes first: never-seen beats
  // long-unrefreshed, and it keeps the order a permutation of the universe
  // rather than a subset of it.
  const quoteOrder = useStalest
    ? [...cleanSymbols.filter((s) => !known.has(s)), ...stalestFirst.filter((s) => cleanSymbols.includes(s))]
    : rotateFrom(cleanSymbols, quoteOffset);

  // THE POOL FIRST. One HMGET, no FMP call, for the two fields this stage
  // exists to produce.
  //
  // NO AGE TEST, DELIBERATELY. Since #395 the price pool only refreshes inside
  // the buffered US session, so a row is legitimately 15 hours old at 07:00 and
  // 63 across a weekend. Both fields here are CLOSE-DERIVED -- market cap is
  // shares x last price, and P/E is that price over trailing EPS -- so an
  // overnight row is not stale, it is the correct answer: the last traded price
  // IS the price. Treating age as staleness would mean re-fetching the whole
  // universe every morning to receive the identical numbers back.
  //
  // ABSENCE, NOT AGE, IS THE HEALTH SIGNAL. PRICE_POOL_HASH_TTL_SECONDS expires
  // the whole hash if warm-price-pool genuinely stops running, so a missing row
  // already means "nobody is maintaining this" while an old one means "the
  // market has been shut". Those are different questions and only the first is
  // this stage's problem.
  const pool = await readPricePoolBulk(cleanSymbols);
  const quoteMap = new Map<string, { marketCap: number | null; peRatio: number | null }>();
  const poolMisses: string[] = [];
  for (const sym of quoteOrder) {
    const row = pool.get(sym);
    // A row carrying NEITHER field is not a hit. It happens: a cold-seeded row
    // (seedColdPricePoolRows) has a price but a null pe, and counting it would
    // permanently exclude that symbol from the one path that could fill it in.
    if (row && (row.marketCap != null || row.pe != null)) {
      quoteMap.set(sym, { marketCap: row.marketCap, peRatio: row.pe });
    } else {
      poolMisses.push(sym);
    }
  }
  const poolHits = quoteMap.size;
  const fallbackOrder = poolMisses.slice(0, QUOTE_FALLBACK_MAX_PER_RUN);
  const fallbackDeferred = poolMisses.length - fallbackOrder.length;

  const { quotes: fetchedQuotes, consumed: quotesConsumed, batchQuoteAvailable } =
    await fetchQuoteFundamentals(fallbackOrder, apiKey, wait);
  // Fetched wins over pooled for the same symbol -- it cannot happen today
  // (only misses are fetched) but a future edit that widens the fallback should
  // not silently prefer the older value.
  for (const [sym, row] of fetchedQuotes) quoteMap.set(sym, row);

  // Advance by POSITIONS attempted, not quotes returned -- see the note on
  // fetchQuoteFundamentals.
  const nextQuoteOffset = advanceOffset(quoteOffset, quotesConsumed, cleanSymbols.length);
  if (redis && quotesConsumed > 0) {
    try {
      await redis.set(QUOTE_OFFSET_KEY, nextQuoteOffset);
    } catch {
      // fail open -- worst case the next run re-covers this window
    }
  }

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

  // Industry coverage AFTER this run, computed from the same two sources the
  // write above uses, so the number means what the pages mean by it.
  //
  // This is the figure that actually answers "did it work". /semiconductor-
  // stocks and /cheap-tech-stocks select ON industry/sector, so a symbol
  // without one is not a row with a dash -- it is a row that does not exist.
  // `written` cannot see that: it counts symbols with ANY data, and a symbol
  // with a market cap and no industry counts toward it while still being
  // invisible on both pages. Every other field in this summary was equally
  // blind to the exclusion, which is part of why it survived so long.
  //
  // Read it across runs. `industryMissing` should fall run over run while the
  // backlog drains and then settle at roughly `emptyMarked` -- the symbols FMP
  // genuinely has nothing for. If it does not move at all, the cron is not
  // running; check for the log line before assuming the fix failed.
  let industryKnown = 0;
  let sectorKnown = 0;
  for (const sym of cleanSymbols) {
    if (cachedProfiles.get(sym)?.industry || screenerFund.get(sym)?.industry) industryKnown++;
    // Counted separately, because the two genuinely diverge -- that divergence
    // IS the bug this change fixes, and a single "profile known" figure would
    // have hidden it. Reported so the incidence is a number rather than an
    // assumption (claude/traps/measuring-the-wrong-layer.md).
    if (cachedProfiles.get(sym)?.sector || screenerFund.get(sym)?.sector) sectorKnown++;
  }

  // Staleness bookkeeping for the health page and for future stalest-first
  // selection. registerSymbols is `nx`, so calling it with the whole universe
  // every run seeds newcomers at score 0 (never refreshed, sorts to the front,
  // counts as a coverage gap) without ever overwriting a real refresh time.
  //
  // Without this the set would only ever contain symbols that already
  // succeeded, so a dataset missing half the universe would report 100% fresh
  // on the half it has -- coverage that cannot see what is absent.
  await registerSymbols("fundamentals", cleanSymbols);
  await registerSymbols("profile", cleanSymbols);
  if (quoteMap.size) await markRefreshed("fundamentals", [...quoteMap.keys()]);

  // Write the buffered FMP byte samples once, at the end, rather than a Redis
  // round-trip per FMP response. This run makes ~477 calls and already spends
  // its full 90s wait budget, so per-call writes would have made the meter a
  // measurable cost of the job it measures. Awaited so the samples are durable
  // before the route returns rather than relying on after().
  await flushFmpUsage();

  // Incomplete quote coverage must never be silent.
  //
  // Read this WITH quoteOffset/quoteOffsetNext, not alone: under rotation a
  // partial run is expected by design, so this line firing is not by itself a
  // fault -- `lapRuns` is the number to watch. What would be a fault is
  // quotesConsumed staying at 0, or lapRuns not falling after the screener cron
  // and the cadence change land.
  if (quoteMap.size < cleanSymbols.length) {
    console.warn(
      `[fundamentals] quote coverage ${quoteMap.size}/${cleanSymbols.length} this run` +
        ` — ${poolHits} from the price pool, ${quotesConsumed} fetched for pool misses` +
        `${fallbackDeferred > 0 ? `, ${fallbackDeferred} misses deferred past the ${QUOTE_FALLBACK_MAX_PER_RUN} cap` : ""}` +
        `${batchQuoteAvailable ? "" : " (batch-quote unavailable on this plan — one call per symbol)"}`
    );
  }

  return {
    ok: true,
    universe: cleanSymbols.length,
    quotesFetched: quoteMap.size,
    // WHERE THE TWO FIELDS CAME FROM. poolHits is the saving, in calls, and
    // poolMisses is what it cost. A run where poolMisses climbs toward the
    // universe means the price pool is not being maintained -- which is a
    // warm-price-pool problem showing up here, and is exactly the shape that
    // hid for a night when the market-hours gate stopped resetting the pool
    // hash's TTL. fallbackDeferred is non-zero only when the miss list exceeds
    // QUOTE_FALLBACK_MAX_PER_RUN, i.e. when this stage has quietly turned back
    // into the per-symbol rotation it replaced.
    poolHits,
    poolMisses: poolMisses.length,
    fallbackDeferred,
    // Where the rotation started and where it left off. Two consecutive runs
    // reporting the same pair means the offset is not advancing.
    // Which selection actually ran. Without this, "the staleness queue is
    // live" is an assumption rather than an observation -- and a silently
    // never-satisfied condition is how an inert feature looks from outside.
    quoteSelection: useStalest ? "stalest-first" : "rotation",
    quoteQueueSize: stalestFirst.length,
    quoteOffset,
    quoteOffsetNext: nextQuoteOffset,
    quotesConsumed,
    // Measured per run rather than assumed from the comment in
    // fetchQuoteFundamentals: false means the 402 fallback is in force and the
    // per-symbol path is the permanent cost, not a transient one.
    batchQuoteAvailable,
    screenerCovered: screenerFund.size,
    // Symbols no source has an industry for, BEFORE deferring the ones FMP has
    // already been asked about. Reported alongside profileMisses so a large
    // gap between the two reads as "mostly deferred", not "mostly done".
    // How much of the shared 90s wait budget the profile stage left for the
    // quote stage. The quote stage exits early and silently when this hits
    // zero, so a falling number here is P/E coverage being traded for sector
    // coverage -- visible, rather than discovered later.
    waitBeforeProfilesMs,
    waitAfterProfilesMs: wait.remainingMs,
    waitSpentOnProfilesMs: waitBeforeProfilesMs - wait.remainingMs,
    needsIndustry: needsIndustry.length,
    profileMisses: profileMisses.length,
    profileFetches,
    profileIndustriesFound,
    profileEmptyMarked,
    emptyMarked: emptyProfileMarks.size,
    profilesKnown: cachedProfiles.size,
    industryKnown,
    industryMissing: cleanSymbols.length - industryKnown,
    sectorKnown,
    sectorMissing: cleanSymbols.length - sectorKnown,
    profileMaxPerRun: PROFILE_MAX_PER_RUN,
    waitedMs: CAPACITY_WAIT_BUDGET_MS - wait.remainingMs,
    written,
  };
}
