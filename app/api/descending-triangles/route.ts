// app/api/descending-triangles/route.ts
export const dynamic = "force-dynamic";

import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";
import {
  detectDescendingTriangle,
  type DescendingTriangleResult,
} from "../../../lib/ta/descendingTriangle";
import {
  getCachedDailyHistory,
  getDailyHistory,
} from "../../../lib/server/historyCache";

import {
  addToDynamicUniverse,
  readDynamicUniverse,
} from "../../../lib/server/dynamicUniverseCache";
import { getCompanyNameMap } from "../../../lib/server/companyNames";
import { isUnwantedBot } from "@/lib/botid-guard";

type Point = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type MarketRow = {
  symbol: string;
  changePct: number | null;
  rangePct: number | null;
  last: number | null;
  volume: number | null;
};

type MarketPayload = {
  updatedAt: string;
  topTraded: MarketRow[];
  topMovers: MarketRow[];
  topRanges: MarketRow[];
  dynamicUniverseSize?: number;
  dynamicSymbols?: string[];
};

type PlayTone = "green" | "yellow" | "orange" | "red";

type PlayChartPoint = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type PlayItem = {
  symbol: string;
  companyName?: string;
  play: "descendingTriangle";
  timeframe: "M" | "ST" | "D" | "W";
  score: number;
  tone: PlayTone;
  note: string;

  support: number;
  latestClose: number;
  distanceToSupportPct: number;

  supportTouches: number;
  fallingHighTouches: number;
  patternBars: number;

  supportZonePct: number;
  highSlopePct: number;

  resistanceStartDate: string;
  resistanceStartPrice: number;
  resistanceEndDate: string;
  resistanceEndPrice: number;

  startDate: string;
  endDate: string;

  chartPoints: PlayChartPoint[];

  dashboardHref: string;
};

type PlaySection = {
  title: string;
  description: string;
  foundCount: number;
  shownCount: number;
  items: PlayItem[];
};

type PlaysPayload = {
  updatedAt: string;
  universeSize: number;
  dynamicUniverseCount: number;
  dynamicUniversePreview: string[];
  estimatedApiCalls: number;
  sections: PlaySection[];
  debug?: unknown;
};

type CachedPlaysPayload = {
  cachedAt: number;
  data: PlaysPayload;
};

type AggregatedPoint = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

const PRESET_UNIVERSE: string[] = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "BRK.B",
  "AVGO",
  "LLY",
  "JPM",
  "V",
  "UNH",
  "XOM",
  "PG",
  "MA",
  "COST",
  "HD",
  "MRK",
  "ABBV",
  "CRM",
  "NFLX",
  "ORCL",
  "BAC",
  "KO",
  "PEP",
  "ADBE",
  "TMO",
  "WMT",
  "CSCO",
  "ACN",
  "MCD",
  "ABT",
  "CVX",
  "LIN",
  "AMD",
  "NKE",
  "DHR",
  "TXN",
  "INTC",
  "QCOM",
  "PM",
  "IBM",
  "NOW",
  "SBUX",
  "CAT",
  "GE",
  "AMAT",
  "LOW",
  "UBER",
  "PANW",
  "PLTR",
  "SHOP",
  "MU",
  "KLAC",
  "LRCX",
  "ANET",
  "SNOW",
  "CRWD",
  "MELI",
  "ASML",
  "APH",
  "DE",
  "PGR",
  "VRTX",
  "ADP",
  "INTU",
  "CMCSA",
  "COP",
  "AXP",
  "BKNG",
  "AMGN",
  "HON",
  "ISRG",
  "TJX",
  "SYK",
  "UNP",
  "GILD",
  "MDT",
  "ADI",
  "CB",
  "C",
  "MO",
  "GS",
  "ETN",
  "MMC",
  "TMUS",
  "CI",
  "SO",
  "DUK",
  "ELV",
  "SCHW",
  "BLK",
  "REGN",
  "FI",
  "TT",
  "PH",
  "PYPL",
  "CDNS",
  "MAR",
];

const UNIVERSE_CAP = 700;
const MAX_FRESH_HISTORY_FETCHES = 275;
const HISTORY_DAYS = 1300;

let memo:
  | {
      ts: number;
      data: PlaysPayload;
    }
  | null = null;

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const MEMORY_CACHE_MS = 60_000;
const CACHE_SECONDS = 60 * 60;
const STALE_SECONDS = 60 * 60;

