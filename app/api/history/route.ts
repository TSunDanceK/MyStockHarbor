import { NextResponse } from "next/server";

export const runtime = "edge";

const ACTIVE_CACHE_SECONDS = 3600;
const ACTIVE_STALE_SECONDS = 7200;

const QUIET_CACHE_SECONDS = 60 * 60 * 14;
const QUIET_STALE_SECONDS = 60 * 60 * 6;

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type Interval = "d" | "w" | "m";

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();
  const days = Math.max(30, Math.min(5000, Number(searchParams.get("days") || "365")));
  const interval = parseInterval(searchParams.get("interval"));

  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;

  try {
    const res = await fetch(url);
    const text = await res.text();

    const lines = text.trim().split("\n");
    if (lines.length < 3) {
      return NextResponse.json(
        { symbol, interval, points: [] as Point[] },
        { headers: { "Cache-Control": getCacheControlHeader() } }
      );
    }

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
