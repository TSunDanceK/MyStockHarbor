import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { hasFmpCapacity, reserveFmpCallSlot } from "./historyCache";

// Cron-warmed, Redis-cached "extended stock data" for the site-wide rolling
// universe: the valuation / dividends / financials / analyst fields that power
// the extra list-view tabs (Valuation, Dividends, Financials, Analysts) on the
// screener pages. Same contract as fundamentalsCache / pricePool: a background
// job fetches from FMP and writes Redis; every page render only ever READS from
// Redis, so the new tabs cost zero FMP calls per request.
//
// FMP Starter plan reality (all confirmed 200 via app/api/debug probes,
// 2026-07-23): no multi-symbol endpoint works, so every field is per-symbol.
// The endpoints used, and what each yields:
//   * stable/ratios-ttm         -> PS, PB, P/FCF, EV, div yield/payout/per-share,
//                                  TTM EPS (netIncomePerShareTTM)   [Valuation + Dividends]
//   * stable/income-statement   -> revenue / operating income / net income / EPS (TTM = sum of 4 quarters)  [Financials]
//   * stable/cash-flow-statement-> free cash flow (TTM = sum of 4 quarters)         [Financials]
//   * stable/dividends          -> payout frequency + YoY dividend growth           [Dividends]
//   * stable/price-target-summary -> avg price target + analyst count               [Analysts]
//   * stable/grades-consensus   -> consensus rating (Buy/Hold/Sell/...)             [Analysts]
//   * stable/analyst-estimates  -> forward EPS (for Forward P/E = price / fwdEps)   [Valuation/Analysts]
// PE itself comes from the price pool (pricePool.ts), not here.
//
// All of this is slow-moving (daily or slower), so we DON'T refresh the whole
// universe every run: each run refreshes the STALEST slice (oldest updatedAt),
// budget-guarded via reserveFmpCallSlot()/hasFmpCapacity(), so coverage builds
// up over a few hours and then just rolls. Fail-open throughout.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const KEY_PREFIX = "msh:stockdata:v1:";
const TTL_SECONDS = 60 * 60 * 26; // 26h -- comfortably spans a daily-ish warm
const REFRESH_SLICE_SIZE = 25; // symbols refreshed per run (~8 FMP calls each)
const CALLS_PER_SYMBOL = 8;
const FMP_MIN_HEADROOM_CALLS = 90; // leave room for price/history/earnings warmers

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
};

