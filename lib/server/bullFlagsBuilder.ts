// lib/server/bullFlagsBuilder.ts
//
// Core data-building logic for /api/bull-flags, extracted so
// app/plays/bull-flags/page.tsx can read the payload in-process via
// getBullFlagsData() instead of doing an HTTP self-fetch to its own (now
// BotID-guarded) /api/bull-flags route. That self-fetch carries no browser
// BotID header and would otherwise itself be read as bot traffic and
// 403'd -- the exact previously-proven failure mode documented in
// claude/pickers-firewall-selfblock-2026-07-17.md. app/api/bull-flags/
// route.ts's GET handler calls getBullFlagsData() too, so the public
// endpoint and SSR share the same in-memory memo, Redis cache, and refresh
// lock defined in this module and stay perfectly consistent.

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { detectBullFlag, type BullFlagResult } from "../ta/bullFlag";
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
  play: "bullFlag";
  timeframe: "M" | "ST" | "D" | "W";
  score: number;
  tone: PlayTone;
  note: string;

  poleStartPrice: number;
  poleHighPrice: number;
  latestClose: number;

  poleGainPct: number;
  flagRetracementPct: number;
  distanceToBreakoutPct: number;

  flagHigh: number;
  flagLow: number;
  flagBars: number;
  poleBars: number;
  flagDriftPct: number;

  flagUpperStartPrice: number;
  flagUpperEndPrice: number;
  flagLowerStartPrice: number;
  flagLowerEndPrice: number;
  flagAngleDeg: number;

  poleStartDate: string;
  poleHighDate: string;
  flagStartDate: string;

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
  open?: number;
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

const PLAYS_REDIS_KEY = "msh:bull-flags:v1:main";
const PLAYS_REDIS_TTL_SECONDS = 60 * 60;
const PLAYS_LOCK_KEY = "msh:bull-flags:v1:main:lock";
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
        open: typeof point.open === "number" ? point.open : point.close,
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
      open: optionalNumberFrom(p, "open"),
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
// deployment's own /api/market URL.
//
// That self-request had no browser BotID header and no session cookie, so the
// Vercel firewall could challenge it on production and the SSO gate refused it
// outright on every preview deployment. fetchJSON threw on the non-ok
// response, and with a cold plays cache getBullFlagsData's catch returned
// status 500 -- surfacing as "Failed to load chart plays" on a page whose data
// was sitting in Redis the whole time. Same self-block already fixed in
// claude/pickers-firewall-selfblock-2026-07-17.md and in this page's own SSR
// path; the builder's market call was missed then.
//
// readMarketState never throws: a Redis miss degrades to empty rankings and
// the universe falls back to readDynamicUniverse() + PRESET_UNIVERSE below,
// rather than taking the page down.
async function fetchMarket(_origin: string, _forceFresh = false): Promise<MarketPayload> {
  return readMarketState();
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
  params.set(
    "tf",
    timeframe === "ST" ? "D" : timeframe === "M" ? "W" : timeframe
  );

  return `/?${params.toString()}`;
}

