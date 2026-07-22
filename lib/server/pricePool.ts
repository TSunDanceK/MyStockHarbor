import { Redis } from "@upstash/redis";
import { hasFmpCapacity, reserveFmpCallSlot } from "./historyCache";

// A single Redis HASH holding a lightweight, rolling-fresh quote for every
// symbol the screener can display: price, % change, volume, market cap and PE.
// Using ONE hash (not one key per symbol) keeps Redis command + storage cost
// near zero -- a refresh is a single HSET of just the slice we touched, and a
// page read is a single HMGET for just the symbols it shows. Populated by the
// warm-price-pool cron (app/api/jobs/warm-price-pool); READ-ONLY on page
// renders so a page load never spends an FMP call.
//
// IMPORTANT (FMP Starter plan reality, confirmed live 2026-07-22 via
// app/api/debug/quote-shape):
//   * stable/batch-quote           -> 402 Restricted (not on this plan)
//   * api/v3/quote (comma batch)   -> 403 (legacy, blocked)
//   * stable/quote (per symbol)    -> 200, but has NO `pe` field
//   * stable/ratios-ttm (per sym)  -> 200, has priceToEarningsRatioTTM  <-- PE
// So there is no working multi-symbol quote endpoint and no quote endpoint
// carries PE at all. Everything must go per-symbol: stable/quote for the live
// price/%chg/volume/marketCap, and stable/ratios-ttm for the (slow-moving) PE.
// To stay well under the shared 300/min FMP budget we DON'T refresh the whole
// universe every run; each run refreshes only the STALEST slice (oldest `ts`
// first) and the hash persists everything else -- so coverage builds up over a
// few runs and then just keeps rolling. Per-symbol freshness is carried in each
// value's `ts`; the whole hash also carries a safety TTL (reset every run) so a
// stopped cron self-expires.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const PRICE_POOL_KEY = "msh:price-pool:v1";
const PRICE_POOL_HASH_TTL_SECONDS = 12 * 60 * 60; // reset each run; long enough to bridge slow rotation
// Symbols refreshed per run. Each costs 2 FMP calls (quote + ratios-ttm), so
// this defaults to ~80 calls/run. With the cron every 15 min a ~400-symbol
// signal set fully cycles in ~2.5h and then stays fresh. Bump for fresher
// prices at the cost of more FMP calls; the budget guard caps it regardless.
const REFRESH_SLICE_SIZE = 40;
const FMP_MIN_HEADROOM_CALLS = 60; // leave room for history/earnings warmers

export type PricePoolRow = {
  price: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  pe: number | null;
  ts: number; // ms epoch this quote was fetched
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

function uniqueClean(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map(cleanSymbol).filter(Boolean)));
}

/**
 * Redis-ONLY bulk read of the pooled quotes for the symbols a page shows, in a
 * single HMGET. Never touches FMP. Any symbol not in the pool is simply absent
 * from the returned map (caller falls back to the EOD close from chartPoints).
 */
export async function readPricePoolBulk(
  symbols: string[]
): Promise<Map<string, PricePoolRow>> {
  const out = new Map<string, PricePoolRow>();
  if (!redis) return out;

  const fields = uniqueClean(symbols);
  if (!fields.length) return out;

  try {
    // Upstash's hmget returns an object keyed by field name; some versions
    // return an array aligned to the requested fields. Handle both so the read
    // never silently returns nothing.
    const raw = (await redis.hmget(PRICE_POOL_KEY, ...fields)) as unknown;
    const asArray = Array.isArray(raw) ? (raw as (PricePoolRow | null)[]) : null;
    const asObj =
      !asArray && raw && typeof raw === "object"
        ? (raw as Record<string, PricePoolRow | null>)
        : null;
    if (asArray || asObj) {
      fields.forEach((sym, i) => {
        const row = asArray ? asArray[i] : asObj ? asObj[sym] : null;
        if (row && typeof row === "object" && typeof row.ts === "number") {
          out.set(sym, {
            price: num(row.price),
            changePct: num(row.changePct),
            volume: num(row.volume),
            marketCap: num(row.marketCap),
            pe: num(row.pe),
            ts: row.ts,
          });
        }
      });
    }
  } catch {
    // fail open -- a read failure just means "no pooled quotes this render".
  }

  return out;
}

