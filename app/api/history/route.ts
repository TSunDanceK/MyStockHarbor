import { NextResponse } from "next/server";

export const runtime = "edge";

const ACTIVE_CACHE_SECONDS = 3600; // 1 hour during market activity
const ACTIVE_STALE_SECONDS = 7200; // 2 hours stale while revalidating

const QUIET_CACHE_SECONDS = 60 * 60 * 14; // 14 hours outside active market window
const QUIET_STALE_SECONDS = 60 * 60 * 6; // 6 extra stale hours



type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

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

function isActiveMarketWindow(date = new Date()) {
  const { weekday, hour, minute } = getEasternParts(date);

  if (weekday === "Sat" || weekday === "Sun") return false;

  const totalMinutes = hour * 60 + minute;

  // 8:30 AM to 5:00 PM Eastern
  const start = 8 * 60 + 30;
  const end = 17 * 60;

  return totalMinutes >= start && totalMinutes <= end;
}

function getCacheControlHeader() {
  const isActive = isActiveMarketWindow();

  if (isActive) {
    return `public, s-maxage=${ACTIVE_CACHE_SECONDS}, stale-while-revalidate=${ACTIVE_STALE_SECONDS}`;
  }

  return `public, s-maxage=${QUIET_CACHE_SECONDS}, stale-while-revalidate=${QUIET_STALE_SECONDS}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();
  const days = Math.max(30, Math.min(5000, Number(searchParams.get("days") || "365")));

  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;

  try {
   const res = await fetch(url);
    const text = await res.text();

    const lines = text.trim().split("\n");
   if (lines.length < 3)
  return NextResponse.json(
    { symbol, points: [] as Point[] },
    {
      headers: {
        "Cache-Control": getCacheControlHeader(),
      },
    }
  );

    const points: Point[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const date = String(cols[0] ?? "").replace("\r", "");

      // Date,Open,High,Low,Close,Volume
      const high = Number(String(cols[2] ?? "").replace("\r", ""));
      const low = Number(String(cols[3] ?? "").replace("\r", ""));
      const close = Number(String(cols[4] ?? "").replace("\r", ""));
      const volume = Number(String(cols[5] ?? "").replace("\r", ""));

      if (!date || !Number.isFinite(close)) continue;

      points.push({
        date,
        close,
        high: Number.isFinite(high) ? high : undefined,
        low: Number.isFinite(low) ? low : undefined,
        volume: Number.isFinite(volume) ? volume : undefined,
      });
    }

     return NextResponse.json(
      { symbol, points: points.slice(-days) },
      {
        headers: {
          "Cache-Control": getCacheControlHeader(),
        },
      }
    );
  } catch {
      return NextResponse.json(
      { symbol, points: [] as Point[] },
      {
        headers: {
          "Cache-Control": getCacheControlHeader(),
        },
      }
    );
  }
}
