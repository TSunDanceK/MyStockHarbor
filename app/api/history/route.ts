import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

const redis = Redis.fromEnv();

const ACTIVE_CACHE_SECONDS = 3600;
const ACTIVE_STALE_SECONDS = 7200;

const QUIET_CACHE_SECONDS = 60 * 60 * 14;
const QUIET_STALE_SECONDS = 60 * 60 * 6;

const REDIS_HISTORY_PREFIX = "msh:history:v1";
const REDIS_HISTORY_TTL_SECONDS = 6 * 60 * 60;
const MIN_QUALIFIED_POINTS = 30;

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type Interval = "d" | "w" | "m";

type HistoryCacheEntry = {
  symbol: string;
  status: "qualified" | "non_qualified";
  checkedAt: number;
  source: "stooq";
  daily?: Point[];
};

function getEasternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return { weekday, year, month, day, hour, minute };
}

function isWeekendEastern(weekday: string) {
  return weekday === "Sat" || weekday === "Sun";
}

function isActiveMarketWindow(date = new Date()) {
  const { weekday, hour, minute } = getEasternParts(date);

  if (isWeekendEastern(weekday)) return false;

  const totalMinutes = hour * 60 + minute;
  const start = 8 * 60 + 30;
  const end = 17 * 60;

  return totalMinutes >= start && totalMinutes <= end;
}

function getCacheControlHeader() {
  if (isActiveMarketWindow()) {
    return `public, s-maxage=${ACTIVE_CACHE_SECONDS}, stale-while-revalidate=${ACTIVE_STALE_SECONDS}`;
  }

  return `public, s-maxage=${QUIET_CACHE_SECONDS}, stale-while-revalidate=${QUIET_STALE_SECONDS}`;
}

function parseInterval(value: string | null): Interval {
  if (value === "w") return "w";
  if (value === "m") return "m";
  return "d";
}

function startOfWeekUtc(dateStr: string) {
  const dt = new Date(dateStr);
  const weekday = dt.getUTCDay();
  const diff = weekday === 0 ? 6 : weekday - 1;
  dt.setUTCDate(dt.getUTCDate() - diff);

  return dt.toISOString().slice(0, 10);
}

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7);
}

function aggregate(points: Point[], interval: Interval) {
  if (interval === "d") return points;

  const out: Point[] = [];
  let current: Point | null = null;
  let currentKey = "";

  for (const p of points) {
    const key = interval === "w" ? startOfWeekUtc(p.date) : monthKey(p.date);

    if (!current || key !== currentKey) {
      if (current) out.push(current);

      currentKey = key;
      current = { ...p };
      continue;
    }

    current.close = p.close;
    current.date = p.date;

    if (p.high !== undefined) {
      current.high = Math.max(current.high ?? p.high, p.high);
    }

    if (p.low !== undefined) {
      current.low = Math.min(current.low ?? p.low, p.low);
    }

    if (p.volume !== undefined) {
      current.volume = (current.volume ?? 0) + p.volume;
    }
  }

  if (current) out.push(current);

  return out;
}

function getHistoryRedisKey(symbol: string) {
  return `${REDIS_HISTORY_PREFIX}:${symbol}`;
}

function getNextMondayOpenUtcMsFromEastern(date = new Date()) {
  const { weekday, year, month, day } = getEasternParts(date);

  const weekdayIndex =
    weekday === "Sun" ? 0 :
    weekday === "Mon" ? 1 :
    weekday === "Tue" ? 2 :
    weekday === "Wed" ? 3 :
    weekday === "Thu" ? 4 :
    weekday === "Fri" ? 5 :
    weekday === "Sat" ? 6 :
    0;

  const jsDate = new Date(Date.UTC(year, month - 1, day));
  const daysUntilMonday =
    weekdayIndex === 0 ? 1 :
    weekdayIndex === 6 ? 2 :
    weekdayIndex === 5 ? 3 :
    0;

  jsDate.setUTCDate(jsDate.getUTCDate() + daysUntilMonday);

  const mondayYear = jsDate.getUTCFullYear();
  const mondayMonth = String(jsDate.getUTCMonth() + 1).padStart(2, "0");
  const mondayDay = String(jsDate.getUTCDate()).padStart(2, "0");

  const easternOpen = `${mondayYear}-${mondayMonth}-${mondayDay}T09:30:00-05:00`;
  return new Date(easternOpen).getTime();
}

