import { Redis } from "@upstash/redis";
import type { InsightSnapshot, InsightSnapshotPoint } from "@/lib/blog";

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type SymbolResult = {
  symbol: string;
  name: string;
  exchange: string;
};

function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  return Redis.fromEnv();
}

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }

  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/$/, "");
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, "")}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }

  return "http://localhost:3000";
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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Request failed: ${url} (${res.status})`);
  }

  return (await res.json()) as T;
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

async function buildSnapshot(symbol: string): Promise<InsightSnapshot> {
  const baseUrl = getBaseUrl();

  const [quoteData, historyData, symbolsData] = await Promise.all([
    fetchJson<Quote>(`${baseUrl}/api/quote?symbol=${encodeURIComponent(symbol)}`),
    fetchJson<{ points: any[] }>(
      `${baseUrl}/api/history?symbol=${encodeURIComponent(symbol)}&days=2200`
    ),
    fetchJson<{ results?: SymbolResult[] }>(
      `${baseUrl}/api/symbols?q=${encodeURIComponent(symbol)}`
    ),
  ]);

  const ptsRaw = Array.isArray(historyData.points) ? historyData.points : [];
  const points: Point[] = ptsRaw
    .map((p: any) => ({
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

  const exact = (symbolsData.results ?? []).find(
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
    chartPoints: points.slice(-240),
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