function cleanSymbol(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const p = Number(v.replace(/,/g, ""));
    if (Number.isFinite(p)) return p;
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
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

async function fetchJson(url: string): Promise<unknown> {
  await reserveFmpCallSlot();
  const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function firstRow(json: unknown): Record<string, unknown> | null {
  const rows = Array.isArray(json) ? json : json ? [json] : [];
  const r = rows[0];
  return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
}

function sumField(json: unknown, keys: string[], limit = 4): number | null {
  const rows = Array.isArray(json) ? json.slice(0, limit) : [];
  if (!rows.length) return null;
  let total = 0;
  let any = false;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    let v: number | null = null;
    for (const k of keys) {
      v = num(rec[k]);
      if (v != null) break;
    }
    if (v != null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

async function fetchOne(symbol: string, apiKey: string): Promise<Partial<StockData>> {
  const s = encodeURIComponent(symbol);
  const key = encodeURIComponent(apiKey);
  const base = "https://financialmodelingprep.com/stable";
  const out: Partial<StockData> = {};

  // 1) ratios-ttm -> valuation ratios + dividend yield/payout/per-share + TTM EPS
  try {
    const row = firstRow(await fetchJson(`${base}/ratios-ttm?symbol=${s}&apikey=${key}`));
    if (row) {
      out.psRatio = num(row.priceToSalesRatioTTM);
      out.pbRatio = num(row.priceToBookRatioTTM);
      out.pfcfRatio = num(row.priceToFreeCashFlowRatioTTM);
      out.enterpriseValue = num(row.enterpriseValueTTM);
      out.epsTtm = num(row.netIncomePerShareTTM);
      out.divPerShare = num(row.dividendPerShareTTM);
      // FMP yields/payout are fractions (0.0135) -> percent for display.
      const dy = num(row.dividendYieldTTM);
      out.divYield = dy != null ? dy * 100 : null;
      const pr = num(row.dividendPayoutRatioTTM);
      out.payoutRatio = pr != null ? pr * 100 : null;
    }
  } catch {
    /* fail open */
  }

  // 2) income-statement (quarter, 4) -> TTM revenue / operating income / net income / EPS
  try {
    const json = await fetchJson(`${base}/income-statement?symbol=${s}&period=quarter&limit=4&apikey=${key}`);
    out.revenue = sumField(json, ["revenue"]);
    out.operatingIncome = sumField(json, ["operatingIncome"]);
    out.netIncome = sumField(json, ["netIncome", "bottomLineNetIncome"]);
    if (out.epsTtm == null) out.epsTtm = sumField(json, ["epsDiluted", "eps"]);
  } catch {
    /* fail open */
  }

  // 3) cash-flow-statement (quarter, 4) -> TTM free cash flow
  try {
    const json = await fetchJson(`${base}/cash-flow-statement?symbol=${s}&period=quarter&limit=4&apikey=${key}`);
    out.freeCashFlow = sumField(json, ["freeCashFlow"]);
  } catch {
    /* fail open */
  }

  // 4) dividends -> payout frequency + YoY growth (latest vs ~1yr-ago payment)
  try {
    const json = await fetchJson(`${base}/dividends?symbol=${s}&limit=8&apikey=${key}`);
    const rows = Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
    if (rows.length) {
      out.payoutFreq = str(rows[0]?.frequency);
      const latest = num(rows[0]?.adjDividend) ?? num(rows[0]?.dividend);
      // find a payment roughly a year before the latest to gauge growth
      const freq = (out.payoutFreq ?? "").toLowerCase();
      const perYear = freq.includes("quarter") ? 4 : freq.includes("month") ? 12 : freq.includes("semi") ? 2 : 1;
      const prior = rows[perYear];
      const priorDiv = prior ? num(prior.adjDividend) ?? num(prior.dividend) : null;
      if (latest != null && priorDiv != null && priorDiv > 0) {
        out.divGrowth = ((latest - priorDiv) / priorDiv) * 100;
      }
    }
  } catch {
    /* fail open */
  }

  // 5) price-target-summary -> avg price target + analyst count
  try {
    const row = firstRow(await fetchJson(`${base}/price-target-summary?symbol=${s}&apikey=${key}`));
    if (row) {
      out.priceTarget =
        num(row.lastQuarterAvgPriceTarget) ??
        num(row.lastYearAvgPriceTarget) ??
        num(row.allTimeAvgPriceTarget);
      out.analystCount = num(row.lastQuarterCount) ?? num(row.lastYearCount) ?? num(row.allTimeCount);
    }
  } catch {
    /* fail open */
  }

  // 6) grades-consensus -> consensus rating label
  try {
    const row = firstRow(await fetchJson(`${base}/grades-consensus?symbol=${s}&apikey=${key}`));
    if (row) out.rating = str(row.consensus);
  } catch {
    /* fail open */
  }

  // 7) analyst-estimates -> forward EPS (nearest future fiscal year avg)
  try {
    const json = await fetchJson(`${base}/analyst-estimates?symbol=${s}&period=annual&limit=1&apikey=${key}`);
    const row = firstRow(json);
    if (row) {
      out.forwardEps = num(row.epsAvg);
      if (out.analystCount == null) out.analystCount = num(row.numAnalystsEps);
    }
  } catch {
    /* fail open */
  }

  // 8) stock-price-change -> performance returns for every period in one call
  //    (fields are already percentages: "5D","1M","6M","ytd","1Y", ...).
  try {
    const row = firstRow(await fetchJson(`${base}/stock-price-change?symbol=${s}&apikey=${key}`));
    if (row) {
      out.perf1w = num(row["5D"]);
      out.perf1m = num(row["1M"]);
      out.perf6m = num(row["6M"]);
      out.perfYtd = num(row["ytd"]);
      out.perf1y = num(row["1Y"]);
    }
  } catch {
    /* fail open */
  }

  return out;
}

/**
 * Cron worker: refresh the stalest slice of the universe's extended stock data.
 * Reads each symbol's cached updatedAt, refreshes the oldest REFRESH_SLICE_SIZE
 * (each ~CALLS_PER_SYMBOL FMP calls), writes one combined StockData row per
 * symbol (26h TTL). Budget-guarded and fail-open throughout.
 */
export async function warmStockData(symbols: string[], nowMs: number) {
  const apiKey = process.env.FMP_API_KEY;
  const clean = uniqueClean(symbols);
  if (!redis || !apiKey || !clean.length) {
    return { ok: false, reason: !redis ? "no-redis" : !apiKey ? "no-fmp-key" : "no-symbols", written: 0 };
  }

  // Determine staleness: read existing updatedAt for all, pick oldest first.
  const existing = await readCachedStockDataBulk(clean);
  const ageOf = (sym: string) => {
    const u = existing.get(sym)?.updatedAt;
    const t = u ? Date.parse(u) : 0;
    return Number.isFinite(t) ? t : 0;
  };
  const slice = [...clean].sort((a, b) => ageOf(a) - ageOf(b)).slice(0, REFRESH_SLICE_SIZE);

  const nowIso = new Date(nowMs).toISOString();
  let written = 0;
  const pipeline = redis.pipeline();
  let queued = 0;

  for (const symbol of slice) {
    if (!(await hasFmpCapacity(CALLS_PER_SYMBOL, FMP_MIN_HEADROOM_CALLS))) break;
    const partial = await fetchOne(symbol, apiKey);
    const prev = existing.get(symbol);
    const row: StockData = {
      symbol,
      enterpriseValue: partial.enterpriseValue ?? prev?.enterpriseValue ?? null,
      forwardEps: partial.forwardEps ?? prev?.forwardEps ?? null,
      psRatio: partial.psRatio ?? prev?.psRatio ?? null,
      pbRatio: partial.pbRatio ?? prev?.pbRatio ?? null,
      pfcfRatio: partial.pfcfRatio ?? prev?.pfcfRatio ?? null,
      divPerShare: partial.divPerShare ?? prev?.divPerShare ?? null,
      divYield: partial.divYield ?? prev?.divYield ?? null,
      payoutRatio: partial.payoutRatio ?? prev?.payoutRatio ?? null,
      divGrowth: partial.divGrowth ?? prev?.divGrowth ?? null,
      payoutFreq: partial.payoutFreq ?? prev?.payoutFreq ?? null,
      revenue: partial.revenue ?? prev?.revenue ?? null,
      operatingIncome: partial.operatingIncome ?? prev?.operatingIncome ?? null,
      netIncome: partial.netIncome ?? prev?.netIncome ?? null,
      freeCashFlow: partial.freeCashFlow ?? prev?.freeCashFlow ?? null,
      epsTtm: partial.epsTtm ?? prev?.epsTtm ?? null,
      rating: partial.rating ?? prev?.rating ?? null,
      analystCount: partial.analystCount ?? prev?.analystCount ?? null,
      priceTarget: partial.priceTarget ?? prev?.priceTarget ?? null,
      perf1w: partial.perf1w ?? prev?.perf1w ?? null,
      perf1m: partial.perf1m ?? prev?.perf1m ?? null,
      perf6m: partial.perf6m ?? prev?.perf6m ?? null,
      perfYtd: partial.perfYtd ?? prev?.perfYtd ?? null,
      perf1y: partial.perf1y ?? prev?.perf1y ?? null,
      updatedAt: nowIso,
    };
    pipeline.set(`${KEY_PREFIX}${symbol}`, row, { ex: TTL_SECONDS });
    queued++;
    written++;
  }

  if (queued > 0) {
    try {
      await pipeline.exec();
    } catch {
      // fail open -- a failed write just means "--" columns until next run
    }
  }

  return { ok: true, universe: clean.length, refreshed: written, written };
}
