import { Redis } from "@upstash/redis";
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
    ? Redis.fromEnv()
    : null;

const FUND_KEY_PREFIX = "msh:pickers:fundamentals:v1:";
const PROFILE_KEY_PREFIX = "msh:pickers:profile:v1:";
const FUND_TTL_SECONDS = 60 * 60 * 26; // 26h -- comfortably spans a daily warm
const PROFILE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d -- industry/sector are static

// Bounds so a single warm run can never run away with the FMP budget.
const QUOTE_CHUNK_SIZE = 50; // batch-quote symbols per FMP call
const PROFILE_MAX_PER_RUN = 120; // cap fresh profile fetches per run
const FMP_MIN_HEADROOM_CALLS = 60; // leave room for history/earnings warmers

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

// Batch quote -> marketCap + PE for many symbols in one FMP call. Falls back to
// per-symbol stable/quote for a chunk whose batch call fails (so this still
// works on FMP plans without the batch endpoint).
async function fetchQuoteFundamentals(
  symbols: string[],
  apiKey: string
): Promise<Map<string, { marketCap: number | null; peRatio: number | null }>> {
  const out = new Map<string, { marketCap: number | null; peRatio: number | null }>();

  for (const group of chunk(symbols, QUOTE_CHUNK_SIZE)) {
    if (!(await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS))) break;

    let ok = false;
    try {
      await reserveFmpCallSlot();
      const url = `https://financialmodelingprep.com/stable/batch-quote?symbols=${encodeURIComponent(
        group.join(",")
      )}&apikey=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (res.ok) {
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

    if (!ok) {
      // Per-symbol fallback for this chunk.
      for (const sym of group) {
        if (!(await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS))) break;
        try {
          await reserveFmpCallSlot();
          const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
            sym
          )}&apikey=${encodeURIComponent(apiKey)}`;
          const res = await fetch(url, {
            cache: "no-store",
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
    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
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
 *   - market cap + PE via batch quote (daily-fresh)
 *   - industry/sector via profile, only for symbols whose profile isn't
 *     already cached (30-day TTL), capped per run
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

  // 1) market cap + PE for everyone (batched).
  const quoteMap = await fetchQuoteFundamentals(cleanSymbols, apiKey);

  // 2) industry/sector: reuse cached profiles, fetch only the misses (capped).
  const cachedProfiles = await readCachedProfilesBulk(cleanSymbols);
  const profileMisses = cleanSymbols.filter((s) => !cachedProfiles.has(s));
  let profileFetches = 0;
  for (const sym of profileMisses) {
    if (profileFetches >= PROFILE_MAX_PER_RUN) break;
    if (!(await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS))) break;
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

  // 3) write combined records for every symbol we have any data for.
  const now = new Date().toISOString();
  let written = 0;
  const writePipeline = redis.pipeline();
  for (const sym of cleanSymbols) {
    const q = quoteMap.get(sym);
    const p = cachedProfiles.get(sym);
    if (!q && !p) continue;
    const row: FundamentalsRow = {
      symbol: sym,
      marketCap: q?.marketCap ?? p?.marketCap ?? null,
      peRatio: q?.peRatio ?? null,
      industry: p?.industry ?? null,
      sector: p?.sector ?? null,
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
    profileFetches,
    written,
  };
}
