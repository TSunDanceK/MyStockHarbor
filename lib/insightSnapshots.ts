import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "@/lib/server/redisCacheMode";
import type { InsightSnapshot, InsightSnapshotPoint } from "@/lib/blog";
import { getDailyHistory } from "@/lib/server/historyCache";
import { fetchQuoteSnapshotForRender, type Quote } from "@/lib/server/quoteData";
import { searchSymbols, type SymbolRow } from "@/lib/server/symbolSearch";
import { priceProviderFor } from "@/lib/server/marketData/provider";
import { readTiingoHistory } from "@/lib/server/marketData/read";
import type { EodBar } from "@/lib/server/marketData/types";
import { pickSurfacePrice } from "@/lib/server/tiingoSurfacePrice";

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  // PAGE_READ_CACHE, not a bare client. @upstash/redis defaults every REST call
  // to cache: "no-store", and on a prerendered route that throws
  // DYNAMIC_SERVER_USAGE at request time -- a 500, not a fallback. This client
  // is read by /insights/[slug], which #310 made static and which 500'd in
  // production for ~3.5 hours until #323 reverted it.
  return Redis.fromEnv(PAGE_READ_CACHE);
}

function movingAverage(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }

  return out;
}

function buildWeeklyCloses(points: Point[]): number[] {
  if (!points.length) return [];

  const weekly: number[] = [];
  let currentWeekKey = "";
  let lastCloseForWeek: number | null = null;

  for (const point of points) {
    const d = new Date(point.date);
    if (Number.isNaN(d.getTime())) continue;

    const utcDay = d.getUTCDay();
    const diffToMonday = utcDay === 0 ? -6 : 1 - utcDay;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + diffToMonday);

    const weekKey = `${monday.getUTCFullYear()}-${String(
      monday.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;

    if (weekKey !== currentWeekKey) {
      if (lastCloseForWeek !== null) weekly.push(lastCloseForWeek);
      currentWeekKey = weekKey;
    }

    lastCloseForWeek = point.close;
  }

  if (lastCloseForWeek !== null) weekly.push(lastCloseForWeek);

  return weekly;
}

function lastNum(arr: (number | null)[]) {
  return arr.length ? arr[arr.length - 1] : null;
}

function pctFromBase(last: number | null, base: number | null) {
  if (
    typeof last !== "number" ||
    typeof base !== "number" ||
    !Number.isFinite(last) ||
    !Number.isFinite(base) ||
    base === 0
  ) {
    return null;
  }

  return ((last - base) / base) * 100;
}

function trendLabel(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
}) {
  const { lastClose, ma50, ma200 } = args;

  if (
    typeof lastClose === "number" &&
    typeof ma50 === "number" &&
    typeof ma200 === "number"
  ) {
    if (lastClose > ma50 && ma50 > ma200) return "Uptrend";
    if (lastClose < ma50 && ma50 < ma200) return "Downtrend";
  }

  return "Range / Mixed";
}

function normalizeSnapshot(input: unknown): InsightSnapshot | null {
  if (!input || typeof input !== "object") return null;

  const data = input as Record<string, unknown>;
  const rawChartPoints = Array.isArray(data.chartPoints) ? data.chartPoints : [];

  const chartPoints: InsightSnapshotPoint[] = rawChartPoints
    .map((point) => {
      const p = point as Record<string, unknown>;
      const close = Number(p.close);

      return {
        date: String(p.date ?? ""),
        close,
        high:
          p.high === undefined || p.high === null ? undefined : Number(p.high),
        low:
          p.low === undefined || p.low === null ? undefined : Number(p.low),
        volume:
          p.volume === undefined || p.volume === null
            ? undefined
            : Number(p.volume),
      };
    })
    .filter(
      (point) =>
        point.date &&
        typeof point.close === "number" &&
        Number.isFinite(point.close)
    );

  return {
    symbol: String(data.symbol ?? ""),
    companyName:
      typeof data.companyName === "string" ? data.companyName : undefined,
    snapshotDate:
      typeof data.snapshotDate === "string" ? data.snapshotDate : undefined,
    snapshotTime:
      typeof data.snapshotTime === "string" ? data.snapshotTime : undefined,
    price:
      typeof data.price === "number" && Number.isFinite(data.price)
        ? data.price
        : data.price === null
        ? null
        : undefined,
    trend: typeof data.trend === "string" ? data.trend : undefined,
    lastMA50:
      typeof data.lastMA50 === "number" && Number.isFinite(data.lastMA50)
        ? data.lastMA50
        : data.lastMA50 === null
        ? null
        : undefined,
    lastMA200:
      typeof data.lastMA200 === "number" && Number.isFinite(data.lastMA200)
        ? data.lastMA200
        : data.lastMA200 === null
        ? null
        : undefined,
    lastWeeklyMA200:
      typeof data.lastWeeklyMA200 === "number" &&
      Number.isFinite(data.lastWeeklyMA200)
        ? data.lastWeeklyMA200
        : data.lastWeeklyMA200 === null
        ? null
        : undefined,
    ma50Pct:
      typeof data.ma50Pct === "number" && Number.isFinite(data.ma50Pct)
        ? data.ma50Pct
        : data.ma50Pct === null
        ? null
        : undefined,
    ma200Pct:
      typeof data.ma200Pct === "number" && Number.isFinite(data.ma200Pct)
        ? data.ma200Pct
        : data.ma200Pct === null
        ? null
        : undefined,
    weeklyMA200Pct:
      typeof data.weeklyMA200Pct === "number" &&
      Number.isFinite(data.weeklyMA200Pct)
        ? data.weeklyMA200Pct
        : data.weeklyMA200Pct === null
        ? null
        : undefined,
    chartPoints,
  };
}

/** The derived (owned) figures, from one daily series. Shared by both paths. */
function deriveFromPoints(points: Point[]) {
  const closes = points.map((p) => p.close);
  const weeklyCloses = buildWeeklyCloses(points);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const weeklyMA200 = movingAverage(weeklyCloses, 200);

  const lastClose = points.length ? points[points.length - 1].close : null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);
  const lastWeeklyMA200 = lastNum(weeklyMA200);

  const trend = trendLabel({
    lastClose,
    ma50: typeof lastMA50 === "number" ? lastMA50 : null,
    ma200: typeof lastMA200 === "number" ? lastMA200 : null,
  });

  const ma50Pct = pctFromBase(
    lastClose,
    typeof lastMA50 === "number" ? lastMA50 : null
  );
  const ma200Pct = pctFromBase(
    lastClose,
    typeof lastMA200 === "number" ? lastMA200 : null
  );
  const weeklyMA200Pct = pctFromBase(
    lastClose,
    typeof lastWeeklyMA200 === "number" ? lastWeeklyMA200 : null
  );

  const round4 = (n: number | null) =>
    typeof n === "number" ? Number(n.toFixed(4)) : null;

  return {
    trend,
    lastMA50: round4(lastMA50),
    lastMA200: round4(lastMA200),
    lastWeeklyMA200: round4(lastWeeklyMA200),
    ma50Pct: round4(ma50Pct),
    ma200Pct: round4(ma200Pct),
    weeklyMA200Pct: round4(weeklyMA200Pct),
  };
}

// Builds a new Insight post's SEO snapshot (price, trend, MA levels, chart
// points) once, then caches it in Redis forever (see
// getOrCreateInsightSnapshot below) so the post's initial HTML always has
// real data embedded for crawlers, per the rendering policy (claude/RENDERING_POLICY.md).
//
// THE FMP PATH. Used when PRICE_PROVIDER_CHARTS is not "tiingo", and as the
// fallback while FMP_API_KEY is still set (see resolveInsightSnapshot).
//
// This used to self-fetch the public /api/quote, /api/history and
// /api/symbols routes over HTTP (`fetch(`${baseUrl}/api/...`)`). Once those
// three routes were BotID-guarded (2026-07-20 "Expand BotID Basic coverage
// site-wide"), that self-fetch carried no browser BotID header, so every one
// of those requests was misclassified as bot traffic and returned a hard 403
// -- which this function's fetchJson() turned into a thrown error, which
// propagated all the way up through getOrCreateInsightSnapshot into
// app/insights/[slug]/page.tsx uncaught, producing a 500 for every brand-new
// Insight post (any post whose snapshot wasn't already cached in Redis from
// before the BotID rollout). This is the exact same self-fetch-gets-blocked
// failure mode already documented for /api/pickers, /api/plays,
// /api/bull-flags, /api/descending-triangles and /api/benchmarks in
// claude/pickers-firewall-selfblock-2026-07-17.md -- the fix is the same one
// used there: call the underlying data functions in-process instead of
// fetching this deployment's own public URL. fetchQuoteSnapshot,
// getDailyHistory and searchSymbols are the same functions app/api/quote,
// app/api/history and app/api/symbols call themselves, so behaviour/output
// is identical to before; only the BotID-vulnerable HTTP hop is removed.
async function buildSnapshot(symbol: string): Promise<InsightSnapshot> {
  const [quoteData, dailyHistory, symbolResults] = await Promise.all([
    fetchQuoteSnapshotForRender(symbol) as Promise<Quote>,
    getDailyHistory(symbol, { caller: "insight-snapshot" }),
    searchSymbols(symbol, "") as Promise<SymbolRow[]>,
  ]);

  const points: Point[] = dailyHistory
    .map((p) => ({
      date: String(p?.date ?? ""),
      close: Number(p?.close),
      high: p?.high == null ? undefined : Number(p.high),
      low: p?.low == null ? undefined : Number(p.low),
      volume: p?.volume == null ? undefined : Number(p.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close));

  const exact = symbolResults.find(
    (r) => (r.symbol ?? "").toUpperCase() === symbol
  );

  return {
    symbol,
    companyName: exact?.name ?? "",
    snapshotDate: quoteData?.date ?? undefined,
    snapshotTime: quoteData?.time ?? undefined,
    price:
      typeof quoteData?.price === "number" && Number.isFinite(quoteData.price)
        ? quoteData.price
        : null,
    ...deriveFromPoints(points),
    chartPoints: points.slice(-2000),
  };
}

// ---------------------------------------------------------------------------
// THE TIINGO PATH (#553 CODE-B #94 B2), behind PRICE_PROVIDER_CHARTS.
//
// WHY CHARTS. The snapshot is a frozen daily chart plus the levels read off
// it, built from one symbol's stored daily history -- the same input, and the
// same switch, as the stock page's chart (step 3). No new surface.
//
// THE CONTRACT (Tiingo licence §7). Raw Tiingo values -- prices, OHLC bars,
// volumes -- may only be stored under msh:tiingo:, because that prefix is all
// scripts/tiingo-purge.mjs deletes on termination. The snapshot key
// (insight-snapshot:<slug>) has NO TTL and is OUTSIDE that prefix, so on this
// path it holds ONLY derived ("owned") figures: the trend label and the three
// MA distances in %, plus the post's symbol, company name and the as-of date
// of the bar they were computed on (TIINGO_RECORD_FIELDS, exhaustively).
//
// EVERYTHING PRICED IS READ AT RENDER, from the stored bars through the Data
// Cache (readTiingoHistory): the chart points (bars up to the as-of date, so
// the chart stays the frozen setup the article describes), the "last price"
// (pickSurfacePrice over those bars: "close, 29 Sep 2026"), and the MA levels
// (that close and the owned % distance: level = close / (1 + pct/100), exact,
// and still exact after a split since both sides are split-adjusted). If the
// bars are gone (purged, or the symbol left the universe) the page renders
// without the snapshot block.
//
// NEVER A NULL-PRICE RECORD. No usable bars -> nothing is written, so a later
// render retries once the nightly job has the symbol.
//
// FMP-ERA SNAPSHOTS stay as they are: they are FMP data, not Tiingo's, so no
// contract term reaches them, and their frozen values are what the articles
// were written against.
// ---------------------------------------------------------------------------

/** Every key a persisted Tiingo-path record may hold. Nothing priced. */
export const TIINGO_RECORD_FIELDS = [
  "source",
  "symbol",
  "companyName",
  "snapshotDate",
  "trend",
  "ma50Pct",
  "ma200Pct",
  "weeklyMA200Pct",
] as const;

export type TiingoSnapshotRecord = {
  source: "tiingo";
  symbol: string;
  companyName: string;
  /** YYYY-MM-DD of the stored bar the derived fields were computed on. */
  snapshotDate: string;
  trend: string;
  ma50Pct: number | null;
  ma200Pct: number | null;
  weeklyMA200Pct: number | null;
};

function isTiingoRecord(raw: unknown): raw is TiingoSnapshotRecord {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    r.source === "tiingo" &&
    typeof r.snapshotDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.snapshotDate)
  );
}

function barsToPoints(bars: readonly EodBar[]): Point[] {
  return bars
    .map(([date, , high, low, close, volume]) => ({
      date: String(date ?? ""),
      close: Number(close),
      high: Number.isFinite(high) ? Number(high) : undefined,
      low: Number.isFinite(low) ? Number(low) : undefined,
      volume: Number.isFinite(volume) ? Number(volume) : undefined,
    }))
    .filter((p) => p.date && Number.isFinite(p.close) && p.close > 0);
}

const pctOrNull = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

/**
 * Pure: the record to persist for a new post, or null when the bars give no
 * usable close (then nothing is written). Built field by field from
 * TIINGO_RECORD_FIELDS' list, never by spreading a priced object.
 */
export function buildTiingoRecord(
  symbol: string,
  bars: readonly EodBar[] | null | undefined,
  companyName: string
): TiingoSnapshotRecord | null {
  const points = barsToPoints(bars ?? []);
  if (points.length < 2) return null;
  const d = deriveFromPoints(points);
  return {
    source: "tiingo",
    symbol,
    companyName,
    snapshotDate: points[points.length - 1].date,
    trend: d.trend,
    ma50Pct: d.ma50Pct,
    ma200Pct: d.ma200Pct,
    weeklyMA200Pct: d.weeklyMA200Pct,
  };
}

function levelFromPct(price: number, pct: number | null): number | null {
  if (pct === null || pct <= -100) return null;
  const level = price / (1 + pct / 100);
  return Number.isFinite(level) ? Number(level.toFixed(4)) : null;
}

/**
 * Pure: a persisted record plus the stored bars, as the page shows it. Null
 * when the bars no longer reach the as-of date (the block is then omitted).
 */
export function hydrateTiingoSnapshot(
  record: TiingoSnapshotRecord,
  bars: readonly EodBar[] | null | undefined,
  nowMs: number
): InsightSnapshot | null {
  const upTo = (bars ?? []).filter((b) => String(b?.[0] ?? "") <= record.snapshotDate);
  const points = barsToPoints(upTo);
  if (points.length < 2) return null;
  const surface = pickSurfacePrice(null, upTo as EodBar[], nowMs);
  if (!surface) return null;

  const ma50Pct = pctOrNull(record.ma50Pct);
  const ma200Pct = pctOrNull(record.ma200Pct);
  const weeklyMA200Pct = pctOrNull(record.weeklyMA200Pct);

  return {
    symbol: String(record.symbol ?? ""),
    companyName: typeof record.companyName === "string" ? record.companyName : "",
    snapshotDate: record.snapshotDate,
    price: surface.price,
    priceLabel: surface.label,
    source: "tiingo",
    trend: typeof record.trend === "string" ? record.trend : undefined,
    lastMA50: levelFromPct(surface.price, ma50Pct),
    lastMA200: levelFromPct(surface.price, ma200Pct),
    lastWeeklyMA200: levelFromPct(surface.price, weeklyMA200Pct),
    ma50Pct,
    ma200Pct,
    weeklyMA200Pct,
    chartPoints: points.slice(-2000),
  };
}

/** What resolveInsightSnapshot reads and writes through. Injected by the checks. */
export type InsightSnapshotDeps = {
  redis: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<unknown>;
  } | null;
  env: Record<string, string | undefined>;
  nowMs: number;
  /** Stored Tiingo bars (Data Cache), never a live Tiingo call. */
  readBars: (symbol: string) => Promise<EodBar[] | null>;
  companyName: (symbol: string) => Promise<string>;
  buildFmp: (symbol: string) => Promise<InsightSnapshot>;
};

/** A snapshot worth keeping forever: a real price. */
function hasUsablePrice(s: InsightSnapshot | null): s is InsightSnapshot {
  return Boolean(s && typeof s.price === "number" && Number.isFinite(s.price) && s.price > 0);
}

export async function resolveInsightSnapshot(
  args: { slug: string; symbol?: string | null },
  deps: InsightSnapshotDeps
): Promise<InsightSnapshot | null> {
  const { slug, symbol } = args;
  if (!slug || !symbol) return null;

  const { redis } = deps;
  if (!redis) return null;

  const sym = symbol.toUpperCase();
  const key = `insight-snapshot:${slug}`;
  const raw = await redis.get(key);

  // A Tiingo-path record: derived fields stored, priced fields read now.
  if (isTiingoRecord(raw)) {
    const bars = await deps.readBars(sym).catch(() => null);
    return hydrateTiingoSnapshot(raw, bars, deps.nowMs);
  }

  // An FMP-era snapshot: served as stored (FMP data, no Tiingo term applies).
  const existing = normalizeSnapshot(raw);
  if (existing) return existing;

  let toWrite: TiingoSnapshotRecord | InsightSnapshot | null = null;
  let shown: InsightSnapshot | null = null;

  if (priceProviderFor("CHARTS", deps.env) === "tiingo") {
    const bars = await deps.readBars(sym).catch(() => null);
    const record = buildTiingoRecord(sym, bars, bars ? await deps.companyName(sym).catch(() => "") : "");
    if (record) {
      toWrite = record;
      shown = hydrateTiingoSnapshot(record, bars, deps.nowMs);
    } else if (!deps.env.FMP_API_KEY) {
      // No stored bars and no FMP: nothing to show, nothing written, retried next render.
      return null;
    }
  }

  if (!toWrite) {
    const snapshot = await deps.buildFmp(sym);
    shown = snapshot;
    // Never a null-price snapshot forever: shown this once, rebuilt next render.
    if (hasUsablePrice(snapshot)) toWrite = snapshot;
  }

  if (toWrite) await redis.set(key, toWrite);

  return shown;
}

async function companyNameFor(symbol: string): Promise<string> {
  const rows = (await searchSymbols(symbol, "")) as SymbolRow[];
  return rows.find((r) => (r.symbol ?? "").toUpperCase() === symbol)?.name ?? "";
}

export async function getOrCreateInsightSnapshot(args: {
  slug: string;
  symbol?: string | null;
}) {
  return resolveInsightSnapshot(args, {
    redis: getRedisClient(),
    env: process.env,
    nowMs: Date.now(),
    readBars: async (s) => (await readTiingoHistory(s))?.bars ?? null,
    companyName: companyNameFor,
    buildFmp: buildSnapshot,
  });
}
