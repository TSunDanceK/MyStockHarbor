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
import { markRefreshed, registerSymbols } from "./stalenessQueue";
import { readEarningsSchedule } from "./earningsSchedule";
import { fmpFetch } from "./fmpUsage";
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
// ─────────────────────────────────────────────────────────────────────────────
// WHICH ENDPOINTS ARE FILING-DRIVEN, IN ONE LIST.
//
// fetchOne made all eight calls for every symbol on a 10-minute clock. Three of
// them answer questions that only change when a company FILES: an income
// statement, a cash-flow statement and a dividend declaration do not move
// between quarters, so re-reading them 144 times a day buys nothing.
//
// THE OTHER FIVE STAY ON THE CLOCK, and that is the part worth being careful
// about. An analyst revision, a rating change or a new price target is exactly
// the kind of event that happens BETWEEN filings -- putting them on an earnings
// trigger would mean not noticing a downgrade until the next quarter, which is
// a worse failure than the cost it saves. stock-price-change is price-derived
// and ratios-ttm carries pbRatio/enterpriseValue, which move with price too.
//
// ONE LIST, NOT A CONDITION REPEATED PER CALL SITE. Each entry names its own
// group, the fetch reads the group off the entry, and the per-symbol call count
// is COUNTED from it rather than stated -- CALLS_PER_SYMBOL used to be a flat 8
// and would have quietly become a lie the moment the split landed.
const ENDPOINT_TRIGGERS = {
  "ratios-ttm": "clock",
  "income-statement": "quarterly",
  "cash-flow-statement": "quarterly",
  dividends: "quarterly",
  "price-target-summary": "clock",
  "grades-consensus": "clock",
  "analyst-estimates": "clock",
  "stock-price-change": "clock",
} as const satisfies Record<string, "clock" | "quarterly">;

const CLOCK_CALLS = Object.values(ENDPOINT_TRIGGERS).filter((t) => t === "clock").length;
const QUARTERLY_CALLS = Object.values(ENDPOINT_TRIGGERS).filter((t) => t === "quarterly").length;

/** What one symbol costs this run. Derived, because it is now conditional. */
function callsForSymbol(includeQuarterly: boolean) {
  return CLOCK_CALLS + (includeQuarterly ? QUARTERLY_CALLS : 0);
}

// THE FLOOR IS NOT OPTIONAL.
//
// Probe Q6 measured the earnings calendar at 1,553 symbols over a ~5-week
// window against a universe heading for 3,000. A symbol the calendar has never
// heard of -- a foreign listing, a fund, a recent IPO, or simply a month whose
// read failed -- would otherwise have its income statement, cash flow and
// dividend data frozen PERMANENTLY, with the job reporting a clean run every
// ten minutes. Absence of a trigger must mean "refresh on the floor", never
// "never refresh".
const QUARTERLY_FLOOR_DAYS = 120;
const QUARTERLY_FLOOR_MS = QUARTERLY_FLOOR_DAYS * 24 * 60 * 60 * 1000;

/**
 * Should this symbol's filing-driven endpoints be re-read?
 *
 * PURE, so the invariant check can RUN it -- "no symbol can be excluded
 * forever" is a claim about behaviour over inputs, and a regex over this file
 * cannot test it.
 *
 * Returns true when the symbol has reported since its last quarterly refresh,
 * when it has never had one, or when the floor has elapsed regardless of what
 * the calendar says.
 */
export function needsQuarterlyRefresh(
  lastQuarterlyIso: string | null | undefined,
  coveredEarningsDate: string | null | undefined,
  lastEarningsIso: string | null | undefined,
  nowMs: number
): boolean {
  const lastQuarterly = lastQuarterlyIso ? Date.parse(lastQuarterlyIso) : NaN;
  // Never refreshed, or an unparseable stamp. Both mean "we hold nothing we can
  // date", which is due.
  if (!Number.isFinite(lastQuarterly)) return true;

  // The floor, on a TIMESTAMP. This is the part that has to be time-based: it
  // is what covers a symbol the calendar has no row for at all, where there is
  // no date to compare.
  if (nowMs - lastQuarterly >= QUARTERLY_FLOOR_MS) return true;

  // The trigger, on the DATE ITSELF rather than on a timestamp comparison.
  //
  // THIS WAS A TIMESTAMP TEST AND IT DROPPED FILINGS. Comparing the report
  // DATE (which parses to midnight UTC) against the last refresh INSTANT means
  // a symbol whose quarterly refresh happened at 06:00 on its own report day
  // has `reported <= lastQuarterly` from then on -- and `last` stays that same
  // date until the following quarter, so the filing is never picked up. The
  // floor would eventually catch it, up to 120 days later, which is precisely
  // the freeze this design exists to avoid.
  //
  // Parsing to end-of-day instead would fix that and then re-fire on every run
  // for the rest of the report day. Recording WHICH earnings date the last
  // quarterly refresh covered fires exactly once per filing, on the day, with
  // no clock arithmetic to get wrong.
  const reported = lastEarningsIso ? lastEarningsIso.slice(0, 10) : null;
  if (reported && reported !== (coveredEarningsDate ?? null)) return true;

  return false;
}
// ─────────────────────────────────────────────────────────────────────────────
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