type QuoteLite = {
  price: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
};

// Per-symbol live quote (price/%chg/volume/marketCap). stable/quote is the only
// working intraday quote endpoint on this plan; it returns `changePercentage`
// (no trailing "s") and has no PE field.
async function fetchStableQuote(sym: string, apiKey: string): Promise<QuoteLite | null> {
  try {
    await reserveFmpCallSlot();
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
      sym
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const row = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      price: num(row.price),
      changePct: num(row.changePercentage) ?? num(row.changesPercentage),
      volume: num(row.volume),
      marketCap: num(row.marketCap),
    };
  } catch {
    return null;
  }
}

// Per-symbol trailing-twelve-month P/E from stable/ratios-ttm. This is the only
// endpoint on this plan that carries PE. Field is priceToEarningsRatioTTM (with
// legacy-name fallbacks). PE is slow-moving so refreshing it on the same rolling
// slice as price is plenty fresh.
async function fetchPeTtm(sym: string, apiKey: string): Promise<number | null> {
  try {
    await reserveFmpCallSlot();
    const url = `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(
      sym
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const row = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
    if (!row) return null;
    const pe =
      num(row.priceToEarningsRatioTTM) ??
      num(row.priceEarningsRatioTTM) ??
      num(row.peRatioTTM) ??
      num(row.peRatio);
    // Guard against absurd/negative PE noise so the column stays meaningful.
    if (pe == null || pe <= 0 || pe > 100000) return null;
    return pe;
  } catch {
    return null;
  }
}

/**
 * Cron worker: refresh the STALEST slice of the pool. Reads each symbol's last
 * `ts` from the hash, refreshes the oldest REFRESH_SLICE_SIZE symbols
 * (stable/quote + stable/ratios-ttm each), and writes just that slice back via
 * a single HSET (+ resets the hash's safety expiry). Everything not in the
 * slice keeps its prior pooled value. Budget-guarded and fail-open throughout.
 */
export async function warmPricePool(symbols: string[], nowMs: number) {
  const apiKey = process.env.FMP_API_KEY;
  const clean = uniqueClean(symbols);

  if (!redis || !apiKey || !clean.length) {
    return {
      ok: false,
      reason: !redis ? "no-redis" : !apiKey ? "no-fmp-key" : "no-symbols",
      written: 0,
    };
  }

  // Pick the stalest slice: symbols with no pooled value (ts absent -> 0) go
  // first, then oldest ts first. This fills a cold pool and then rotates.
  const existing = await readPricePoolBulk(clean);
  const sorted = [...clean].sort(
    (a, b) => (existing.get(a)?.ts ?? 0) - (existing.get(b)?.ts ?? 0)
  );
  const slice = sorted.slice(0, REFRESH_SLICE_SIZE);

  const payload: Record<string, PricePoolRow> = {};
  let refreshed = 0;
  for (const sym of slice) {
    // Each symbol needs 2 calls (quote + ratios); stop if we're near the floor.
    if (!(await hasFmpCapacity(2, FMP_MIN_HEADROOM_CALLS))) break;
    const q = await fetchStableQuote(sym, apiKey);
    if (!q) continue;
    const pe = await fetchPeTtm(sym, apiKey);
    payload[sym] = {
      price: q.price,
      changePct: q.changePct,
      volume: q.volume,
      marketCap: q.marketCap,
      // Carry forward the last-known PE if the ratios call failed this run.
      pe: pe ?? existing.get(sym)?.pe ?? null,
      ts: nowMs,
    };
    refreshed++;
  }

  let written = 0;
  try {
    if (Object.keys(payload).length) {
      await redis.hset(PRICE_POOL_KEY, payload);
      written = Object.keys(payload).length;
    }
    // Always reset the safety TTL so an all-skipped run can't let the hash lapse.
    await redis.expire(PRICE_POOL_KEY, PRICE_POOL_HASH_TTL_SECONDS);
  } catch {
    // fail open -- a failed warm just means the pool keeps its prior values.
  }

  return { ok: true, universe: clean.length, sliceSize: slice.length, refreshed, written };
}
