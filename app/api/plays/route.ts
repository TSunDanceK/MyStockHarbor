// app/api/plays/route.ts
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  detectAscendingTriangle,
  type AscendingTriangleResult,
} from "../../../lib/ta/ascendingTriangle";
import { getDailyHistory } from "../../../lib/server/historyCache";

import {
  addToDynamicUniverse,
  readDynamicUniverse,
} from "../../../lib/server/dynamicUniverseCache";

type Point = {
  date: string;
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
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type PlayItem = {
  symbol: string;
  play: "ascendingTriangle";
  timeframe: "D" | "W";
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

type PlaysPayload = {
  updatedAt: string;
  universeSize: number;
  dynamicUniverseCount: number;
  dynamicUniversePreview: string[];
  estimatedApiCalls: number;
  sections: PlaySection[];
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

const UNIVERSE_CAP = 200;
const HISTORY_DAYS = 1300;

let memo:
  | {
      ts: number;
      data: PlaysPayload;
    }
  | null = null;

const MEMORY_CACHE_MS = 60_000;
const CACHE_SECONDS = 60 * 6;
const STALE_SECONDS = 60 * 6;

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
      close: Number(p?.close),
      high: p?.high == null ? undefined : Number(p.high),
      low: p?.low == null ? undefined : Number(p.low),
      volume: p?.volume == null ? undefined : Number(p.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close))
    .slice(-days);
}

function buildDashboardHref(symbol: string, timeframe: "D" | "W") {
  const params = new URLSearchParams();
  params.set("symbol", symbol);
  params.set("tf", timeframe);

  return `/?${params.toString()}`;
}

function toPlayItem(
  symbol: string,
  result: AscendingTriangleResult,
  sourcePoints: Point[]
): PlayItem {
  const chartBars = result.timeframe === "W" ? 52 : 90;

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
    timeframe: result.timeframe,
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

    dashboardHref: buildDashboardHref(symbol, result.timeframe),
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

async function buildPlaysPayload(
  origin: string,
  forceFreshMarket = false
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

  const rankedDynamicUniverse = Array.from(
    new Set([...topTraded, ...topMovers, ...topRanges])
  );

  const sharedUniverseEntries = await readDynamicUniverse();

  const sharedUniverseSymbols = sharedUniverseEntries.map(
    (entry) => entry.symbol
  );

  const dynamicUniverse = Array.from(
    new Set(
      [
        ...sharedUniverseSymbols,
        ...accumulatedDynamicUniverse,
        ...rankedDynamicUniverse,
      ]
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
    )
  );

    await addToDynamicUniverse(
    [...accumulatedDynamicUniverse, ...rankedDynamicUniverse],
    "market",
    1
  );

  const universe = Array.from(
    new Set(
      [...dynamicUniverse, ...PRESET_UNIVERSE]
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
    )
  ).slice(0, UNIVERSE_CAP);

  const weeklyAscendingTriangles: PlayItem[] = [];
  const dailyAscendingTriangles: PlayItem[] = [];

  const limit = pLimit(10);

  await Promise.all(
    universe.map((symbol) =>
      limit(async () => {
        try {
          const dailyPoints = await fetchHistory(symbol, HISTORY_DAYS);
          if (dailyPoints.length < 80) return;

          const weeklyPoints = aggregateWeekly(dailyPoints);

          const weeklyTriangle = detectAscendingTriangle(weeklyPoints, {
            timeframe: "W",
          });

          if (weeklyTriangle) {
            weeklyAscendingTriangles.push(
              toPlayItem(symbol, weeklyTriangle, weeklyPoints)
            );
          }

          const dailyTriangle = detectAscendingTriangle(dailyPoints, {
            timeframe: "D",
          });

          if (dailyTriangle) {
            dailyAscendingTriangles.push(
              toPlayItem(symbol, dailyTriangle, dailyPoints)
            );
          }
        } catch {
          // Skip bad symbols/data without failing the full plays page.
        }
      })
    )
  );

  const bestAscendingTriangles = [
    ...weeklyAscendingTriangles,
    ...dailyAscendingTriangles,
  ];


  const sections = [
    buildSection({
      title: "Best Ascending Triangle Plays",
      description:
        "The strongest daily and weekly ascending triangle candidates, ranked by resistance quality, rising lows, breakout proximity and structure age.",
      source: bestAscendingTriangles,
      take: 24,
    }),
    buildSection({
      title: "Weekly Ascending Triangle Plays",
      description:
        "Longer-term ascending triangle candidates built from weekly chart structure.",
      source: weeklyAscendingTriangles,
      take: 24,
    }),
    buildSection({
      title: "Daily Ascending Triangle Plays",
      description:
        "Daily ascending triangle candidates where price is pressing toward a defined resistance area.",
      source: dailyAscendingTriangles,
      take: 24,
    }),
  ];

  return {
    updatedAt: new Date().toISOString(),
    universeSize: universe.length,
    dynamicUniverseCount:
      typeof market?.dynamicUniverseSize === "number"
        ? market.dynamicUniverseSize
        : dynamicUniverse.length,
    dynamicUniversePreview: dynamicUniverse.slice(0, 20),
    estimatedApiCalls: universe.length + 1,
    sections,
  };
}

export async function GET(req: NextRequest) {
  const now = Date.now();
  const forceRefresh = req.nextUrl.searchParams.get("force") === "1";

  if (!forceRefresh && memo && now - memo.ts < MEMORY_CACHE_MS) {
    return NextResponse.json(memo.data, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  }

  try {
    const origin = originFromReq(req);
    const data = await buildPlaysPayload(origin, forceRefresh);

    memo = {
      ts: now,
      data,
    };

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": forceRefresh
          ? "no-store"
          : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown plays error";

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
  }
}
