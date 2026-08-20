// lib/server/playsBuilder.ts
//
// Core data-building logic for /api/plays, extracted so app/plays/page.tsx
// can read the payload in-process via getPlaysData() instead of doing an
// HTTP self-fetch to its own (now BotID-guarded) /api/plays route. That
// self-fetch carries no browser BotID header and would otherwise itself be
// read as bot traffic and 403'd -- the exact previously-proven failure mode
// documented in claude/pickers-firewall-selfblock-2026-07-17.md (the
// picker pages went blank in production from this same self-fetch-gets-
// blocked pattern). This module's exported GET handler support (via
// app/api/plays/route.ts calling getPlaysData) and this in-process path
// share the same in-memory memo, Redis cache, and refresh lock defined in
// this module, so the public endpoint and SSR stay perfectly consistent.

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import {
  detectAscendingTriangle,
  type AscendingTriangleResult,
} from "../ta/ascendingTriangle";
import { getCachedDailyHistory, getDailyHistory } from "./historyCache";

import { addToDynamicUniverse, readDynamicUniverse } from "./dynamicUniverseCache";
import { getCompanyNameMap } from "./companyNames";
import { PRESET_UNIVERSE } from "./presetUniverse";
import { readMarketState } from "./marketState";

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
  play: "ascendingTriangle";
  timeframe: "M" | "ST" | "D" | "W";
  score: number;
  tone: PlayTone;
  note: string;

  resistance: number;
  latestClose: number;
  distanceToResistancePct: number;

  resistanceTouches: number;
  risingLowTouches: number;
  patternBars: number;

  resistanceZonePct: number;
  lowSlopePct: number;

  supportStartDate: string;
  supportStartPrice: number;
  supportEndDate: string;
  supportEndPrice: number;

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

export type PlaysPayload = {
  updatedAt: string;
  universeSize: number;
  dynamicUniverseCount: number;
  dynamicUniversePreview: string[];
  estimatedApiCalls: number;
  sections: PlaySection[];
  debug?: unknown;
  error?: string;
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
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const MEMORY_CACHE_MS = 60_000;
const CACHE_SECONDS = 60 * 60;
const STALE_SECONDS = 60 * 60;

const PLAYS_REDIS_KEY = "msh:plays:v5:main";
const PLAYS_REDIS_TTL_SECONDS = 60 * 60;
const PLAYS_LOCK_KEY = "msh:plays:v5:main:lock";
const PLAYS_LOCK_TTL_SECONDS = 120;

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

async function readPlaysCache() {
  if (!redis) return null;

  try {
    const entry = await redis.get<CachedPlaysPayload>(PLAYS_REDIS_KEY);
    if (!entry || typeof entry !== "object") return null;
    if (!entry.data || typeof entry.data !== "object") return null;
    return entry;
  } catch {
    return null;
  }
}

async function writePlaysCache(data: PlaysPayload) {
  if (!redis) return;

  try {
    const entry: CachedPlaysPayload = {
      cachedAt: Date.now(),
      data,
    };

    await redis.set(PLAYS_REDIS_KEY, entry, {
      ex: PLAYS_REDIS_TTL_SECONDS,
    });
  } catch {
    // fail open
  }
}

async function acquirePlaysLock() {
  if (!redis) return "no-redis";

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const result = await redis.set(PLAYS_LOCK_KEY, token, {
      nx: true,
      ex: PLAYS_LOCK_TTL_SECONDS,
    });

    if (result === "OK") return token;
    return null;
  } catch {
    return null;
  }
}

async function releasePlaysLock(token: string | null) {
  if (!redis || !token || token === "no-redis") return;

  try {
    const current = await redis.get<string>(PLAYS_LOCK_KEY);
    if (current === token) {
      await redis.del(PLAYS_LOCK_KEY);
    }
  } catch {
    // fail open
  }
}