function toPlayItem(
  symbol: string,
  result: BullFlagResult,
  sourcePoints: Point[],
  itemTimeframe?: "M" | "ST" | "D" | "W"
): PlayItem {
  const displayTimeframe = itemTimeframe ?? result.timeframe;

  const chartBars =
    displayTimeframe === "M"
      ? Math.min(260, Math.max(90, result.flagBars + result.poleBars + 18))
      : displayTimeframe === "W"
        ? Math.min(220, Math.max(52, result.flagBars + result.poleBars + 10))
        : displayTimeframe === "D"
          ? Math.min(360, Math.max(120, result.flagBars + result.poleBars + 35))
          : Math.min(180, Math.max(45, result.flagBars + result.poleBars + 18));

  const chartPoints = sourcePoints
    .slice(-chartBars)
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
        typeof point.low === "number" ? Number(point.low.toFixed(2)) : undefined,
      volume:
        typeof point.volume === "number" && Number.isFinite(point.volume)
          ? point.volume
          : undefined,
    }))
    .filter((point) => point.date && Number.isFinite(point.close));

  return {
    symbol,
    play: "bullFlag",
    timeframe: displayTimeframe,
    score: result.score,
    tone: result.tone,
    note: result.note,

    poleStartPrice: result.poleStartPrice,
    poleHighPrice: result.poleHighPrice,
    latestClose: result.latestClose,

    poleGainPct: result.poleGainPct,
    flagRetracementPct: result.flagRetracementPct,
    distanceToBreakoutPct: result.distanceToBreakoutPct,

    flagHigh: result.flagHigh,
    flagLow: result.flagLow,
    flagBars: result.flagBars,
    poleBars: result.poleBars,
    flagDriftPct: result.flagDriftPct,

    flagUpperStartPrice: result.flagUpperStartPrice,
    flagUpperEndPrice: result.flagUpperEndPrice,
    flagLowerStartPrice: result.flagLowerStartPrice,
    flagLowerEndPrice: result.flagLowerEndPrice,
    flagAngleDeg: result.flagAngleDeg,

    poleStartDate: result.poleStartDate,
    poleHighDate: result.poleHighDate,
    flagStartDate: result.flagStartDate,

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

function isMacroBullFlagCandidate(result: BullFlagResult) {
  const structureBars = result.flagBars + result.poleBars;

  const hasLargePole = result.poleGainPct >= 18;
  const hasEnoughDuration = structureBars >= 44;
  const hasHealthyFlag =
    result.flagRetracementPct >= 10 && result.flagRetracementPct <= 62;
  const hasMeaningfulFlag = result.flagBars >= 8;

  return hasLargePole && hasEnoughDuration && hasHealthyFlag && hasMeaningfulFlag;
}

function toMacroBullFlagResult(result: BullFlagResult) {
  return {
    ...result,
    note: `Macro bull flag candidate: ${result.poleGainPct.toFixed(
      1
    )}% pole move, ${result.flagRetracementPct.toFixed(
      1
    )}% retracement, ${result.distanceToBreakoutPct.toFixed(
      1
    )}% below breakout area.`,
  };
}

function toShortTermBullFlagResult(result: BullFlagResult) {
  return {
    ...result,
    timeframe: "D" as const,
    note: `Short-term bull flag candidate: ${result.poleGainPct.toFixed(
      1
    )}% pole move, ${result.flagRetracementPct.toFixed(
      1
    )}% retracement, ${result.distanceToBreakoutPct.toFixed(
      1
    )}% below breakout area.`,
  };
}

function scoreResultForTimeframe(
  result: BullFlagResult,
  timeframe: "M" | "ST" | "D" | "W"
) {
  const structureBars = result.flagBars + result.poleBars;

  const wideFlagBonus =
    timeframe === "D"
      ? Math.min(18, Math.max(0, result.flagBars - 18) * 0.45)
      : timeframe === "M"
        ? Math.min(12, Math.max(0, structureBars - 44) * 0.35)
        : timeframe === "W"
          ? Math.min(10, Math.max(0, result.flagBars - 10) * 0.35)
          : 0;

  return result.score + wideFlagBonus;
}

function bestFlagForWindows(
  points: Point[],
  timeframe: "M" | "ST" | "D" | "W",
  windows: number[]
): BullFlagResult | null {
  const detectorTimeframe = timeframe === "M" || timeframe === "W" ? "W" : "D";

  const minPoleGainPct =
    timeframe === "M" ? 18 : timeframe === "W" ? 12 : timeframe === "ST" ? 7 : 10;

  const minFlagBars =
    timeframe === "M" ? 8 : timeframe === "W" ? 6 : timeframe === "ST" ? 4 : 18;

  const maxFlagBars =
    timeframe === "M" ? 70 : timeframe === "W" ? 52 : timeframe === "ST" ? 24 : 115;

  const maxFlagRetracementPct =
    timeframe === "M" ? 70 : timeframe === "W" ? 66 : timeframe === "ST" ? 52 : 72;

  const maxDistanceToBreakoutPct =
    timeframe === "M" ? 22 : timeframe === "W" ? 18 : timeframe === "ST" ? 9 : 16;

  const minStructureBars =
    timeframe === "M" ? 44 : timeframe === "W" ? 26 : timeframe === "D" ? 42 : 0;

  const results = windows
    .map((lookbackBars) =>
      detectBullFlag(points, {
        timeframe: detectorTimeframe,
        lookbackBars,
        minPoleGainPct,
        minFlagBars,
        maxFlagBars,
        maxFlagRetracementPct,
        maxDistanceToBreakoutPct,
      })
    )
    .filter((result): result is BullFlagResult => result !== null)
    .filter((result) => result.flagBars + result.poleBars >= minStructureBars)
    .map((result) => {
      if (timeframe === "M") return toMacroBullFlagResult(result);
      if (timeframe === "ST") return toShortTermBullFlagResult(result);
      return result;
    });

  if (!results.length) return null;

  return [...results].sort(
    (a, b) =>
      scoreResultForTimeframe(b, timeframe) - scoreResultForTimeframe(a, timeframe)
  )[0];
}

function debugFlagWindows(
  points: Point[],
  timeframe: "M" | "ST" | "D" | "W",
  windows: number[]
) {
  const detectorTimeframe = timeframe === "M" || timeframe === "W" ? "W" : "D";

  return windows.map((lookbackBars) => {
    const result = bestFlagForWindows(points, timeframe, [lookbackBars]);

    if (!result) {
      return {
        timeframe,
        detectorTimeframe,
        lookbackBars,
        passed: false,
        reason: "detector_returned_null",
      };
    }

    return {
      timeframe,
      detectorTimeframe,
      lookbackBars,
      passed: true,
      reason: "passed",
      result: {
        score: result.score,
        adjustedScore: scoreResultForTimeframe(result, timeframe),
        poleGainPct: result.poleGainPct,
        flagRetracementPct: result.flagRetracementPct,
        distanceToBreakoutPct: result.distanceToBreakoutPct,
        flagBars: result.flagBars,
        poleBars: result.poleBars,
        structureBars: result.flagBars + result.poleBars,
        flagHigh: result.flagHigh,
        flagLow: result.flagLow,
        flagAngleDeg: result.flagAngleDeg,
        flagUpperStartPrice: result.flagUpperStartPrice,
        flagUpperEndPrice: result.flagUpperEndPrice,
        flagLowerStartPrice: result.flagLowerStartPrice,
        flagLowerEndPrice: result.flagLowerEndPrice,
        startDate: result.startDate,
        endDate: result.endDate,
      },
    };
  });
}

function addDebugMatch(debugSymbolScan: any, match: string) {
  if (!debugSymbolScan) return;

  if (!Array.isArray(debugSymbolScan.matched)) {
    debugSymbolScan.matched = [];
  }

  debugSymbolScan.matched.push(match);
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
        matched: [],
        diagnostics: null,
      }
    : null;

  const macroBullFlags: PlayItem[] = [];
  const weeklyBullFlags: PlayItem[] = [];
  const dailyBullFlags: PlayItem[] = [];

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
              macro: debugFlagWindows(weeklyPoints, "M", [
                104,
                120,
                140,
                156,
                180,
                208,
                249,
              ]),
              weekly: debugFlagWindows(weeklyPoints, "W", [
                39,
                52,
                80,
                104,
                156,
                208,
              ]),
              daily: debugFlagWindows(dailyPoints, "D", [
                90,
                120,
                160,
                220,
                260,
                320,
              ]),
            };
          }

          const macroFlag = bestFlagForWindows(weeklyPoints, "M", [
            104,
            120,
            140,
            156,
            180,
            208,
            249,
          ]);

          if (macroFlag) {
            addDebugMatch(debugSymbolScan, "macro");

            macroBullFlags.push(
              toPlayItem(symbol, macroFlag, weeklyPoints, "M")
            );
          }

          const weeklyFlag = bestFlagForWindows(weeklyPoints, "W", [
            39,
            52,
            80,
            104,
            156,
            208,
          ]);

          if (weeklyFlag) {
            addDebugMatch(debugSymbolScan, "weekly");

            weeklyBullFlags.push(toPlayItem(symbol, weeklyFlag, weeklyPoints));

            if (!macroFlag && isMacroBullFlagCandidate(weeklyFlag)) {
              addDebugMatch(debugSymbolScan, "macro_from_weekly");

              macroBullFlags.push(
                toPlayItem(
                  symbol,
                  toMacroBullFlagResult(weeklyFlag),
                  weeklyPoints,
                  "M"
                )
              );
            }
          }

          const dailyFlag = bestFlagForWindows(dailyPoints, "D", [
            90,
            120,
            160,
            220,
            260,
            320,
          ]);

          if (dailyFlag) {
            addDebugMatch(debugSymbolScan, "daily");

            dailyBullFlags.push(toPlayItem(symbol, dailyFlag, dailyPoints));
          }
        } catch {
          // Skip bad symbols/data without failing the full plays page.
        }
      })
    )
  );

  const bestBullFlags = [
    ...macroBullFlags,
    ...weeklyBullFlags,
    ...dailyBullFlags,
  ];

  const sections = [
    buildSection({
      title: "Best Bull Flag Plays",
      description:
        "The strongest macro, weekly, daily, and short-term bull flag candidates, ranked by pole strength, flag quality, retracement, breakout proximity and structure age.",
      source: bestBullFlags,
      take: 24,
    }),
    buildSection({
      title: "Macro Bull Flag Plays",
      description:
        "Large bull flag continuation structures built from wider weekly chart history. These are slower-forming macro setups that may span many months.",
      source: macroBullFlags,
      take: 24,
    }),
    buildSection({
      title: "Weekly Bull Flag Plays",
      description:
        "Longer-term bull flag candidates built from weekly chart structure.",
      source: weeklyBullFlags,
      take: 24,
    }),
    buildSection({
      title: "Daily Bull Flag Plays",
      description:
        "Medium-term daily bull flag candidates where price is consolidating after a prior upward pole move.",
      source: dailyBullFlags,
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

export type BullFlagsDataOpts = {
  forceRefresh?: boolean;
  debugSymbol?: string | null;
  // Set by the page during prerender. See the cacheOnly branch below.
  cacheOnly?: boolean;
};

export type BullFlagsDataResult = {
  data: PlaysPayload;
  headers: Record<string, string>;
  status?: number;
};

// Shares the memo/Redis-cache/lock defined above with /api/bull-flags's
// GET handler (same module), so the public endpoint and SSR stay
// perfectly consistent. See module header comment.
export async function getBullFlagsData(
  origin: string,
  opts: BullFlagsDataOpts = {}
): Promise<BullFlagsDataResult> {
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

  // Read the cache but never trigger a build.
  //
  // These pages are prerendered now, and a full scan does not fit inside Next's
  // 60s per-page static-generation budget: measured, all three timed out on
  // three attempts each and FAILED THE BUILD outright against a cold cache.
  // Leaving that in place would mean a deploy that breaks whenever the cron has
  // not warmed Redis, which is a far worse failure than a stale page.
  //
  // Returning 503 rather than throwing is deliberate: the page already maps
  // `status >= 400` to a null payload, and the client fetches /api/plays on
  // mount regardless, so a miss degrades to the same shell a visitor would have
  // seen anyway rather than to an error. The scan still happens -- via the API
  // route and the warm cron -- just never inside a build.
  if (opts.cacheOnly) {
    // Say so out loud. A cacheOnly miss during prerender means the artefact for
    // this page ships without data until the next revalidate, and a silent
    // degradation is exactly the failure mode this project keeps re-learning
    // (see the three verification rules in
    // claude/picker-pages-isr-2026-08-20.md). In a build log this line is the
    // signal that the cron had not warmed Redis before the deploy.
    console.warn(
      "[bull-flags] cacheOnly miss -- prerendering without data; page will fill in on the next revalidate"
    );
    return {
      data: {} as PlaysPayload,
      headers: { "X-Bull-Flags-Cache": "miss-cache-only" },
      status: 503,
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