function getRedisTtlSeconds(now = new Date()) {
  const { weekday, hour, minute } = getEasternParts(now);
  const totalMinutes = hour * 60 + minute;
  const fridayCloseMinutes = 16 * 60;

  const isFridayAfterClose = weekday === "Fri" && totalMinutes >= fridayCloseMinutes;
  const isWeekend = weekday === "Sat" || weekday === "Sun";

  if (isFridayAfterClose || isWeekend) {
    const mondayOpenUtcMs = getNextMondayOpenUtcMsFromEastern(now);
    const diffSeconds = Math.ceil((mondayOpenUtcMs - now.getTime()) / 1000);
    return Math.max(60, diffSeconds);
  }

  return REDIS_HISTORY_TTL_SECONDS;
}

function parseStooqDailyCsv(text: string) {
  const lines = text.trim().split("\n");
  if (lines.length < 3) return [] as Point[];

  const daily: Point[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");

    const date = cols[0];
    const high = Number(cols[2]);
    const low = Number(cols[3]);
    const close = Number(cols[4]);
    const volume = Number(cols[5]);

    if (!date || !Number.isFinite(close)) continue;

    daily.push({
      date,
      close,
      high: Number.isFinite(high) ? high : undefined,
      low: Number.isFinite(low) ? low : undefined,
      volume: Number.isFinite(volume) ? volume : undefined,
    });
  }

  return daily;
}

async function readHistoryEntry(symbol: string) {
  try {
    const entry = await redis.get<HistoryCacheEntry>(getHistoryRedisKey(symbol));

    if (!entry || typeof entry !== "object") return null;
    if (entry.symbol !== symbol) return null;
    if (entry.status !== "qualified" && entry.status !== "non_qualified") return null;

    return entry;
  } catch {
    return null;
  }
}

async function writeHistoryEntry(symbol: string, entry: HistoryCacheEntry) {
  try {
    await redis.set(getHistoryRedisKey(symbol), entry, {
      ex: getRedisTtlSeconds(),
    });
  } catch {
    // fail open
  }
}

async function fetchAndCacheDailyHistory(symbol: string) {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    const daily = parseStooqDailyCsv(text);

    if (daily.length >= MIN_QUALIFIED_POINTS) {
      const entry: HistoryCacheEntry = {
        symbol,
        status: "qualified",
        checkedAt: Date.now(),
        source: "stooq",
        daily,
      };

      await writeHistoryEntry(symbol, entry);
      return entry;
    }

    const entry: HistoryCacheEntry = {
      symbol,
      status: "non_qualified",
      checkedAt: Date.now(),
      source: "stooq",
    };

    await writeHistoryEntry(symbol, entry);
    return entry;
  } catch {
    const entry: HistoryCacheEntry = {
      symbol,
      status: "non_qualified",
      checkedAt: Date.now(),
      source: "stooq",
    };

    await writeHistoryEntry(symbol, entry);
    return entry;
  }
}

async function getDailyHistory(symbol: string) {
  const cached = await readHistoryEntry(symbol);

  if (cached) {
    if (cached.status === "qualified" && Array.isArray(cached.daily)) {
      return cached.daily;
    }

    return [] as Point[];
  }

  const fresh = await fetchAndCacheDailyHistory(symbol);

  if (fresh.status === "qualified" && Array.isArray(fresh.daily)) {
    return fresh.daily;
  }

  return [] as Point[];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();
  const days = Math.max(30, Math.min(5000, Number(searchParams.get("days") || "365")));
  const interval = parseInterval(searchParams.get("interval"));

  try {
    const daily = await getDailyHistory(symbol);
    const points = aggregate(daily, interval);

    return NextResponse.json(
      {
        symbol,
        interval,
        points: points.slice(-days),
      },
      {
        headers: {
          "Cache-Control": getCacheControlHeader(),
        },
      }
    );
  } catch {
    return NextResponse.json(
      { symbol, interval, points: [] as Point[] },
      {
        headers: {
          "Cache-Control": getCacheControlHeader(),
        },
      }
    );
  }
}
