import { cryptoHidden } from "@/lib/cryptoMode";
import { NextResponse } from "next/server";
import { getDailyHistory, type Point } from "../../../lib/server/historyCache";
import { isUnwantedBot } from "@/lib/botid-guard";
import { isActiveMarketWindow } from "@/lib/server/marketHours";
import {
  carryPartialLabel,
  historyForSurface,
  historyOnTiingo,
  historyRequestSameOrigin,
  TIINGO_HISTORY_CACHE_CONTROL,
  tiingoHistoryDays,
} from "@/lib/server/tiingoHistory";

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

  // Crypto mode hidden 2026-09-27 (lib/cryptoMode.ts, #553 COWORK #62): a
  // crypto pair is "not available", answered before any bot check or FMP call.
  if (cryptoHidden(symbol)) {
    return NextResponse.json({ symbol, error: "not available" }, { status: 404 });
  }
  // #553 COWORK #103: on the Tiingo path the bars are not public JSON. No
  // shared cache, `days` capped at what the charts ask for, same-origin only
  // (lib/server/tiingoHistory.ts). The FMP path below is exactly as it was.
  const onTiingo = historyOnTiingo("HISTORY");
  const days = onTiingo
    ? tiingoHistoryDays(searchParams.get("days"))
    : Math.max(30, Math.min(5000, Number(searchParams.get("days") || "365")));
  const interval = parseInterval(searchParams.get("interval"));

  if (onTiingo && !historyRequestSameOrigin(req.headers).ok) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403, headers: { "Cache-Control": TIINGO_HISTORY_CACHE_CONTROL } }
    );
  }

  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    // STEP 3 (#553 COWORK #71 row 3), behind PRICE_PROVIDER_HISTORY: the
    // nightly Tiingo bars from the Data Cache plus today's labelled partial bar,
    // then the SAME d/w/m roll-up and the same {symbol, interval, points}
    // shape. A Tiingo miss keeps this exact FMP read (lib/server/tiingoHistory.ts).
    //
    // COWORK #72 LIMITS, HELD AS THEY ARE (scripts/check-tiingo-step3.mjs):
    // BotID above stays; still /api/ (robots-disallowed); no CORS header; no
    // download/CSV; no new route. "Historical price charts" through our own
    // same-origin route is display, not export.
    const { points: daily, provider } = await historyForSurface("HISTORY", symbol, () =>
      getDailyHistory(symbol, { caller: "api-history" })
    );
    const points = carryPartialLabel(daily, aggregate(daily, interval));

    return NextResponse.json(
      {
        symbol,
        interval,
        points: points.slice(-days),
        // Whose bars these are, so the chart credits Tiingo only beside Tiingo's
        // (a Tiingo miss falls back to FMP). Tiingo path only: the FMP body is unchanged.
        ...(onTiingo ? { provider } : {}),
      },
      {
        headers: {
          "Cache-Control": onTiingo ? TIINGO_HISTORY_CACHE_CONTROL : getCacheControlHeader(),
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
          "Cache-Control": onTiingo ? TIINGO_HISTORY_CACHE_CONTROL : getErrorCacheControlHeader(),
        },
      }
    );
  }
}
