import { NextResponse } from "next/server";
import { type Point } from "../../../lib/server/historyCache";

export const runtime = "nodejs";

type Interval = "d" | "w" | "m";

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

function parseStooqDailyCsv(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return [] as Point[];

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [] as Point[];

  const header = lines[0].toLowerCase();
  if (!header.includes("date") || !header.includes("close")) {
    return [] as Point[];
  }

  const out: Point[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");

    const date = cols[0]?.trim();
    const high = Number(cols[2]);
    const low = Number(cols[3]);
    const close = Number(cols[4]);
    const volume = Number(cols[5]);

    if (!date || !Number.isFinite(close)) continue;

    out.push({
      date,
      close,
      high: Number.isFinite(high) ? high : undefined,
      low: Number.isFinite(low) ? low : undefined,
      volume: Number.isFinite(volume) ? volume : undefined,
    });
  }

  return out;
}

async function fetchDailyHistoryDirect(symbol: string) {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;

  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      accept: "text/csv,text/plain,text/html;q=0.9,*/*;q=0.8",
      "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
      referer: "https://stooq.com/",
    },
  });

  const contentType = res.headers.get("content-type") || "unknown";
  const finalUrl = res.url || url;
  const text = await res.text();
  const preview = text.slice(0, 500).replace(/\s+/g, " ").trim();

  if (!res.ok) {
    throw new Error(
      `Direct Stooq history request failed with status ${res.status}; content-type=${contentType}; final-url=${finalUrl}; preview=${preview}`
    );
  }

  const daily = parseStooqDailyCsv(text);

  if (daily.length > 0) {
    return daily;
  }

  throw new Error(
    `Stooq history response was not valid CSV data; content-type=${contentType}; final-url=${finalUrl}; preview=${preview}`
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();
  const days = Math.max(30, Math.min(5000, Number(searchParams.get("days") || "365")));
  const interval = parseInterval(searchParams.get("interval"));

  try {
    const daily = await fetchDailyHistoryDirect(symbol);
    const points = aggregate(daily, interval);

    return NextResponse.json(
      {
        symbol,
        interval,
        points: points.slice(-days),
        debugVersion: "history-route-debug-v3-direct-only",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown history fetch error";

    return Response.json(
      {
        symbol,
        interval,
        points: [] as Point[],
        error: message,
        debugType: typeof error,
        debugNow: new Date().toISOString(),
        debugVersion: "history-route-debug-v3-direct-only",
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
