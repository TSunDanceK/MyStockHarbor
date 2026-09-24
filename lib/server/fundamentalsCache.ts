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
import { claimStalest, markRefreshed, registerSymbols } from "./stalenessQueue";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { hasFmpCapacity, reserveFmpCallSlot } from "./historyCache";
import { resolveProfileBulk } from "./staticProfile";

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
const FUND_TTL_SECONDS = 60 * 60 * 26; // 26h -- comfortably spans a daily warm

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

/**
 * Cron/warm worker: refresh cached fundamentals for the given universe.
 *   - industry/sector: A's SEC resolver only (10-K override -> SIC table);
 *     no FMP profile fetch since #553 COWORK #16
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

  // 1) industry/sector: NO FETCH. Since #553 COWORK #16 they come from A's
  // resolver alone (lib/server/staticProfile: 10-K override -> SIC table ->
  // major group), not from FMP. The per-symbol /stable/profile fetch, its 30-day
  // profile cache and its empty-marks are gone -- and with them ~2 MGETs over
  // the universe and up to 120 FMP calls + SETs a run. The screener cache is
  // still read for its market-cap fallback only.
  const screenerFund = await readCachedScreenerFundamentals(cleanSymbols);

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

  // ── SECTOR AND INDUSTRY THROUGH THE SHARED RESOLVER ───────────────────
  //
  // This read `p?.industry ?? sc?.industry ?? null` — two FMP caches (profile,
  // 30 d; screener, 30 h) and NOTHING under them. Once FMP stops refilling
  // both, every row loses its taxonomy, and /semiconductor-stocks and
  // /cheap-tech-stocks select ON those fields, so the rows do not render with
  // a dash: they vanish from the page (brief 2026-09-22 §2.4 item 1).
  // sectorUniverse.ts already fell back to the committed snapshot; this warm
  // did not. The FMP value still wins where there is one — resolveProfileBulk
  // puts the cache first — so a live row is unchanged.
  const resolvedTaxonomy = resolveProfileBulk(
    // cached: null -- no vendor label is a candidate (COWORK #16); the
    // resolver answers from the filing override or the SIC table.
    cleanSymbols.map((sym) => ({ symbol: sym, cached: null })),
    "pickers fundamentals warm"
  );

  // 3) write combined records for every symbol we have any data for.
  const now = new Date().toISOString();
  let written = 0;
  const writePipeline = redis.pipeline();
  for (const sym of cleanSymbols) {
    const q = quoteMap.get(sym);
    const sc = screenerFund.get(sym);
    const tax = resolvedTaxonomy.get(sym);
    if (!q && !sc && !tax?.sector && !tax?.industry) continue;
    const row: FundamentalsRow = {
      symbol: sym,
      marketCap: q?.marketCap ?? sc?.marketCap ?? null,
      peRatio: q?.peRatio ?? null,
      industry: tax?.industry ?? null,
      sector: tax?.sector ?? null,
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
  // COUNTED FROM THE RESOLVED VALUE, which is what the write above stores and
  // so what the pages select on. Counting the FMP caches alone would report the
  // snapshot's rescue as a loss (brief §2.4 item 1).
  let industryKnown = 0;
  let sectorKnown = 0;
  for (const sym of cleanSymbols) {
    const tax = resolvedTaxonomy.get(sym);
    if (tax?.industry) industryKnown++;
    // Counted separately, because the two genuinely diverge -- that divergence
    // IS the bug this change fixes, and a single "profile known" figure would
    // have hidden it. Reported so the incidence is a number rather than an
    // assumption (claude/traps/measuring-the-wrong-layer.md).
    if (tax?.sector) sectorKnown++;
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
    // Sector/industry now come from the SEC resolver; these count what it
    // answered (the misses are what the "Classification needed" helper lists).
    industryKnown,
    industryMissing: cleanSymbols.length - industryKnown,
    sectorKnown,
    sectorMissing: cleanSymbols.length - sectorKnown,
    waitedMs: CAPACITY_WAIT_BUDGET_MS - wait.remainingMs,
    written,
  };
}
