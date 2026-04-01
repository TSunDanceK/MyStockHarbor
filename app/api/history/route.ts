import { NextResponse } from "next/server";
import { getDailyHistory, type Point } from "../../../lib/server/historyCache";

export const runtime = "nodejs";
export const revalidate = 900;

const ACTIVE_CACHE_SECONDS = 60 * 15;
const ACTIVE_STALE_SECONDS = 60 * 15;

const QUIET_CACHE_SECONDS = 60 * 60;
const QUIET_STALE_SECONDS = 60 * 60;

const ERROR_CACHE_SECONDS = 60;
const ERROR_STALE_SECONDS = 300;

type Interval = "d" | "w" | "m";

function getEasternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return { weekday, hour, minute };
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

function getErrorCacheControlHeader() {
  return `public, s-maxage=${ERROR_CACHE_SECONDS}, stale-while-revalidate=${ERROR_STALE_SECONDS}`;
}

function parseInterval(value: string | null): Interval {
  if (value === "w") return "w";
  if (value === "m") return "m";
  return "d";
}

function startOfWeekUtc(dateStr: string) {
  const dt = new Date(`${dateStr}T00:00:00Z`);
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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown history fetch error";

    return NextResponse.json(
      {
        symbol,
        interval,
        points: [] as Point[],
        error: message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": getErrorCacheControlHeader(),
        },
      }
    );
  }
}
