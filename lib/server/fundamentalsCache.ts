import { Redis } from "@upstash/redis";
import { priceProviderFor } from "./marketData/provider";
import { markRefreshed } from "./stalenessQueue";
import { PAGE_READ_CACHE } from "./redisCacheMode";

// Redis-cached fundamentals (market cap, PE ratio) for the picker universe:
// the per-symbol rows and the screener-fundamentals rows.
//
// THE WRITERS ARE RETIRED (2026-10-12, #553 COWORK #212): warmFundamentals and
// its FMP quote stage went with the warm-fundamentals cron, and the screener
// rows' only writer was the FMP company-screener read. What remains here is the
// Redis-only reads (the rows age out on their TTLs and every reader already
// treats a miss as "–") and cacheScreenerFundamentals for its last callers.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const FUND_KEY_PREFIX = "msh:pickers:fundamentals:v1:";

// The screener-fundamentals rows were filled from FMP's company-screener read
// (app/api/market's master-list rebuild, and warm-screener-fundamentals until
// its FMP leg was retired on 2026-10-12, #553 COWORK #212).
// SETs per Upstash pipeline. Matches the 500 dynamicUniverseCache already uses
// for the same reason: the command count is unchanged, this only bounds the
// size of one request body.
const SCREENER_WRITE_CHUNK = 500;
const SCREENER_FUND_KEY_PREFIX = "msh:pickers:screener-fundamentals:v1:";
// TTL comfortably spans the master-list rebuild cadence (~daily, gated by
// ensureDailyShuffledMasterList's Eastern-day rollover in app/api/market) so a
// delayed rebuild doesn't empty the cache before the next one lands.
const SCREENER_FUND_TTL_SECONDS = 60 * 60 * 30; // 30h

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

/**
 * Redis-ONLY bulk read of the whole universe's cached fundamentals in a single
 * pipelined round-trip. Never touches FMP -- safe to call on every picker page
 * render. Any symbol without a cached record simply won't be in the returned
 * map (the caller shows "--" for those columns).
 */
export async function readCachedFundamentalsBulk(
  symbols: string[],
  opts: { raw?: boolean } = {}
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

  // THE STORED CAP AND P/E ARE FMP'S ONLY (#553 COWORK #103, #690 Q2). On
  // PRICE_PROVIDER_POOL=tiingo a reader gets SEC x Tiingo for every symbol
  // Tiingo prices, computed here at read time from the pool overlay's Data
  // Cache blobs (tiingoPool.overlaySecTiingoFundamentals) and never written
  // back. `raw` is the stored FMP figure: the sector index's "fmp" basis, which
  // must not mix the two. Loaded on the switch only, as in readPricePoolBulk.
  if (!opts.raw && result.size && priceProviderFor("POOL") === "tiingo") {
    try {
      const { overlaySecTiingoFundamentals } = await import("./tiingoPool");
      return await overlaySecTiingoFundamentals(result, Date.now());
    } catch {
      // fail open -- the stored rows stand
    }
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