/**
 * DID ANY ENDPOINT ACTUALLY ANSWER WITH SOMETHING?
 *
 * Counted HERE rather than in each of fetchOne's eight blocks, because this is
 * the one place every endpoint goes through -- eight copies of the same
 * increment is eight chances for the ninth endpoint to be added without one.
 *
 * A response counts when it carries at least one row. Not "the request
 * succeeded": FMP answers a delisted ticker with HTTP 200 and `[]`, so
 * res.ok is true for a symbol that no longer exists.
 */
type FetchTally = { answered: number };

async function fetchJson(url: string, tally?: FetchTally): Promise<unknown> {
  await reserveFmpCallSlot();
  const res = await fmpFetch(url, { next: { revalidate: 300 }, headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (tally && hasRows(json)) tally.answered++;
  return json;
}

function hasRows(json: unknown): boolean {
  if (Array.isArray(json)) return json.length > 0;
  return !!json && typeof json === "object";
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

async function fetchOne(
  symbol: string,
  apiKey: string,
  includeQuarterly: boolean,
  tally: FetchTally
): Promise<Partial<StockData>> {
  const s = encodeURIComponent(symbol);
  const key = encodeURIComponent(apiKey);
  const base = "https://financialmodelingprep.com/stable";
  const out: Partial<StockData> = {};

  // 1) ratios-ttm.
  //
  // FOUR OF THESE EIGHT FIELDS ARE NOW ONLY A FALLBACK. psRatio, pfcfRatio,
  // divYield and payoutRatio are computed at render in PickerResultsGrid from
  // values already stored here (revenue, freeCashFlow, divPerShare, epsTtm)
  // against the pooled price -- the same pattern forwardPe has always used.
  // They are still parsed and stored so a symbol whose numerator has not been
  // warmed yet keeps a value instead of going blank.
  //
  // WHY THE CALL IS STILL MADE. pbRatio and enterpriseValue cannot be derived
  // from anything warmed: book value per share and net debt both come from
  // balance-sheet-statement, which nothing on a cron fetches (only
  // app/stock/[symbol]/earnings/page.tsx, per render, limit=1). Both are
  // RENDERED COLUMNS -- "PB Ratio" and "Ent. Value" in PickerResultsGrid -- so
  // dropping them would remove data a reader can see, which is not a trade
  // worth one endpoint. Adding balance-sheet-statement to the quarterly set is
  // the move that finishes this; until then this call stays for those two.
  //
  // So this change buys FRESHNESS, not calls: it does not reduce the ratios-ttm
  // rotation by one request. The call saving arrives when balance-sheet lands.
  try {
    const row = firstRow(await fetchJson(`${base}/ratios-ttm?symbol=${s}&apikey=${key}`, tally));
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

  // BLOCKS 2-4 ARE THE FILING-DRIVEN SET (see ENDPOINT_TRIGGERS). Skipped
  // entirely unless this symbol has reported since its last quarterly refresh
  // or has hit the floor. Every field they produce is carried forward from the
  // previous row by the caller, so skipping loses nothing.
  if (includeQuarterly) {
  // 2) income-statement (quarter, 4) -> TTM revenue / operating income / net income / EPS
  try {
    const json = await fetchJson(`${base}/income-statement?symbol=${s}&period=quarter&limit=4&apikey=${key}`, tally);
    out.revenue = sumField(json, ["revenue"]);
    out.operatingIncome = sumField(json, ["operatingIncome"]);
    out.netIncome = sumField(json, ["netIncome", "bottomLineNetIncome"]);
    if (out.epsTtm == null) out.epsTtm = sumField(json, ["epsDiluted", "eps"]);
  } catch {
    /* fail open */
  }

  // 3) cash-flow-statement (quarter, 4) -> TTM free cash flow
  try {
    const json = await fetchJson(`${base}/cash-flow-statement?symbol=${s}&period=quarter&limit=4&apikey=${key}`, tally);
    out.freeCashFlow = sumField(json, ["freeCashFlow"]);
  } catch {
    /* fail open */
  }

  // 4) dividends -> payout frequency + YoY growth (latest vs ~1yr-ago payment)
  try {
    const json = await fetchJson(`${base}/dividends?symbol=${s}&limit=8&apikey=${key}`, tally);
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

  }

  // 5) price-target-summary -> avg price target + analyst count
  try {
    const row = firstRow(await fetchJson(`${base}/price-target-summary?symbol=${s}&apikey=${key}`, tally));
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
    const row = firstRow(await fetchJson(`${base}/grades-consensus?symbol=${s}&apikey=${key}`, tally));
    if (row) out.rating = str(row.consensus);
  } catch {
    /* fail open */
  }

  // 7) analyst-estimates -> forward EPS (nearest future fiscal year avg)
  try {
    const json = await fetchJson(`${base}/analyst-estimates?symbol=${s}&period=annual&limit=1&apikey=${key}`, tally);
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
    const row = firstRow(await fetchJson(`${base}/stock-price-change?symbol=${s}&apikey=${key}`, tally));
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

  // ONE READ FOR THE WHOLE SLICE. Cached for a day in its own small key, so
  // this is a single GET rather than several hundred KB of calendar per run.
  // An unreadable index yields an empty map, and every symbol then falls to the
  // floor -- degraded to a 120-day cadence, never to no refresh at all.
  const schedule = await readEarningsSchedule(nowMs);

  let written = 0;
  let quarterlyRefreshes = 0;
  // Symbols where every endpoint attempted came back with nothing. Not proof of
  // a delisting on its own -- one bad FMP minute looks the same -- but a count
  // that stays non-zero across runs is the signal, and it did not exist before.
  let deadSymbols = 0;
  const refreshedSymbols: string[] = [];
  const pipeline = redis.pipeline();
  let queued = 0;

  for (const symbol of slice) {
    // The earnings trigger, per symbol. `schedule` is one cached index for the
    // whole universe (earningsSchedule.ts), so this costs no call and no read.
    const scheduledLast = schedule.get(symbol)?.last ?? null;
    const includeQuarterly = needsQuarterlyRefresh(
      existing.get(symbol)?.quarterlyUpdatedAt,
      existing.get(symbol)?.quarterlyEarningsDate,
      scheduledLast,
      nowMs
    );
    // COUNTED, NOT ASSUMED. A symbol on the clock-only path costs five calls,
    // not eight, and reserving eight for it would idle the run against a
    // budget it is not going to spend.
    if (!(await hasFmpCapacity(callsForSymbol(includeQuarterly), FMP_MIN_HEADROOM_CALLS))) break;
    if (includeQuarterly) quarterlyRefreshes++;
    const tally: FetchTally = { answered: 0 };
    const partial = await fetchOne(symbol, apiKey, includeQuarterly, tally);
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
      // Only advanced when the filing-driven endpoints were actually read.
      // Carrying it forward on a clock-only refresh is what keeps the trigger
      // and the floor both meaningful.
      quarterlyUpdatedAt: includeQuarterly ? nowIso : prev?.quarterlyUpdatedAt,
      // The earnings date this refresh covered. Written together with the
      // stamp above and only when the filing endpoints actually ran, so the
      // two can never disagree about what was picked up.
      quarterlyEarningsDate: includeQuarterly
        ? scheduledLast ?? prev?.quarterlyEarningsDate
        : prev?.quarterlyEarningsDate,
    };
    // A PARTIAL IS LEGITIMATE; NOTHING IS NOT.
    //
    // The row above is written either way -- every field falls back to `prev`,
    // so a symbol that answered on two of five endpoints keeps the other three
    // and is better off written than skipped. What must NOT happen is calling
    // markRefreshed for a symbol where NO endpoint returned a row: that writes
    // `updatedAt: nowIso` over a row of carried-forward nulls and resets the
    // symbol's own staleness, which is the mechanism by which a fully dead
    // universe reports entirely healthy on /cache-health. stalenessQueue.ts's
    // own header names this failure -- "a delisted ticker would show green" --
    // and the guard was never wired into this dataset.
    //
    // THE LINE IS "DID ANY ENDPOINT RETURN A ROW", NOT "DID EVERY FIELD FILL".
    // Plenty of live symbols have no dividends and no analyst coverage, and
    // marking those stale forever would be the same lie pointing the other way.
    // fetchJson counts a response only when it carries at least one row, which
    // is what separates the two: FMP answers a delisted ticker with HTTP 200
    // and `[]`, so res.ok is true for a symbol that no longer exists.
    if (tally.answered > 0) refreshedSymbols.push(symbol);
    else deadSymbols++;
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

  // PER-SYMBOL FRESHNESS, WHERE A HUMAN CAN SEE IT. This job has the longest
  // lap in the system and was the one dataset stalenessQueue did not know
  // about, so "when was AAPL's cash flow last read" had no answer anywhere.
  // registerSymbols is `nx`, so it seeds newcomers at 0 without overwriting a
  // real refresh; markRefreshed names only the symbols this run actually wrote,
  // so the ratio means what /cache-health says it means.
  await registerSymbols("stockData", clean);
  if (refreshedSymbols.length) await markRefreshed("stockData", refreshedSymbols);

  return {
    ok: true,
    universe: clean.length,
    refreshed: written,
    written,
    // How much of this run was filing-driven. Zero across many runs means the
    // trigger has gone inert -- an empty schedule index, or a quarterlyUpdatedAt
    // that never advances -- and every symbol is quietly riding the 120-day
    // floor instead. That is the failure this number exists to make visible.
    quarterlyRefreshes,
    scheduleSize: schedule.size,
    // Written, but NOT marked fresh. `written` counting more than
    // `markedRefreshed` is the difference between "we stored a row" and "the
    // row means anything", and the gap is where dead symbols live.
    noEndpointAnswered: deadSymbols,
    markedRefreshed: refreshedSymbols.length,
  };
}
