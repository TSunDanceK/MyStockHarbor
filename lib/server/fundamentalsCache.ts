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
import { fmpFetch } from "./fmpUsage";
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
  const needsIndustry = cleanSymbols.filter(
    (s) => !cachedProfiles.get(s)?.industry && !screenerFund.get(s)?.industry
  );
  // Asked recently and FMP had nothing. Deferred, never excluded -- the mark
  // expires (PROFILE_EMPTY_TTL_SECONDS) and the symbol returns to the queue.
  const profileMisses = needsIndustry.filter((s) => !emptyProfileMarks.has(s));
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
      if (profile.industry) {
        profileIndustriesFound++;
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
  const rotated = rotateFrom(cleanSymbols, quoteOffset);

  const { quotes: quoteMap, consumed: quotesConsumed, batchQuoteAvailable } =
    await fetchQuoteFundamentals(rotated, apiKey, wait);

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
  for (const sym of cleanSymbols) {
    if (cachedProfiles.get(sym)?.industry || screenerFund.get(sym)?.industry) industryKnown++;
  }

  // Incomplete quote coverage must never be silent.
  //
  // Read this WITH quoteOffset/quoteOffsetNext, not alone: under rotation a
  // partial run is expected by design, so this line firing is not by itself a
  // fault -- `lapRuns` is the number to watch. What would be a fault is
  // quotesConsumed staying at 0, or lapRuns not falling after the screener cron
  // and the cadence change land.
  if (quoteMap.size < cleanSymbols.length) {
    const lapRuns = quotesConsumed > 0 ? Math.ceil(cleanSymbols.length / quotesConsumed) : Infinity;
    console.warn(
      `[fundamentals] quote coverage ${quoteMap.size}/${cleanSymbols.length} this run` +
        ` — offset ${quoteOffset} -> ${nextQuoteOffset}, ${quotesConsumed} consumed,` +
        ` ~${lapRuns === Infinity ? "never" : lapRuns} runs per full lap` +
        `${batchQuoteAvailable ? "" : " (batch-quote unavailable on this plan — one call per symbol)"}`
    );
  }

  return {
    ok: true,
    universe: cleanSymbols.length,
    quotesFetched: quoteMap.size,
    // Where the rotation started and where it left off. Two consecutive runs
    // reporting the same pair means the offset is not advancing.
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
    needsIndustry: needsIndustry.length,
    profileMisses: profileMisses.length,
    profileFetches,
    profileIndustriesFound,
    profileEmptyMarked,
    emptyMarked: emptyProfileMarks.size,
    profilesKnown: cachedProfiles.size,
    industryKnown,
    industryMissing: cleanSymbols.length - industryKnown,
    profileMaxPerRun: PROFILE_MAX_PER_RUN,
    waitedMs: CAPACITY_WAIT_BUDGET_MS - wait.remainingMs,
    written,
  };
}