const DESCENDING_REDIS_KEY = "msh:descending-triangles:v4:main";
const DESCENDING_REDIS_TTL_SECONDS = 60 * 60;
const DESCENDING_LOCK_KEY = "msh:descending-triangles:v4:main:lock";
const DESCENDING_LOCK_TTL_SECONDS = 120;

function originFromReq(req: NextRequest) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
}

function startOfWeekUtc(dateStr: string) {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const dt = new Date(Date.UTC(year, month - 1, day));
  const weekday = dt.getUTCDay();
  const diffToMonday = weekday === 0 ? 6 : weekday - 1;

  dt.setUTCDate(dt.getUTCDate() - diffToMonday);

  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function aggregateWeekly(points: Point[]): AggregatedPoint[] {
  const bucketed: AggregatedPoint[] = [];
  let currentKey = "";
  let current: AggregatedPoint | null = null;

  for (const point of points) {
    const key = startOfWeekUtc(point.date);

    if (!current || key !== currentKey) {
      if (current) bucketed.push(current);

      currentKey = key;
      current = {
        date: point.date,
        close: point.close,
        high: point.high,
        low: point.low,
        volume: typeof point.volume === "number" ? point.volume : undefined,
      };

      continue;
    }

    current.date = point.date;
    current.close = point.close;

    if (typeof point.high === "number") {
      current.high =
        typeof current.high === "number"
          ? Math.max(current.high, point.high)
          : point.high;
    }

    if (typeof point.low === "number") {
      current.low =
        typeof current.low === "number"
          ? Math.min(current.low, point.low)
          : point.low;
    }

    if (typeof point.volume === "number") {
      current.volume =
        typeof current.volume === "number"
          ? current.volume + point.volume
          : point.volume;
    }
  }

  if (current) bucketed.push(current);

  return bucketed;
}

function pLimit(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    active++;

    try {
      return await fn();
    } finally {
      next();
    }
  };
}

