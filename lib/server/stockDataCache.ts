import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

// Redis-cached "extended stock data" (valuation / dividends / financials /
// analyst fields) for the screener pages' list-view tabs.
//
// THE WRITER IS RETIRED (2026-10-12, #553 COWORK #212): warmStockData and its
// per-symbol FMP endpoints went with the warm-stock-data cron. What remains is
// the Redis-only bulk read; its rows age out on their TTL, every reader treats
// a miss as "–", and the SEC filings overlay (pickersSecFundamentals) is what
// fills those columns now.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const KEY_PREFIX = "msh:stockdata:v1:";

export type StockData = {
  symbol: string;
  // Valuation (PE comes from the price pool; EV + forward EPS + the ratios here)
  enterpriseValue: number | null;
  forwardEps: number | null; // Forward P/E is computed live as price / forwardEps
  psRatio: number | null;
  pbRatio: number | null;
  pfcfRatio: number | null;
  // Dividends
  divPerShare: number | null;
  divYield: number | null; // percent (e.g. 1.35 = 1.35%)
  payoutRatio: number | null; // percent
  divGrowth: number | null; // percent, YoY
  payoutFreq: string | null;
  // Financials (trailing twelve months)
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  epsTtm: number | null;
  // Analysts
  rating: string | null; // consensus label
  analystCount: number | null;
  priceTarget: number | null;
  // Performance (percent returns; the picker chartPoints only span ~72 bars,
  // so these come from stable/stock-price-change which returns every period).
  perf1w: number | null; // 5D
  perf1m: number | null;
  perf6m: number | null;
  perfYtd: number | null;
  perf1y: number | null;
  updatedAt: string;
  /**
   * When the FILING-DRIVEN endpoints were last read, separate from updatedAt.
   *
   * They have to be separate. updatedAt advances on every clock refresh, so
   * using it as the quarterly stamp would mean the trigger compared the last
   * earnings date against a timestamp that moves every ten minutes -- it would
   * fire exactly once per symbol and then never again, and the floor would
   * never elapse either. Optional because rows written before this field
   * existed do not carry it, and needsQuarterlyRefresh treats absent as due.
   */
  quarterlyUpdatedAt?: string;
  /**
   * The earnings date the last quarterly refresh picked up.
   *
   * The trigger compares this to the calendar's `last` rather than comparing a
   * timestamp to a date -- see the note in needsQuarterlyRefresh for the
   * filings that lost.
   */
  quarterlyEarningsDate?: string | null;
};

function cleanSymbol(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function uniqueClean(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map(cleanSymbol).filter(Boolean)));
}

/**
 * Redis-ONLY bulk read of the whole universe's extended stock data in a single
 * pipelined round-trip. Never touches FMP -- safe on every page render. Any
 * symbol without a cached record simply won't be in the returned map.
 */
export async function readCachedStockDataBulk(
  symbols: string[]
): Promise<Map<string, StockData>> {
  const out = new Map<string, StockData>();
  if (!redis) return out;
  const clean = uniqueClean(symbols);
  if (!clean.length) return out;

  try {
    const keys = clean.map((s) => `${KEY_PREFIX}${s}`);
    const values = await redis.mget<StockData[]>(...keys);
    clean.forEach((symbol, i) => {
      const row = values[i];
      if (row && typeof row === "object" && (row as StockData).symbol) {
        out.set(symbol, row as StockData);
      }
    });
  } catch {
    // fail open -- a read failure just means "no extended data this render"
  }
  return out;
}

