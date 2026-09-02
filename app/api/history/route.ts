import { NextResponse } from "next/server";
import { getDailyHistory, type Point } from "../../../lib/server/historyCache";
import { isUnwantedBot } from "@/lib/botid-guard";
import { isActiveMarketWindow } from "@/lib/server/marketHours";

export const runtime = "nodejs";
export const revalidate = 900;

const ACTIVE_CACHE_SECONDS = 60 * 15;
const ACTIVE_STALE_SECONDS = 60 * 15;

const QUIET_CACHE_SECONDS = 60 * 60;
const QUIET_STALE_SECONDS = 60 * 60;

const ERROR_CACHE_SECONDS = 60;
const ERROR_STALE_SECONDS = 300;

// This route used to carry its own copy of getEasternParts/isActiveMarketWindow
// -- the same Intl derivation, the same weekend rule, and the window written
// out as `8 * 60 + 30` to `17 * 60`. That is exactly REGULAR_OPEN_MINUTES_ET
// minus PRE_OPEN_BUFFER_MINUTES to REGULAR_CLOSE_MINUTES_ET plus
// POST_CLOSE_BUFFER_MINUTES, so the numbers agreed by coincidence of authorship
// and nothing would have noticed if one drifted. Now warm-price-pool gates on
// the same predicate (lib/server/marketHours.ts), two copies would be two
// answers to "is the market open" -- the shape of
// claude/traps/two-validators-for-one-value.md.

type Interval = "d" | "w" | "m";

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

  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

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