function cleanSymbols(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function optionalNumberFrom(source: unknown, key: string) {
  const value =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)[key]
      : undefined;

  if (value == null) return undefined;

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function normalizeCachedPoints(points: Point[]) {
  return points
    .map((p) => ({
      date: String(p?.date ?? ""),
      close: Number(p?.close),
      high: p?.high == null ? undefined : Number(p.high),
      low: p?.low == null ? undefined : Number(p.low),
      volume: p?.volume == null ? undefined : Number(p.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close))
    .slice(-HISTORY_DAYS);
}

async function readDescendingCache() {
  if (!redis) return null;

  try {
    const entry = await redis.get<CachedPlaysPayload>(DESCENDING_REDIS_KEY);
    if (!entry || typeof entry !== "object") return null;
    if (!entry.data || typeof entry.data !== "object") return null;
    return entry;
  } catch {
    return null;
  }
}

async function writeDescendingCache(data: PlaysPayload) {
  if (!redis) return;

  try {
    const entry: CachedPlaysPayload = {
      cachedAt: Date.now(),
      data,
    };

    await redis.set(DESCENDING_REDIS_KEY, entry, {
      ex: DESCENDING_REDIS_TTL_SECONDS,
    });
  } catch {
    // fail open
  }
}

async function acquireDescendingLock() {
  if (!redis) return "no-redis";

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const result = await redis.set(DESCENDING_LOCK_KEY, token, {
      nx: true,
      ex: DESCENDING_LOCK_TTL_SECONDS,
    });

    if (result === "OK") return token;
    return null;
  } catch {
    return null;
  }
}

async function releaseDescendingLock(token: string | null) {
  if (!redis || !token || token === "no-redis") return;

  try {
    const current = await redis.get<string>(DESCENDING_LOCK_KEY);
    if (current === token) {
      await redis.del(DESCENDING_LOCK_KEY);
    }
  } catch {
    // fail open
  }
}

async function fetchJSON<T>(url: string, forceFresh = false) {
  const res = await fetch(
    forceFresh ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url,
    forceFresh ? { cache: "no-store" } : { next: { revalidate: 300 } }
  );

  if (!res.ok) throw new Error(`Fetch failed: ${url}`);
  return (await res.json()) as T;
}

async function fetchMarket(origin: string, forceFresh = false) {
  return fetchJSON<MarketPayload>(`${origin}/api/market`, forceFresh);
}

async function fetchHistory(symbol: string, days: number): Promise<Point[]> {
  const pts = await getDailyHistory(symbol);

  return pts
    .map((p) => ({
      date: String(p?.date ?? ""),
      open: optionalNumberFrom(p, "open"),
      close: Number(p?.close),
      high: p?.high == null ? undefined : Number(p.high),
      low: p?.low == null ? undefined : Number(p.low),
      volume: p?.volume == null ? undefined : Number(p.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close))
    .slice(-days);
}

function buildDashboardHref(symbol: string, timeframe: "M" | "ST" | "D" | "W") {
  const params = new URLSearchParams();
  params.set("symbol", symbol);
  params.set("tf", timeframe === "ST" ? "D" : timeframe === "M" ? "W" : timeframe);

  return `/?${params.toString()}`;
}

function toPlayItem(
  symbol: string,
  result: DescendingTriangleResult,
  sourcePoints: Point[],
  itemTimeframe?: "M" | "ST" | "D" | "W"
): PlayItem {
  const displayTimeframe = itemTimeframe ?? result.timeframe;

const lineStartIndex = sourcePoints.findIndex(
  (point) => point.date === result.resistanceStartDate
);

const lineEndIndex = sourcePoints.findIndex(
  (point) => point.date === result.endDate
);

const safeLineStartIndex =
  lineStartIndex >= 0 ? lineStartIndex : Math.max(0, sourcePoints.length - result.patternBars);

const safeLineEndIndex =
  lineEndIndex >= 0 ? lineEndIndex : sourcePoints.length - 1;

const lineBars = Math.max(1, safeLineEndIndex - safeLineStartIndex + 1);

const contextBars = Math.ceil(lineBars * 0.25);

const chartStartIndex = Math.max(0, safeLineStartIndex - contextBars);

const chartPoints = sourcePoints
  .slice(chartStartIndex)
  .map((point) => ({
    date: point.date,
    open:
      typeof point.open === "number"
        ? Number(point.open.toFixed(2))
        : undefined,
    close: Number(point.close.toFixed(2)),
    high:
      typeof point.high === "number"
        ? Number(point.high.toFixed(2))
        : undefined,
    low:
      typeof point.low === "number"
        ? Number(point.low.toFixed(2))
        : undefined,
    volume:
      typeof point.volume === "number" && Number.isFinite(point.volume)
        ? point.volume
        : undefined,
  }))
  .filter((point) => point.date && Number.isFinite(point.close));

  return {
    symbol,
    play: "descendingTriangle",
    timeframe: displayTimeframe,
    score: result.score,
    tone: result.tone,
    note: result.note,

    support: result.support,
    latestClose: result.latestClose,
    distanceToSupportPct: result.distanceToSupportPct,

    supportTouches: result.supportTouches,
    fallingHighTouches: result.fallingHighTouches,
    patternBars: result.patternBars,

    supportZonePct: result.supportZonePct,
    highSlopePct: result.highSlopePct,

    resistanceStartDate: result.resistanceStartDate,
    resistanceStartPrice: result.resistanceStartPrice,
    resistanceEndDate: result.resistanceEndDate,
    resistanceEndPrice: result.resistanceEndPrice,

    startDate: result.startDate,
    endDate: result.endDate,

    chartPoints,

    dashboardHref: buildDashboardHref(symbol, displayTimeframe),
  };
}

function buildSection(args: {
  title: string;
  description: string;
  source: PlayItem[];
  take: number;
}): PlaySection {
  const sorted = [...args.source].sort((a, b) => b.score - a.score);
  const items = sorted.slice(0, args.take);

  return {
    title: args.title,
    description: args.description,
    foundCount: args.source.length,
    shownCount: items.length,
    items,
  };
}

function isMacroDescendingCandidate(result: DescendingTriangleResult) {
  const hasEnoughStructure =
    result.patternBars >= 28 ||
    result.fallingHighTouches >= 4 ||
    result.supportTouches >= 4;

  const isWideEnough =
    Math.abs(result.highSlopePct) >= 8 ||
    result.distanceToSupportPct >= 8 ||
    result.supportZonePct >= 3;

  const notTinyWeeklyPattern = result.patternBars >= 22;

  return notTinyWeeklyPattern && hasEnoughStructure && isWideEnough;
}

function toMacroDescendingResult(result: DescendingTriangleResult) {
  return {
    ...result,
    note: `Macro descending triangle candidate: ${result.supportTouches} support touches, ${result.fallingHighTouches} falling highs, ${result.distanceToSupportPct.toFixed(
      1
    )}% above support.`,
  };
}

function bestTriangleForWindows(
  points: Point[],
  timeframe: "M" | "ST" | "D" | "W",
  windows: number[]
): DescendingTriangleResult | null {
  const detectorTimeframe = timeframe === "M" || timeframe === "W" ? "W" : "D";

  const maxDistanceAboveSupportPct =
    timeframe === "M" ? 16 : timeframe === "W" ? 7 : timeframe === "ST" ? 6 : 7;

  const maxSupportZonePct =
    timeframe === "M" ? 6.5 : timeframe === "W" ? 4.5 : timeframe === "ST" ? 3.5 : 4;

  const minPatternBars =
    timeframe === "M" ? 24 : timeframe === "W" ? 12 : timeframe === "ST" ? 18 : 35;

  const maxPatternBars =
    timeframe === "M" ? 249 : timeframe === "W" ? 140 : timeframe === "ST" ? 70 : 180;

  const minTouchSeparationBars =
    timeframe === "M" ? 2 : timeframe === "W" ? 2 : timeframe === "ST" ? 4 : 5;

  const results = windows
    .map((lookbackBars) =>
      detectDescendingTriangle(points, {
        timeframe: detectorTimeframe,
        lookbackBars,
        maxDistanceAboveSupportPct,
        maxSupportZonePct,
        minSupportTouches: timeframe === "M" ? 2 : 2,
        minFallingHighTouches: timeframe === "M" ? 2 : 2,
        minPatternBars,
        minTouchSeparationBars,
      })
    )
    .filter((result): result is DescendingTriangleResult => result !== null)
    .filter((result) => {
      if (result.supportZonePct > maxSupportZonePct) {
        return false;
      }

      if (result.patternBars < minPatternBars) {
        return false;
      }

      if (result.patternBars > maxPatternBars) {
        return false;
      }

      return true;
    })
    .map((result) => {
      if (timeframe === "M") {
        return {
          ...result,
          timeframe: "W" as const,
          note: `Macro descending triangle candidate: ${result.supportTouches} support touches, ${result.fallingHighTouches} falling highs, ${result.distanceToSupportPct.toFixed(1)}% above support.`,
        };
      }

      if (timeframe === "ST") {
        return {
          ...result,
          timeframe: "D" as const,
          note: `Short-term descending triangle candidate: ${result.supportTouches} support touches, ${result.fallingHighTouches} falling highs, ${result.distanceToSupportPct.toFixed(1)}% above support.`,
        };
      }

      return result;
    });

  if (!results.length) return null;

  return [...results].sort((a, b) => b.score - a.score)[0];
}

function debugTriangleWindows(
  points: Point[],
  timeframe: "M" | "ST" | "D" | "W",
  windows: number[]
) {
  const detectorTimeframe = timeframe === "M" || timeframe === "W" ? "W" : "D";

  const maxDistanceAboveSupportPct =
    timeframe === "W" ? 3.75 : timeframe === "ST" ? 2.25 : 3;

  const maxSupportZonePct =
    timeframe === "W" ? 4 : timeframe === "ST" ? 2.75 : 3.25;

  const minPatternBars =
    timeframe === "W" ? 12 : timeframe === "ST" ? 18 : 35;

  const maxPatternBars =
    timeframe === "W" ? 249 : timeframe === "ST" ? 70 : 180;

  return windows.map((lookbackBars) => {
    const result = detectDescendingTriangle(points, {
      timeframe: detectorTimeframe,
      lookbackBars,
      maxDistanceAboveSupportPct,
      minSupportTouches: 2,
      minFallingHighTouches: 2,
      minPatternBars,
    });

    if (!result) {
      return {
        timeframe,
        lookbackBars,
        passed: false,
        reason: "detector_returned_null",
      };
    }

    const failedReasons: string[] = [];

    if (result.supportZonePct > maxSupportZonePct) {
      failedReasons.push(
        `support_zone_too_wide: ${result.supportZonePct}% > ${maxSupportZonePct}%`
      );
    }

    if (result.patternBars < minPatternBars) {
      failedReasons.push(
        `pattern_too_short: ${result.patternBars} < ${minPatternBars}`
      );
    }

    if (result.patternBars > maxPatternBars) {
      failedReasons.push(
        `pattern_too_wide: ${result.patternBars} > ${maxPatternBars}`
      );
    }

    return {
      timeframe,
      lookbackBars,
      passed: failedReasons.length === 0,
      reason: failedReasons.length ? failedReasons.join("; ") : "passed",
      result: {
        score: result.score,
        support: result.support,
        latestClose: result.latestClose,
        distanceToSupportPct: result.distanceToSupportPct,
        supportTouches: result.supportTouches,
        fallingHighTouches: result.fallingHighTouches,
        supportZonePct: result.supportZonePct,
        highSlopePct: result.highSlopePct,
        patternBars: result.patternBars,
        startDate: result.startDate,
        endDate: result.endDate,
      },
    };
  });
}

async function buildDescendingPayload(
  origin: string,
  forceFreshMarket = false,
  debugSymbolInput: string | null = null
): Promise<PlaysPayload> {
  const market = await fetchMarket(origin, forceFreshMarket);

  const topTraded = (market?.topTraded ?? [])
    .map((x) => x.symbol)
    .filter(Boolean);

  const topMovers = (market?.topMovers ?? [])
    .map((x) => x.symbol)
    .filter(Boolean);

  const topRanges = (market?.topRanges ?? [])
    .map((x) => x.symbol)
    .filter(Boolean);

  const accumulatedDynamicUniverse = Array.isArray(market?.dynamicSymbols)
    ? market.dynamicSymbols
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
    : [];

  const rankedDynamicUniverse = cleanSymbols([
    ...topTraded,
    ...topMovers,
    ...topRanges,
  ]);

  const sharedUniverseEntries = await readDynamicUniverse();

  const sharedUniverseSymbols = sharedUniverseEntries.map(
    (entry) => entry.symbol
  );

  const dynamicUniverse = cleanSymbols([
    ...sharedUniverseSymbols,
    ...accumulatedDynamicUniverse,
    ...rankedDynamicUniverse,
  ]);

  await addToDynamicUniverse(
    [...accumulatedDynamicUniverse, ...rankedDynamicUniverse],
    "market",
    1
  );

  const priorityUniverse = cleanSymbols([
    ...rankedDynamicUniverse,
    ...PRESET_UNIVERSE,
    ...sharedUniverseSymbols,
    ...accumulatedDynamicUniverse,
  ]);

  const normalizedDebugSymbol = debugSymbolInput
    ? String(debugSymbolInput).trim().toUpperCase()
    : "";

  let universe = priorityUniverse.slice(0, UNIVERSE_CAP);

  if (normalizedDebugSymbol && !universe.includes(normalizedDebugSymbol)) {
    universe = cleanSymbols([normalizedDebugSymbol, ...universe]).slice(
      0,
      UNIVERSE_CAP
    );
  }

  const debugSymbolScan: any = normalizedDebugSymbol
    ? {
        symbol: normalizedDebugSymbol,
        priorityIndex: priorityUniverse.indexOf(normalizedDebugSymbol),
        scanIndex: universe.indexOf(normalizedDebugSymbol),
        inPriorityUniverse: priorityUniverse.includes(normalizedDebugSymbol),
        inScanUniverse: universe.includes(normalizedDebugSymbol),
        scanned: false,
        cacheHadHistory: false,
        cachedBars: 0,
        freshFetchUsed: false,
        freshFetchSkippedBecauseBudgetUsed: false,
        dailyBars: 0,
        weeklyBars: 0,
        matched: null,
        diagnostics: null,
      }
    : null;

  const macroDescendingTriangles: PlayItem[] = [];
  const weeklyDescendingTriangles: PlayItem[] = [];
  const dailyDescendingTriangles: PlayItem[] = [];
  const shortTermDescendingTriangles: PlayItem[] = [];

  let freshHistoryFetchesUsed = 0;
  const limit = pLimit(10);

  async function getHistoryForScan(symbol: string) {
    const cachedPoints = await getCachedDailyHistory(symbol);

    if (symbol === normalizedDebugSymbol && debugSymbolScan) {
      debugSymbolScan.cacheHadHistory = cachedPoints.length > 0;
      debugSymbolScan.cachedBars = cachedPoints.length;
    }

    if (cachedPoints.length) {
      return normalizeCachedPoints(cachedPoints);
    }

    if (freshHistoryFetchesUsed >= MAX_FRESH_HISTORY_FETCHES) {
      if (symbol === normalizedDebugSymbol && debugSymbolScan) {
        debugSymbolScan.freshFetchSkippedBecauseBudgetUsed = true;
      }

      return [] as Point[];
    }

    freshHistoryFetchesUsed++;

    if (symbol === normalizedDebugSymbol && debugSymbolScan) {
      debugSymbolScan.freshFetchUsed = true;
    }

    return fetchHistory(symbol, HISTORY_DAYS);
  }

  await Promise.all(
    universe.map((symbol) =>
      limit(async () => {
        try {
          const dailyPoints = await getHistoryForScan(symbol);

          if (symbol === normalizedDebugSymbol && debugSymbolScan) {
            debugSymbolScan.scanned = true;
            debugSymbolScan.dailyBars = dailyPoints.length;
          }

          if (dailyPoints.length < 80) return;

          const weeklyPoints = aggregateWeekly(dailyPoints);

          if (symbol === normalizedDebugSymbol && debugSymbolScan) {
            debugSymbolScan.weeklyBars = weeklyPoints.length;
            debugSymbolScan.diagnostics = {
              macro: debugTriangleWindows(weeklyPoints, "M", [
                104,
                120,
                140,
                156,
                180,
                208,
                249,
              ]),
              weekly: debugTriangleWindows(weeklyPoints, "W", [
                39,
                52,
                80,
                104,
                156,
              ]),
              daily: debugTriangleWindows(dailyPoints, "D", [90, 120, 160]),
              shortTerm: debugTriangleWindows(dailyPoints, "ST", [35, 50, 70]),
            };
          }

const macroTriangle = bestTriangleForWindows(weeklyPoints, "M", [
  104,
  120,
  140,
  156,
  180,
  208,
  249,
]);

if (macroTriangle) {
  if (symbol === normalizedDebugSymbol && debugSymbolScan) {
    debugSymbolScan.matched = "macro";
  }

  macroDescendingTriangles.push(
    toPlayItem(symbol, toMacroDescendingResult(macroTriangle), weeklyPoints, "M")
  );
  return;
}

const weeklyTriangle = bestTriangleForWindows(weeklyPoints, "W", [
  39,
  52,
  80,
  104,
  156,
]);

if (weeklyTriangle) {
  if (isMacroDescendingCandidate(weeklyTriangle)) {
    if (symbol === normalizedDebugSymbol && debugSymbolScan) {
      debugSymbolScan.matched = "macro_from_weekly";
    }

    macroDescendingTriangles.push(
      toPlayItem(
        symbol,
        toMacroDescendingResult(weeklyTriangle),
        weeklyPoints,
        "M"
      )
    );
    return;
  }

  if (symbol === normalizedDebugSymbol && debugSymbolScan) {
    debugSymbolScan.matched = "weekly";
  }

  weeklyDescendingTriangles.push(
    toPlayItem(symbol, weeklyTriangle, weeklyPoints)
  );
  return;
}

          const dailyTriangle = bestTriangleForWindows(dailyPoints, "D", [
            90,
            120,
            160,
          ]);

          if (dailyTriangle) {
            if (symbol === normalizedDebugSymbol && debugSymbolScan) {
              debugSymbolScan.matched = "daily";
            }

            dailyDescendingTriangles.push(
              toPlayItem(symbol, dailyTriangle, dailyPoints)
            );
            return;
          }

          const shortTermTriangle = bestTriangleForWindows(dailyPoints, "ST", [
            35,
            50,
            70,
          ]);

          if (shortTermTriangle) {
            if (symbol === normalizedDebugSymbol && debugSymbolScan) {
              debugSymbolScan.matched = "shortTerm";
            }

            shortTermDescendingTriangles.push({
              ...toPlayItem(symbol, shortTermTriangle, dailyPoints),
              timeframe: "ST",
              note: shortTermTriangle.note,
              dashboardHref: buildDashboardHref(symbol, "ST"),
            });
          }
        } catch {
          // Skip bad symbols/data without failing the full descending page.
        }
      })
    )
  );

  const bestDescendingTriangles = [
    ...macroDescendingTriangles,
    ...weeklyDescendingTriangles,
    ...dailyDescendingTriangles,
    ...shortTermDescendingTriangles,
  ];

  const sections = [
    buildSection({
      title: "Best Descending Triangle Plays",
      description:
        "The strongest macro, weekly, daily, and short-term descending triangle candidates, ranked by support quality, falling highs, breakdown proximity and structure age.",
      source: bestDescendingTriangles,
      take: 24,
    }),
    buildSection({
      title: "Macro Descending Triangle Plays",
      description:
        "Large descending triangle structures built from wider weekly chart history. These are slower-forming macro setups that may span many months.",
      source: macroDescendingTriangles,
      take: 24,
    }),
    buildSection({
      title: "Weekly Descending Triangle Plays",
      description:
        "Longer-term descending triangle candidates built from wider weekly chart structure.",
      source: weeklyDescendingTriangles,
      take: 24,
    }),
    buildSection({
      title: "Daily Descending Triangle Plays",
      description:
        "Medium-term daily descending triangle candidates where price is inside a defined descending triangle structure.",
      source: dailyDescendingTriangles,
      take: 24,
    }),
    buildSection({
      title: "Short-Term Descending Triangle Plays",
      description:
        "Compact descending triangle formations detected from tighter daily chart structure.",
      source: shortTermDescendingTriangles,
      take: 24,
    }),
  ];

  // Best-effort company names for the card display line. Never blocks or
  // breaks the page: any symbol that doesn't resolve just shows the ticker.
  try {
    const nameMap = await getCompanyNameMap();
    if (nameMap.size) {
      for (const section of sections) {
        for (const item of section.items) {
          const name = nameMap.get(item.symbol);
          if (name) item.companyName = name;
        }
      }
    }
  } catch {
    // names are optional
  }

  return {
    updatedAt: new Date().toISOString(),
    universeSize: universe.length,
    dynamicUniverseCount:
      typeof market?.dynamicUniverseSize === "number"
        ? market.dynamicUniverseSize
        : dynamicUniverse.length,
    dynamicUniversePreview: dynamicUniverse.slice(0, 20),
    estimatedApiCalls: freshHistoryFetchesUsed + 1,
    sections,
    debug: debugSymbolScan
      ? {
          symbolScan: debugSymbolScan,
        }
      : undefined,
  };
}

export async function GET(req: NextRequest) {
  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const now = Date.now();
  const forceRefresh = req.nextUrl.searchParams.get("force") === "1";
  const debugSymbol = req.nextUrl.searchParams.get("debugSymbol");

  if (!forceRefresh && !debugSymbol && memo && now - memo.ts < MEMORY_CACHE_MS) {
    return NextResponse.json(memo.data, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  }

  const cached = forceRefresh || debugSymbol ? null : await readDescendingCache();

  if (!forceRefresh && !debugSymbol && cached?.data) {
    memo = { ts: now, data: cached.data };

    return NextResponse.json(cached.data, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  }

  const lockToken = await acquireDescendingLock();

  if (!lockToken) {
    const fallbackCached = cached ?? (await readDescendingCache());

    if (fallbackCached?.data && !debugSymbol) {
      memo = { ts: now, data: fallbackCached.data };

      return NextResponse.json(fallbackCached.data, {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
          "X-Descending-Cache": "lock-fallback",
        },
      });
    }
  }

  try {
    const origin = originFromReq(req);
    const data = await buildDescendingPayload(
      origin,
      forceRefresh,
      debugSymbol
    );

    if (!debugSymbol) {
      memo = {
        ts: now,
        data,
      };

      await writeDescendingCache(data);
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": forceRefresh || debugSymbol
          ? "no-store"
          : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  } catch (error) {
    const fallbackCached = cached ?? (await readDescendingCache());

    if (fallbackCached?.data && !debugSymbol) {
      memo = { ts: now, data: fallbackCached.data };

      return NextResponse.json(fallbackCached.data, {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
          "X-Descending-Cache": "error-fallback",
        },
      });
    }

    const message =
      error instanceof Error ? error.message : "Unknown descending triangle error";

    return NextResponse.json(
      {
        updatedAt: new Date().toISOString(),
        universeSize: 0,
        dynamicUniverseCount: 0,
        dynamicUniversePreview: [],
        estimatedApiCalls: 0,
        sections: [],
        error: message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } finally {
    await releaseDescendingLock(lockToken);
  }
}