// Reads the discovery universe in-process instead of fetching this
// deployment's own /api/market URL. See lib/server/marketState.ts for the full
// reasoning: that self-request carried no BotID header and no session cookie,
// so the firewall could challenge it on production and the SSO gate refused it
// outright on every preview, and fetchJSON's throw then became a 500 for the
// whole page whenever the plays cache was also cold.
//
// readMarketState never throws: a miss degrades to empty rankings and the
// universe falls back to readDynamicUniverse() + PRESET_UNIVERSE below.
async function fetchMarket(_origin: string, _forceFresh = false): Promise<MarketPayload> {
  return readMarketState();
}

async function fetchHistory(symbol: string, days: number): Promise<Point[]> {
  const pts = await getDailyHistory(symbol);

  return pts
    .map((p) => ({
      date: String(p?.date ?? ""),
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
  result: AscendingTriangleResult,
  sourcePoints: Point[],
  itemTimeframe?: "M" | "ST" | "D" | "W"
): PlayItem {
  const displayTimeframe = itemTimeframe ?? result.timeframe;

  const chartBars =
    displayTimeframe === "M"
      ? Math.min(260, Math.max(90, result.patternBars + 12))
      : displayTimeframe === "W"
        ? Math.min(220, Math.max(52, result.patternBars + 8))
        : Math.min(280, Math.max(90, result.patternBars + 15));

  const chartPoints = sourcePoints
    .slice(-chartBars)
    .map((point) => ({
      date: point.date,
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
    play: "ascendingTriangle",
    timeframe: displayTimeframe,
    score: result.score,
    tone: result.tone,
    note: result.note,

    resistance: result.resistance,
    latestClose: result.latestClose,
    distanceToResistancePct: result.distanceToResistancePct,

    resistanceTouches: result.resistanceTouches,
    risingLowTouches: result.risingLowTouches,
    patternBars: result.patternBars,

    resistanceZonePct: result.resistanceZonePct,
    lowSlopePct: result.lowSlopePct,

    supportStartDate: result.supportStartDate,
    supportStartPrice: result.supportStartPrice,
    supportEndDate: result.supportEndDate,
    supportEndPrice: result.supportEndPrice,

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

function isMacroAscendingCandidate(result: AscendingTriangleResult) {
  const hasEnoughStructure =
    result.patternBars >= 28 ||
    result.risingLowTouches >= 4 ||
    result.resistanceTouches >= 4;

  const isWideEnough =
    Math.abs(result.lowSlopePct) >= 8 ||
    result.distanceToResistancePct >= 8 ||
    result.resistanceZonePct >= 3;

  const notTinyWeeklyPattern = result.patternBars >= 22;

  return notTinyWeeklyPattern && hasEnoughStructure && isWideEnough;
}

function toMacroAscendingResult(result: AscendingTriangleResult) {
  return {
    ...result,
    note: `Macro ascending triangle candidate: ${result.resistanceTouches} resistance touches, ${result.risingLowTouches} rising lows, ${result.distanceToResistancePct.toFixed(
      1
    )}% below resistance.`,
  };
}

function bestTriangleForWindows(
  points: Point[],
  timeframe: "M" | "ST" | "D" | "W",
  windows: number[]
): AscendingTriangleResult | null {
  const detectorTimeframe = timeframe === "M" || timeframe === "W" ? "W" : "D";

  const maxDistanceBelowResistancePct =
    timeframe === "M" ? 16 : timeframe === "W" ? 7 : timeframe === "ST" ? 6 : 7;

  const maxResistanceZonePct =
    timeframe === "M" ? 6.5 : timeframe === "W" ? 4.5 : timeframe === "ST" ? 3.5 : 4;

  const minPatternBars =
    timeframe === "M" ? 24 : timeframe === "W" ? 12 : timeframe === "ST" ? 18 : 35;

  const maxPatternBars =
    timeframe === "M" ? 249 : timeframe === "W" ? 140 : timeframe === "ST" ? 70 : 180;

  const minTouchSeparationBars =
    timeframe === "M" ? 2 : timeframe === "W" ? 2 : timeframe === "ST" ? 4 : 5;

  const results = windows
    .map((lookbackBars) =>
      detectAscendingTriangle(points, {
        timeframe: detectorTimeframe,
        lookbackBars,
        maxDistanceBelowResistancePct,
        maxResistanceZonePct,
        minResistanceTouches: 2,
        minRisingLowTouches: 2,
        minPatternBars,
        minTouchSeparationBars,
      })
    )
    .filter((result): result is AscendingTriangleResult => result !== null)
    .filter((result) => {
      if (result.resistanceZonePct > maxResistanceZonePct) {
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
          note: `Macro ascending triangle candidate: ${result.resistanceTouches} resistance touches, ${result.risingLowTouches} rising lows, ${result.distanceToResistancePct.toFixed(1)}% below resistance.`,
        };
      }

      if (timeframe === "ST") {
        return {
          ...result,
          timeframe: "D" as const,
          note: `Short-term ascending triangle candidate: ${result.resistanceTouches} resistance touches, ${result.risingLowTouches} rising lows, ${result.distanceToResistancePct.toFixed(1)}% below resistance.`,
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

  const maxDistanceBelowResistancePct =
    timeframe === "M" ? 16 : timeframe === "W" ? 7 : timeframe === "ST" ? 6 : 7;

  const maxResistanceZonePct =
    timeframe === "M" ? 6.5 : timeframe === "W" ? 4.5 : timeframe === "ST" ? 3.5 : 4;

  const minPatternBars =
    timeframe === "M" ? 24 : timeframe === "W" ? 12 : timeframe === "ST" ? 18 : 35;

  const maxPatternBars =
    timeframe === "M" ? 249 : timeframe === "W" ? 140 : timeframe === "ST" ? 70 : 180;

  const minTouchSeparationBars =
    timeframe === "M" ? 2 : timeframe === "W" ? 2 : timeframe === "ST" ? 4 : 5;

  return windows.map((lookbackBars) => {
    const result = detectAscendingTriangle(points, {
      timeframe: detectorTimeframe,
      lookbackBars,
      maxDistanceBelowResistancePct,
      maxResistanceZonePct,
      minResistanceTouches: 2,
      minRisingLowTouches: 2,
      minPatternBars,
      minTouchSeparationBars,
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

    if (result.resistanceZonePct > maxResistanceZonePct) {
      failedReasons.push(
        `resistance_zone_too_wide: ${result.resistanceZonePct}% > ${maxResistanceZonePct}%`
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
        resistance: result.resistance,
        latestClose: result.latestClose,
        distanceToResistancePct: result.distanceToResistancePct,
        resistanceTouches: result.resistanceTouches,
        risingLowTouches: result.risingLowTouches,
        resistanceZonePct: result.resistanceZonePct,
        lowSlopePct: result.lowSlopePct,
        patternBars: result.patternBars,
        startDate: result.startDate,
        endDate: result.endDate,
      },
    };
  });
}

async function buildPlaysPayload(
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

  const macroAscendingTriangles: PlayItem[] = [];
  const weeklyAscendingTriangles: PlayItem[] = [];
  const dailyAscendingTriangles: PlayItem[] = [];
  const shortTermAscendingTriangles: PlayItem[] = [];

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

            macroAscendingTriangles.push(
              toPlayItem(symbol, macroTriangle, weeklyPoints, "M")
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
            if (isMacroAscendingCandidate(weeklyTriangle)) {
              if (symbol === normalizedDebugSymbol && debugSymbolScan) {
                debugSymbolScan.matched = "macro_from_weekly";
              }

              macroAscendingTriangles.push(
                toPlayItem(
                  symbol,
                  toMacroAscendingResult(weeklyTriangle),
                  weeklyPoints,
                  "M"
                )
              );
              return;
            }

            if (symbol === normalizedDebugSymbol && debugSymbolScan) {
              debugSymbolScan.matched = "weekly";
            }

            weeklyAscendingTriangles.push(
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

            dailyAscendingTriangles.push(
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

            shortTermAscendingTriangles.push({
              ...toPlayItem(symbol, shortTermTriangle, dailyPoints),
              timeframe: "ST",
              note: shortTermTriangle.note,
              dashboardHref: buildDashboardHref(symbol, "ST"),
            });
          }
        } catch {
          // Skip bad symbols/data without failing the full plays page.
        }
      })
    )
  );

  const bestAscendingTriangles = [
    ...macroAscendingTriangles,
    ...weeklyAscendingTriangles,
    ...dailyAscendingTriangles,
    ...shortTermAscendingTriangles,
  ];

  const sections = [
    buildSection({
      title: "Best Ascending Triangle Plays",
      description:
        "The strongest macro, weekly, daily, and short-term ascending triangle candidates, ranked by resistance quality, rising lows, breakout proximity and structure age.",
      source: bestAscendingTriangles,
      take: 24,
    }),
    buildSection({
      title: "Macro Ascending Triangle Plays",
      description:
        "Large ascending triangle structures built from wider weekly chart history. These are slower-forming macro setups that may span many months.",
      source: macroAscendingTriangles,
      take: 24,
    }),
    buildSection({
      title: "Weekly Ascending Triangle Plays",
      description:
        "Longer-term ascending triangle candidates built from wider weekly chart structure.",
      source: weeklyAscendingTriangles,
      take: 24,
    }),
    buildSection({
      title: "Daily Ascending Triangle Plays",
      description:
        "Medium-term daily ascending triangle candidates where price is inside a defined ascending triangle structure.",
      source: dailyAscendingTriangles,
      take: 24,
    }),
    buildSection({
      title: "Short-Term Ascending Triangle Plays",
      description:
        "Compact ascending triangle formations detected from tighter daily chart structure.",
      source: shortTermAscendingTriangles,
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

export type PlaysDataOpts = {
  forceRefresh?: boolean;
  debugSymbol?: string | null;
};

export type PlaysDataResult = {
  data: PlaysPayload;
  headers: Record<string, string>;
  status?: number;
};

// Shares the memo/Redis-cache/lock defined above with /api/plays's GET
// handler (same module), so the public endpoint and SSR stay perfectly
// consistent. See module header comment.
export async function getPlaysData(
  origin: string,
  opts: PlaysDataOpts = {}
): Promise<PlaysDataResult> {
  const forceRefresh = !!opts.forceRefresh;
  const debugSymbol = opts.debugSymbol ?? null;
  const now = Date.now();

  if (!forceRefresh && !debugSymbol && memo && now - memo.ts < MEMORY_CACHE_MS) {
    return {
      data: memo.data,
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    };
  }

  const cached = forceRefresh || debugSymbol ? null : await readPlaysCache();

  if (!forceRefresh && !debugSymbol && cached?.data) {
    memo = { ts: now, data: cached.data };

    return {
      data: cached.data,
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    };
  }

  const lockToken = await acquirePlaysLock();

  if (!lockToken) {
    const fallbackCached = cached ?? (await readPlaysCache());

    if (fallbackCached?.data && !debugSymbol) {
      memo = { ts: now, data: fallbackCached.data };

      return {
        data: fallbackCached.data,
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
          "X-Plays-Cache": "lock-fallback",
        },
      };
    }
  }

  try {
    const data = await buildPlaysPayload(origin, forceRefresh, debugSymbol);

    if (!debugSymbol) {
      memo = {
        ts: now,
        data,
      };

      await writePlaysCache(data);
    }

    return {
      data,
      headers: {
        "Cache-Control":
          forceRefresh || debugSymbol
            ? "no-store"
            : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    };
  } catch (error) {
    const fallbackCached = cached ?? (await readPlaysCache());

    if (fallbackCached?.data && !debugSymbol) {
      memo = { ts: now, data: fallbackCached.data };

      return {
        data: fallbackCached.data,
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
          "X-Plays-Cache": "error-fallback",
        },
      };
    }

    const message =
      error instanceof Error ? error.message : "Unknown plays error";

    return {
      data: {
        updatedAt: new Date().toISOString(),
        universeSize: 0,
        dynamicUniverseCount: 0,
        dynamicUniversePreview: [],
        estimatedApiCalls: 0,
        sections: [],
        error: message,
      },
      headers: {
        "Cache-Control": "no-store",
      },
      status: 500,
    };
  } finally {
    await releasePlaysLock(lockToken);
  }
}
