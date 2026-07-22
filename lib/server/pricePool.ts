import { Redis } from "@upstash/redis";
import { hasFmpCapacity, reserveFmpCallSlot } from "./historyCache";

// A single Redis HASH holding a lightweight, ~15-min-fresh quote for every
// symbol the screener can display: price, % change, volume, market cap and PE.
// Using ONE hash (not one key per symbol) keeps Redis command + storage cost
// near zero -- a whole refresh chunk is a single HSET, and a page read is a
// single HMGET for just the symbols it shows. Populated by the warm-price-pool
// cron (app/api/jobs/warm-price-pool); READ-ONLY on page renders so a page load
// never spends an FMP call. Per-symbol freshness is carried in each value's
// `ts`; the whole hash also carries a safety TTL so a stopped cron self-expires.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const PRICE_POOL_KEY = "msh:price-pool:v1";
const PRICE_POOL_HASH_TTL_SECONDS = 2 * 60 * 60; // hash self-expires if the cron stops
const QUOTE_CHUNK_SIZE = 100; // symbols per batch-quote FMP call
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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
    const obj = (await redis.hmget(PRICE_POOL_KEY, ...fields)) as unknown as
      | Record<string, PricePoolRow | null>
      | null;
    if (obj) {
      for (const sym of fields) {
        const row = obj[sym];
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
      }
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
  pe: number | null;
};

function parseQuoteRow(row: Record<string, unknown> | null | undefined): QuoteLite {
  return {
    price: num(row?.price),
    // v3 batch quote uses `changesPercentage`; stable/quote uses `changePercentage`.
    changePct: num(row?.changesPercentage) ?? num(row?.changePercentage),
    volume: num(row?.volume),
    marketCap: num(row?.marketCap),
    pe: num(row?.pe),
  };
}

// Full-quote batch -> price + %change + volume + marketCap + pe for many
// symbols in ONE call. Uses the classic comma-batch (which includes PE, unlike
// the lighter stable batch that dropped it), with a per-symbol stable/quote
// fallback for any chunk whose batch call fails.
async function fetchBatchQuotes(
  symbols: string[],
  apiKey: string
): Promise<Map<string, QuoteLite>> {
  const out = new Map<string, QuoteLite>();

  for (const group of chunk(symbols, QUOTE_CHUNK_SIZE)) {
    if (!(await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS))) break;

    let ok = false;
    try {
      await reserveFmpCallSlot();
      const url = `https://financialmodelingprep.com/api/v3/quote/${group
        .map((s) => encodeURIComponent(s))
        .join(",")}?apikey=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (Array.isArray(json) && json.length) {
          for (const row of json) {
            const sym = cleanSymbol(String((row as { symbol?: unknown })?.symbol ?? ""));
            if (sym) out.set(sym, parseQuoteRow(row));
          }
          ok = true;
        }
      }
    } catch {
      ok = false;
    }

    if (!ok) {
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
          if (row) out.set(sym, parseQuoteRow(row));
        } catch {
          // skip this symbol
        }
      }
    }
  }

  return out;
}

/**
 * Cron worker: refresh the whole pool for the given symbols. Fetches the full
 * quote in ~100-symbol batches and writes the result as a single HSET (+ a
 * safety expiry on the hash). Budget-guarded and fail-open.
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

  const quotes = await fetchBatchQuotes(clean, apiKey);
  if (!quotes.size) return { ok: true, requested: clean.length, quotesFetched: 0, written: 0 };

  const payload: Record<string, PricePoolRow> = {};
  for (const [sym, q] of quotes) {
    payload[sym] = {
      price: q.price,
      changePct: q.changePct,
      volume: q.volume,
      marketCap: q.marketCap,
      pe: q.pe,
      ts: nowMs,
    };
  }

  let written = 0;
  try {
    await redis.hset(PRICE_POOL_KEY, payload);
    await redis.expire(PRICE_POOL_KEY, PRICE_POOL_HASH_TTL_SECONDS);
    written = Object.keys(payload).length;
  } catch {
    // fail open -- a failed warm just means the pool keeps its prior values.
  }

  return { ok: true, requested: clean.length, quotesFetched: quotes.size, written };
}
