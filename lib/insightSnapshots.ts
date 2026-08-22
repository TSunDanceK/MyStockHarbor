import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "@/lib/server/redisCacheMode";
import type { InsightSnapshot, InsightSnapshotPoint } from "@/lib/blog";
import { getDailyHistory } from "@/lib/server/historyCache";
import { fetchQuoteSnapshot, type Quote } from "@/lib/server/quoteData";
import { searchSymbols, type SymbolRow } from "@/lib/server/symbolSearch";

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

// Builds a new Insight post's SEO snapshot (price, trend, MA levels, chart
// points) once, then caches it in Redis forever (see
// getOrCreateInsightSnapshot below) so the post's initial HTML always has
// real data embedded for crawlers, per the rendering policy (claude/RENDERING_POLICY.md).
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
    fetchQuoteSnapshot(symbol) as Promise<Quote>,
    getDailyHistory(symbol),
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
    trend,
    lastMA50: typeof lastMA50 === "number" ? Number(lastMA50.toFixed(4)) : null,
    lastMA200:
      typeof lastMA200 === "number" ? Number(lastMA200.toFixed(4)) : null,
    lastWeeklyMA200:
      typeof lastWeeklyMA200 === "number"
        ? Number(lastWeeklyMA200.toFixed(4))
        : null,
    ma50Pct: typeof ma50Pct === "number" ? Number(ma50Pct.toFixed(4)) : null,
    ma200Pct:
      typeof ma200Pct === "number" ? Number(ma200Pct.toFixed(4)) : null,
    weeklyMA200Pct:
      typeof weeklyMA200Pct === "number"
        ? Number(weeklyMA200Pct.toFixed(4))
        : null,
  chartPoints: points.slice(-2000),
  };
}

export async function getOrCreateInsightSnapshot(args: {
  slug: string;
  symbol?: string | null;
}) {
  const { slug, symbol } = args;
  if (!slug || !symbol) return null;

  const redis = getRedisClient();
  if (!redis) return null;

  const key = `insight-snapshot:${slug}`;

  const existing = normalizeSnapshot(await redis.get(key));
  if (existing) return existing;

  const snapshot = await buildSnapshot(symbol.toUpperCase());

  await redis.set(key, snapshot);

  return snapshot;
}
