// lib/server/pickersBuilder.ts
//
// Shared build logic for the pickers/signals payload, used by BOTH the
// user-facing /api/pickers route and the /api/jobs/warm-picker-universe
// cron-triggered warm-up job. Previously these were two separately
// maintained ~2,700-line copies that had already drifted (missing
// tickerFeed/weeklyMa200DistancePct/supportResistanceZone fields and an
// older macro support/resistance classification in the job copy, plus no
// degraded-build safety net there at all) — consolidated into this single
// module so the two entry points can never diverge again. See
// CACHING_REFRESH_ARCHITECTURE_PLAN.md (project doc) for the full context.

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { readMarketState } from "./marketState";
import { NextRequest, NextResponse } from "next/server";
import { detectDivergenceFromHistory } from "../ta/divergence";
import { getDailyHistoryBulk } from "./historyCache";
import {
  addToDynamicUniverse,
  readDynamicUniverse,
} from "./dynamicUniverseCache";
import { readSearchDemand } from "./searchDemand";
import { PRESET_UNIVERSE } from "./presetUniverse";
import {
  readPickerChartsBulk,
  writePickerChartsBulk,
  type StoredChartPoint,
} from "./pickerChartsCache";
import {
  getClientIp,
  checkBackfillLockout,
  recordBackfillFailure,
  clearBackfillFailures,
  checkBackfillKey,
} from "./backfillAuth";

type Point = {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
};

type PickerChartPoint = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
  ma50?: number;
  ma200?: number;
  rsi14?: number;
  macdHist?: number;
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

type PickerTone = "green" | "yellow" | "orange" | "red" | "blue";

type PickerSupportResistanceZone = {
  kind: "support" | "resistance";
  lower: number;
  upper: number;
};

type PickerItem = {
  symbol: string;
  note?: string;
  tone?: PickerTone;
  timeframe?: "D" | "W" | "M";
  indicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
  chartPoints?: PickerChartPoint[];
  score?: number;
  _score?: number;
  supportResistanceZone?: PickerSupportResistanceZone;
  chartFocus?: PickerChartFocus;
  dominantIndicator?: string;
  /** Every check that fired, strongest first. See CompositeResult. */
  firedIndicators?: string[];
  epsGrowthPct?: number | null;
  revenueGrowthPct?: number | null;
  releaseDate?: string | null;
};

type PickerSection = {
  title: string;
  description?: string;
  foundCount?: number;
  shownCount?: number;
  items: {
    symbol: string;
    note?: string;
    tone?: PickerTone;
    timeframe?: "D" | "W" | "M";
    indicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
    dashboardHref?: string;
    chartPoints?: PickerChartPoint[];
    score?: number;
    supportResistanceZone?: PickerSupportResistanceZone;
    chartFocus?: PickerChartFocus;
    dominantIndicator?: string;
    /** Every check that fired, strongest first. See CompositeResult. */
    firedIndicators?: string[];
  }[];
};

type CompositeResult = {
  total: number;
  flagged: number;
  overbought: number;
  oversold: number;
  spikes: number;
  tone: PickerTone;
  tag: string;
  dominantOversoldIndicator?: string;
  dominantOverboughtIndicator?: string;
  // Which checks actually fired, strongest first. buildCompositeFromHistory has
  // always computed these (the *Ratios arrays below), then discarded all but
  // the single dominant label at its return statement -- so the screener could
  // say "3 oversold" but never which three, and a reader had no way to know
  // whether RSI was one of them.
  oversoldIndicators?: string[];
  overboughtIndicators?: string[];
};

type SignalRecord = {
  symbol: string;
  note?: string;
  tone?: PickerTone;

  oversold: boolean;
  overbought: boolean;
  buyTheDip: boolean;
  breakout: boolean;
  volumeSpike: boolean;
  atrSpike: boolean;
  aboveMA50: boolean;
  belowMA50: boolean;
  aboveMA200: boolean;
  belowMA200: boolean;
  dailyMa200Proximity: boolean;
  weeklyMa200Proximity: boolean;
  weeklyMa200DistancePct?: number;

  bullishRsiDivergence: boolean;
  bearishRsiDivergence: boolean;
  bullishMacdDivergence: boolean;
  bearishMacdDivergence: boolean;

  positiveLastEarnings: boolean;
  strongEarningsGrowth: boolean;

  preferredTimeframe?: "D" | "W" | "M";
  preferredIndicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
  chartPoints?: PickerChartPoint[];
  supportResistanceZone?: PickerSupportResistanceZone;
  dominantOversoldIndicator?: string;
  dominantOverboughtIndicator?: string;
  // EVERY check that fired, strongest first -- the full list behind the single
  // `dominant*` label above. Same arrays CompositeResult already carries.
  //
  // #330 added these to CompositeResult, OversoldCandidate, OverboughtCandidate
  // and takeTop's destructure, but not here. SignalRecord is the UNIVERSE path
  // -- every analyzed symbol -- while the section items are only each
  // category's top 20. So the Signals column populated for ~20 rows a page and
  // was blank for everything else, which reads as "these stocks have no
  // signals" rather than "this field never reached this path".
  //
  // Nothing new is computed for this: buildCompositeFromHistory already builds
  // both arrays for every symbol and they were discarded at this object
  // literal.
  oversoldIndicators?: string[];
  overboughtIndicators?: string[];
  // The four Best Trend checks, for the same reason the two lists above are
  // here: the Signals column on /best-trend-score-stocks is built from the
  // UNIVERSE path, not from the section's top 20, so a field that only reaches
  // the section item populates ~20 of 36 rows and leaves the rest dashed.
  //
  // Carried as the booleans rather than the derived label list so the label
  // vocabulary has exactly one home (trendIndicatorsFrom) and the page decides
  // WHICH list to show -- that selection is page context, and the builder does
  // not have it.
  trendChecks?: TrendChecks;

  isDynamicUniverse?: boolean;
  // True when this symbol earned its analyzed-universe slot from the Popular
  // Searches demand signal (real users repeatedly selecting it), rather than
  // from the preset mega-cap list or the day's market activity. Carried on the
  // payload so the All Stocks / pickers UI can badge or group these later.
  isPopularSearch?: boolean;
};

type TickerEarningsGrowthItem = {
  symbol: string;
  epsGrowthPct: number | null;
  revenueGrowthPct: number | null;
  releaseDate: string | null;
  tone: PickerTone;
};

type PickersPayload = {
  updatedAt: string;
  universeSize: number;
  dynamicUniverseCount: number;
  dynamicUniversePreview: string[];
  dynamicSymbols: string[];
  estimatedApiCalls: number;
  sections: PickerSection[];
  signalRecords: SignalRecord[];
  tickerFeed: {
    topMovers: MarketRow[];
    earningsGrowth: TickerEarningsGrowthItem[];
  };
  degradedSymbolCount?: number;
  degradedSymbolPct?: number;
};

type CachedPickersPayload = {
  cachedAt: number;
  data: PickersPayload;
};

/**
 * The four Best Trend checks as booleans, exactly as buildTrendScoreFromHistory
 * computed them.
 *
 * ONE OBJECT RATHER THAN FOUR OPTIONAL BOOLEANS, deliberately. Spread flat over
 * an optional-field record, "false" and "never computed" become the same
 * reading, and buildTrendScoreFromHistory genuinely returns null for a symbol
 * with under 220 closes. A nested object is present or absent, so the two stay
 * distinguishable (claude/traps/return-type-cannot-express-failure.md).
 */
export type TrendChecks = {
  priceAboveMA200: boolean;
  priceAboveMA50: boolean;
  ma50AboveMA200: boolean;
  macdBullish: boolean;
};

/**
 * The trend checks that actually fired, strongest first.
 *
 * WHY THIS EXISTS. "Best Trend Score Stocks" rendered `4/4 trend checks` and
 * nothing else: a bare count with no way to tell WHICH four, on a page whose
 * entire subject is which ones. That is the same shape as #330 -- the fired
 * detail is computed here for every symbol and was discarded at the object
 * literal -- reappearing on the one page #330 did not cover, because its
 * Signals column reads the composite's oversold/overbought lists and a trend
 * leader is normally neither, so every row showed a muted dash.
 *
 * Order matches the weights the score itself uses (18/18/12/12), so "strongest
 * first" means the same thing here as in the ranking above it.
 *
 * Returns undefined, never [], when nothing fired or nothing was computed --
 * the grid renders a dash for both, and an empty array would assert "measured,
 * found none" to any consumer that prints a count.
 */
export function trendIndicatorsFrom(checks: TrendChecks | null | undefined): string[] | undefined {
  if (!checks) return undefined;
  const out: string[] = [];
  if (checks.priceAboveMA200) out.push("Price > MA200");
  if (checks.ma50AboveMA200) out.push("MA50 > MA200");
  if (checks.priceAboveMA50) out.push("Price > MA50");
  if (checks.macdBullish) out.push("MACD(12,26,9) > 0");
  return out.length ? out : undefined;
}

type TrendScoreResult = {
  total: number;
  passed: number;
  priceAboveMA200: boolean;
  priceAboveMA50: boolean;
  ma50AboveMA200: boolean;
  macdBullish: boolean;
};

type Ma200Candidate = {
  pctDistance: number;
  timeframe: "D" | "W";
  score: number;
  deepUnderPct: number;
  abovePct: number;
  slopePct: number;
};

type OversoldCandidate = {
  score: number;
  note: string;
  dominantIndicator?: string;
  /** Every check that fired, strongest first. See CompositeResult. */
  firedIndicators?: string[];
};

type OverboughtCandidate = {
  score: number;
  note: string;
  dominantIndicator?: string;
  /** Every check that fired, strongest first. See CompositeResult. */
  firedIndicators?: string[];
};

type PickerChartFocus = {
  kind: "ath" | "rangeHigh";
  price: number;
  date: string;
};

type AthPullbackCandidate = {
  score: number;
  drawdownPct: number;
  avgDollarVolume: number;
  athPrice: number;
  athDate: string;
};

type BreakoutCandidate = {
  score: number;
  breakoutPct: number;
  breakoutBarsAgo: number;
  avgDollarVolume: number;
  highPrice: number;
  highDate: string;
};

type MacroSupportResistanceCandidate = {
  score: number;
  kind: "support" | "resistance";
  zoneLow: number;
  zoneHigh: number;
  level: number;
  touches: number;
  distancePct: number;
  zonePct: number;
  spanWeeks: number;
  volumeRatio: number;
  tone: PickerTone;
  note: string;
};

type EarningsRow = {
  symbol?: string;
  date?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string;
};

type EarningsCandidate = {
  score: number;
  note: string;
  tone: PickerTone;
  epsGrowthPct?: number | null;
  revenueGrowthPct?: number | null;
  releaseDate?: string | null;
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/* ----------------------------- caching ------------------------------ */

let memo:
  | {
      ts: number;
      data: PickersPayload;
    }
  | null = null;

const CACHE_SECONDS = 60 * 60; // 60 minutes
const STALE_SECONDS = 60 * 60; // 60 minutes
const MEMORY_CACHE_MS = 60_000;

// v9: the cached payload no longer carries signalRecords[].chartPoints inline --
// they live in msh:picker-charts:v1 and are re-attached on read (see
// writePickersCache/readPickersCache and lib/server/pickerChartsCache.ts).
//
// The version bump is REQUIRED, not cosmetic. Preview deployments share this
// project's Upstash credentials, so preview and production read and write the
// SAME key. Without a bump, merely loading a picker page on this branch's
// preview would build a stripped payload and SET it over the shared v8 entry --
// and production, still running code that can't re-attach, would then serve
// every page with no chartPoints at all: blank 200 MA column site-wide, dead
// EOD price/volume fallback, "Chart preview unavailable" on every card, until
// the 1h TTL expired. Bumping the key isolates the two shapes completely.
//
// Cost of the bump on merge: one cold rebuild on the first request after
// deploy (the build lock keeps that to a single rebuild, and per-symbol history
// is still Redis-cached, so it is the same cost as any post-TTL rebuild).
const PICKERS_REDIS_KEY = "msh:pickers:v9:charts-off-payload";
const PICKERS_REDIS_TTL_SECONDS = 60 * 60;
const PICKERS_LOCK_KEY = "msh:pickers:v8:macro-sr-cache:lock";
const PICKERS_LOCK_TTL_SECONDS = 120;

// If more than this fraction of the universe fails to fetch history during a
// build, the resulting payload is considered degraded (e.g. an ATH-breakout
// style section can legitimately drop to zero even though real matches
// exist, simply because the symbols that would have qualified failed to
// fetch). In that case we prefer serving the last known-good cache instead
// of publishing a thin payload as if it were complete.
const DEGRADED_BUILD_FAILURE_RATIO = 0.15;

const EARNINGS_REDIS_KEY_PREFIX = "msh:pickers:earnings:v1:";
const EARNINGS_QUEUE_KEY = "msh:pickers:earnings:v1:queue";
const EARNINGS_DUE_KEY_PREFIX = "msh:pickers:earnings:v1:due:";
const EARNINGS_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const EARNINGS_WARMUP_DELAY_MS = 70_000;

/* ------------------------ small util helpers ------------------------ */

function originFromReq(req: NextRequest) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
}

function lastNum(arr: Array<number | null>) {
  return arr.length ? arr[arr.length - 1] : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function pctChange(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return 0;
  return ((to - from) / from) * 100;
}

function buildPickerChartPoints(points: Point[], bars = 72): PickerChartPoint[] {
  const clean = points.filter((point) => point?.date && Number.isFinite(point.close));
  const closes = clean.map((point) => point.close);
  const ma50Arr = movingAverage(closes, 50);
  const ma200Arr = movingAverage(closes, 200);
  const rsiArr = rsiWilder(closes, 14);
  const macdArr = macd(closes, 12, 26, 9);
  const start = Math.max(0, clean.length - bars);

  return clean
    .slice(start)
    .map((point, localIndex) => {
      const index = start + localIndex;
      const previous = clean[index - 1];
      const fallbackOpen = previous?.close ?? point.close;
      const ma50 = ma50Arr[index];
      const ma200 = ma200Arr[index];
      const rsi14 = rsiArr[index];
      const macdHist = macdArr.hist[index];

      return {
        date: point.date,
        open:
          typeof point.open === "number" && Number.isFinite(point.open)
            ? Number(point.open.toFixed(2))
            : Number(fallbackOpen.toFixed(2)),
        close: Number(point.close.toFixed(2)),
        high:
          typeof point.high === "number" && Number.isFinite(point.high)
            ? Number(point.high.toFixed(2))
            : undefined,
        low:
          typeof point.low === "number" && Number.isFinite(point.low)
            ? Number(point.low.toFixed(2))
            : undefined,
        volume:
          typeof point.volume === "number" && Number.isFinite(point.volume)
            ? point.volume
            : undefined,
        ma50:
          typeof ma50 === "number" && Number.isFinite(ma50)
            ? Number(ma50.toFixed(2))
            : undefined,
        ma200:
          typeof ma200 === "number" && Number.isFinite(ma200)
            ? Number(ma200.toFixed(2))
            : undefined,
        rsi14:
          typeof rsi14 === "number" && Number.isFinite(rsi14)
            ? Number(rsi14.toFixed(2))
            : undefined,
        macdHist:
          typeof macdHist === "number" && Number.isFinite(macdHist)
            ? Number(macdHist.toFixed(4))
            : undefined,
      };
    });
}

function buildDashboardHref(args: {
  symbol: string;
  timeframe?: "D" | "W" | "M";
  indicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
}) {
  const params = new URLSearchParams();
  params.set("symbol", args.symbol);

  if (args.timeframe) {
    params.set("tf", args.timeframe);
  }

  if (args.indicator) {
    params.set("indicator", args.indicator);
  }

  return `/?${params.toString()}`;
}

function scoreLinear(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function scoreInverse(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  return clamp(((max - value) / (max - min)) * 100, 0, 100);
}

function scoreTargetBand(value: number, idealMin: number, idealMax: number, hardMin: number, hardMax: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < hardMin || value > hardMax) return 0;
  if (value >= idealMin && value <= idealMax) return 100;

  if (value < idealMin) {
    return clamp(((value - hardMin) / (idealMin - hardMin)) * 100, 0, 100);
  }

  return clamp(((hardMax - value) / (hardMax - idealMax)) * 100, 0, 100);
}

function readPickersNotePercent(points: Point[], bars: number) {
  const slice = points.slice(-bars);
  return slice.length ? slice : points;
}

async function readPickersCache() {
  if (!redis) return null;

  try {
    const entry = await redis.get<CachedPickersPayload>(PICKERS_REDIS_KEY);
    if (!entry || typeof entry !== "object") return null;
    if (!entry.data || typeof entry.data !== "object") return null;

    // Re-attach the chart series that writePickersCache split out, so every
    // consumer sees the identical payload shape it saw before the series moved
    // off-payload. Records that still carry their own chartPoints are left
    // alone -- that's a cache entry written by a deploy predating this change,
    // and it must keep working through the rollout.
    const records = Array.isArray(entry.data.signalRecords) ? entry.data.signalRecords : [];
    const missing = records
      .filter((record) => !Array.isArray(record.chartPoints) || !record.chartPoints.length)
      .map((record) => record.symbol);

    if (missing.length) {
      const series = await readPickerChartsBulk(missing);
      if (series.size) {
        entry.data = {
          ...entry.data,
          signalRecords: records.map((record) => {
            if (Array.isArray(record.chartPoints) && record.chartPoints.length) return record;
            const points = series.get(record.symbol);
            return points ? { ...record, chartPoints: points as PickerChartPoint[] } : record;
          }),
        };
      }
    }

    return entry;
  } catch {
    return null;
  }
}

// Fallback payload for when the full write is rejected for exceeding
// Upstash's 10MB Max Request Size (see claude/chart-coverage-handover-2026-08-04.md).
// Mirrors the pre-dedup behaviour: chartPoints are kept only for symbols
// that appear in at least one section; every other signalRecords entry has
// chartPoints stripped. This is deliberately recomputed from `data` at
// write time rather than cached, since it's only ever needed on the rare
// oversized-payload path.
function buildReducedPickersPayload(data: PickersPayload): PickersPayload {
  const displayedSymbols = new Set(
    data.sections.flatMap((section) => section.items.map((item) => item.symbol))
  );

  return {
    ...data,
    signalRecords: data.signalRecords.map((record) =>
      displayedSymbols.has(record.symbol) ? record : { ...record, chartPoints: undefined }
    ),
  };
}

// Previously this caught-and-swallowed unconditionally, so an oversized
// value simply wasn't cached and every request silently fell back to a live
// FMP rebuild -- the worst failure mode available, and the one already in
// place. Now: try the full payload first; on failure (e.g. Upstash's 10MB
// Max Request Size), retry once with `reduced()` -- a smaller payload with
// chartPoints stripped outside sections -- and log which path was used so a
// truncated cache is visible in Vercel logs instead of silent.
// Split the payload into (payload without series, series keyed by symbol).
//
// ~85% of the payload's bytes are signalRecords[].chartPoints (measured
// 2026-08-06: 2.86MB of 3.38MB at a 260 universe), and that share grows
// linearly with the universe cap. Holding them in a separate chunked hash is
// what keeps every Redis request clear of Upstash's 10MB Max Request Size --
// see lib/server/pickerChartsCache.ts for the measurements.
//
// `data` is memoized and handed back to callers, so this MUST NOT mutate it --
// hence the shallow copies. Section items are deliberately left alone: only the
// two weekly sections (Weekly MA200 Proximity, Macro S/R) carry their own
// chartPoints, they're weekly-aggregated rather than a duplicate of the daily
// series, and 2 x 20 items is ~0.44MB -- well inside the budget.
function splitPickersPayload(data: PickersPayload): {
  stripped: PickersPayload;
  series: Map<string, StoredChartPoint[]>;
} {
  const series = new Map<string, StoredChartPoint[]>();

  const signalRecords = data.signalRecords.map((record) => {
    const points = record.chartPoints;
    if (!Array.isArray(points) || !points.length) return record;
    series.set(record.symbol, points as StoredChartPoint[]);
    return { ...record, chartPoints: undefined };
  });

  return { stripped: { ...data, signalRecords }, series };
}

async function writePickersCache(data: PickersPayload, reduced?: () => PickersPayload) {
  if (!redis) return;

  try {
    const { stripped, series } = splitPickersPayload(data);

    // Series first: if this partly fails the payload still writes, and the
    // affected symbols degrade to "Chart preview unavailable" exactly as an
    // un-warmed symbol does. The reverse order could cache a payload whose
    // series were never stored at all.
    const chartResult = await writePickerChartsBulk(series);
    if (!chartResult.ok) {
      console.warn(
        `[pickers] chart series partially written: ${chartResult.written}/${series.size} symbols, ` +
          `${chartResult.failedChunks}/${chartResult.chunks} chunks failed`
      );
    }

    const entry: CachedPickersPayload = {
      cachedAt: Date.now(),
      data: stripped,
    };

    await redis.set(PICKERS_REDIS_KEY, entry, {
      ex: PICKERS_REDIS_TTL_SECONDS,
    });
    return;
  } catch (error) {
    console.warn(
      "[pickers] full payload write failed",
      error instanceof Error ? error.message : error
    );
  }

  if (!reduced) return;

  try {
    const entry: CachedPickersPayload = {
      cachedAt: Date.now(),
      data: reduced(),
    };

    await redis.set(PICKERS_REDIS_KEY, entry, {
      ex: PICKERS_REDIS_TTL_SECONDS,
    });
    console.warn("[pickers] cached reduced payload (chartPoints stripped outside sections)");
  } catch {
    // fail open, as before
  }
}

async function acquirePickersLock() {
  if (!redis) return "no-redis";

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const result = await redis.set(PICKERS_LOCK_KEY, token, {
      nx: true,
      ex: PICKERS_LOCK_TTL_SECONDS,
    });

    if (result === "OK") return token;
    return null;
  } catch {
    return null;
  }
}

async function releasePickersLock(token: string | null) {
  if (!redis || !token || token === "no-redis") return;

  try {
    const current = await redis.get<string>(PICKERS_LOCK_KEY);
    if (current === token) {
      await redis.del(PICKERS_LOCK_KEY);
    }
  } catch {
    // fail open
  }
}

/** Strict SMA over nullable values: returns null if any null in window. */
function smaNullable(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (window <= 0) return out;

  for (let i = window - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - window + 1; j <= i; j++) {
      const v = values[j];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        ok = false;
        break;
      }
      sum += v;
    }
    out[i] = ok ? sum / window : null;
  }
  return out;
}


function normalizeEarningsRows(value: unknown, fallbackSymbol: string): EarningsRow[] {
  if (!Array.isArray(value)) return [];

  const cleanSymbol = fallbackSymbol.toUpperCase().replace(/[^A-Z0-9.-]/g, "");

  return value
    .map((item): EarningsRow => ({
      symbol: typeof item?.symbol === "string" ? item.symbol : cleanSymbol,
      date: typeof item?.date === "string" ? item.date : "",
      epsActual:
        typeof item?.epsActual === "number" && Number.isFinite(item.epsActual)
          ? item.epsActual
          : null,
      epsEstimated:
        typeof item?.epsEstimated === "number" &&
        Number.isFinite(item.epsEstimated)
          ? item.epsEstimated
          : null,
      revenueActual:
        typeof item?.revenueActual === "number" &&
        Number.isFinite(item.revenueActual)
          ? item.revenueActual
          : null,
      revenueEstimated:
        typeof item?.revenueEstimated === "number" &&
        Number.isFinite(item.revenueEstimated)
          ? item.revenueEstimated
          : null,
      lastUpdated: typeof item?.lastUpdated === "string" ? item.lastUpdated : "",
    }))
    .filter((item) => Boolean(item.date))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

// Batch version of the old per-symbol readCachedFmpEarnings(): reads the
// whole universe's cached earnings in a single pipelined Redis round-trip
// (via mget) instead of one individual REST call per symbol. For a
// 200-symbol universe this was ~200 separate Upstash calls; now it's 1.
async function readCachedFmpEarningsBulk(
  symbols: string[]
): Promise<Map<string, EarningsRow[]>> {
  const result = new Map<string, EarningsRow[]>();
  if (!redis) return result;

  const cleanSymbols = Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, ""))
        .filter(Boolean)
    )
  );
  if (!cleanSymbols.length) return result;

  try {
    const keys = cleanSymbols.map((symbol) => `${EARNINGS_REDIS_KEY_PREFIX}${symbol}`);
    const values = await redis.mget<EarningsRow[]>(...keys);

    cleanSymbols.forEach((symbol, i) => {
      result.set(symbol, normalizeEarningsRows(values[i], symbol));
    });
  } catch {
    // Best-effort; a missing entry just means "no cached earnings yet".
  }

  return result;
}

async function queueEarningsWarmupSymbols(symbols: string[]) {
  if (!redis) return;

  const now = Date.now();
  const dueAt = now + EARNINGS_WARMUP_DELAY_MS;
  const cleanSymbols = Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, ""))
        .filter(Boolean)
    )
  );

  if (!cleanSymbols.length) return;

  try {
    // Batch-read the cached-earnings flag + due timestamp for every symbol
    // in one pipelined round-trip instead of 2 separate Redis calls per
    // symbol (was up to ~400 individual REST calls for a 200-symbol
    // universe, just for this read phase).
    const readPipeline = redis.pipeline();
    for (const symbol of cleanSymbols) {
      readPipeline.get<EarningsRow[]>(`${EARNINGS_REDIS_KEY_PREFIX}${symbol}`);
      readPipeline.get<number>(`${EARNINGS_DUE_KEY_PREFIX}${symbol}`);
    }
    const readResults =
      await readPipeline.exec<Array<EarningsRow[] | number | null>>();

    const symbolsNeedingQueue: string[] = [];
    for (let i = 0; i < cleanSymbols.length; i++) {
      const cached = readResults[i * 2] as EarningsRow[] | null;
      const existingDue = readResults[i * 2 + 1] as number | null;

      if (Array.isArray(cached) && cached.length > 0) continue;
      if (typeof existingDue === "number" && existingDue > now) continue;

      symbolsNeedingQueue.push(cleanSymbols[i]);
    }

    if (!symbolsNeedingQueue.length) return;

    // Batch-write the queue additions + due timestamps in one more
    // pipelined round-trip instead of 2 separate Redis calls per symbol.
    const writePipeline = redis.pipeline();
    for (const symbol of symbolsNeedingQueue) {
      writePipeline.sadd(EARNINGS_QUEUE_KEY, symbol);
      writePipeline.set(`${EARNINGS_DUE_KEY_PREFIX}${symbol}`, dueAt, {
        ex: EARNINGS_CACHE_TTL_SECONDS,
      });
    }
    await writePipeline.exec();
  } catch {
    // Queueing is best-effort; picker results should still load.
  }
}

function selectLatestCompletedEarnings(rows: EarningsRow[]) {
  const now = Date.now();
  return rows.find((row) => {
    const dateMs = row.date ? new Date(row.date).getTime() : NaN;
    const hasActual = row.epsActual != null || row.revenueActual != null;
    return hasActual && (!Number.isFinite(dateMs) || dateMs <= now + 24 * 60 * 60 * 1000);
  }) ?? null;
}

function earningsSurprisePct(actual: number | null | undefined, estimate: number | null | undefined) {
  if (typeof actual !== "number" || !Number.isFinite(actual)) return null;
  if (typeof estimate !== "number" || !Number.isFinite(estimate)) return null;
  if (estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

function completedEarningsRows(rows: EarningsRow[]) {
  return rows.filter((row) => row.epsActual != null || row.revenueActual != null);
}

function computePositiveLastEarningsCandidate(rows: EarningsRow[]): EarningsCandidate | null {
  const latest = selectLatestCompletedEarnings(rows);
  if (!latest) return null;

  const epsSurprise = earningsSurprisePct(latest.epsActual, latest.epsEstimated);
  const revenueSurprise = earningsSurprisePct(latest.revenueActual, latest.revenueEstimated);
  const epsPositive = typeof latest.epsActual === "number" && latest.epsActual > 0;
  const revenuePositive = typeof latest.revenueActual === "number" && latest.revenueActual > 0;

  const epsScore = epsSurprise == null ? 0 : scoreLinear(epsSurprise, -5, 20) * 0.35;
  const revenueScore = revenueSurprise == null ? 0 : scoreLinear(revenueSurprise, -5, 15) * 0.35;
  const positiveScore = (epsPositive ? 10 : 0) + (revenuePositive ? 5 : 0);

  const dateMs = latest.date ? new Date(latest.date).getTime() : NaN;
  const ageDays = Number.isFinite(dateMs) ? (Date.now() - dateMs) / 86_400_000 : 999;
  const freshnessScore = scoreInverse(ageDays, 0, 180) * 0.10;

  const score = clamp(epsScore + revenueScore + positiveScore + freshnessScore, 0, 100);

  const hasGoodEarnings =
    (epsSurprise != null && epsSurprise > 0) ||
    (revenueSurprise != null && revenueSurprise > 0);

  if (!hasGoodEarnings || score < 45) return null;

  const tone: PickerTone = score >= 75 ? "green" : score >= 58 ? "yellow" : "orange";
  const epsText = epsSurprise == null ? "EPS surprise unavailable" : `EPS surprise ${epsSurprise >= 0 ? "+" : ""}${epsSurprise.toFixed(1)}%`;
  const revenueText = revenueSurprise == null ? "revenue surprise unavailable" : `revenue surprise ${revenueSurprise >= 0 ? "+" : ""}${revenueSurprise.toFixed(1)}%`;

  return {
    score,
    tone,
    note: `Latest earnings: ${epsText}; ${revenueText}.`,
  };
}

function findSameQuarterPreviousYear(row: EarningsRow, rows: EarningsRow[]) {
  if (!row.date) return null;
  const currentDate = new Date(row.date);
  if (!Number.isFinite(currentDate.getTime())) return null;

  const targetYear = currentDate.getUTCFullYear() - 1;
  const targetMonth = currentDate.getUTCMonth();

  return rows.find((candidate) => {
    if (!candidate.date || candidate.date === row.date) return false;
    const date = new Date(candidate.date);
    if (!Number.isFinite(date.getTime())) return false;
    return date.getUTCFullYear() === targetYear && Math.abs(date.getUTCMonth() - targetMonth) <= 1;
  }) ?? null;
}

function computeStrongEarningsGrowthCandidate(rows: EarningsRow[]): EarningsCandidate | null {
  const completed = completedEarningsRows(rows);
  const latest = selectLatestCompletedEarnings(rows);
  if (!latest || completed.length < 4) return null;

  const previousYear = findSameQuarterPreviousYear(latest, completed);
  if (!previousYear) return null;

  const epsGrowth =
    typeof latest.epsActual === "number" &&
    typeof previousYear.epsActual === "number" &&
    Number.isFinite(latest.epsActual) &&
    Number.isFinite(previousYear.epsActual) &&
    previousYear.epsActual !== 0
      ? ((latest.epsActual - previousYear.epsActual) / Math.abs(previousYear.epsActual)) * 100
      : null;

  const revenueGrowth =
    typeof latest.revenueActual === "number" &&
    typeof previousYear.revenueActual === "number" &&
    Number.isFinite(latest.revenueActual) &&
    Number.isFinite(previousYear.revenueActual) &&
    previousYear.revenueActual !== 0
      ? ((latest.revenueActual - previousYear.revenueActual) / Math.abs(previousYear.revenueActual)) * 100
      : null;

  const recent = completed.slice(0, 6);
  const positiveEpsCount = recent.filter((row) => typeof row.epsActual === "number" && row.epsActual > 0).length;
  const beatCount = recent.filter((row) => {
    const eps = earningsSurprisePct(row.epsActual, row.epsEstimated);
    const rev = earningsSurprisePct(row.revenueActual, row.revenueEstimated);
    return (eps != null && eps > 0) || (rev != null && rev > 0);
  }).length;

  const epsGrowthScore = epsGrowth == null ? 0 : scoreLinear(epsGrowth, -20, 60) * 0.25;
  const revenueGrowthScore = revenueGrowth == null ? 0 : scoreLinear(revenueGrowth, -10, 35) * 0.25;
  const positiveConsistencyScore = scoreLinear(positiveEpsCount, 1, Math.min(6, recent.length)) * 0.30;
  const beatConsistencyScore = scoreLinear(beatCount, 1, Math.min(6, recent.length)) * 0.15;
  const latestPositiveScore = typeof latest.epsActual === "number" && latest.epsActual > 0 ? 5 : 0;

  const score = clamp(
    epsGrowthScore + revenueGrowthScore + positiveConsistencyScore + beatConsistencyScore + latestPositiveScore,
    0,
    100
  );

  const hasGrowth = (epsGrowth != null && epsGrowth > 0) || (revenueGrowth != null && revenueGrowth > 0);
  if (!hasGrowth || score < 50) return null;

  const tone: PickerTone = score >= 75 ? "green" : score >= 60 ? "yellow" : "orange";
  const epsText = epsGrowth == null ? "EPS YoY unavailable" : `EPS YoY ${epsGrowth >= 0 ? "+" : ""}${epsGrowth.toFixed(1)}%`;
  const revenueText = revenueGrowth == null ? "revenue YoY unavailable" : `revenue YoY ${revenueGrowth >= 0 ? "+" : ""}${revenueGrowth.toFixed(1)}%`;

  return {
    score,
    tone,
    note: `${epsText}; ${revenueText}; ${positiveEpsCount}/${recent.length} recent EPS-positive reports.`,
    epsGrowthPct: epsGrowth,
    revenueGrowthPct: revenueGrowth,
    releaseDate: latest.date ?? null,
  };
}

function movingAverage(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

function rollingStd(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  for (let i = window - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - window + 1; j <= i; j++) mean += values[j];
    mean /= window;

    let variance = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const d = values[j] - mean;
      variance += d * d;
    }
    variance /= window;

    out[i] = Math.sqrt(variance);
  }
  return out;
}

function bollinger(values: number[], window = 20, k = 2) {
  const mid = movingAverage(values, window);
  const sd = rollingStd(values, window);
  const upper = mid.map((m, i) => (m == null || sd[i] == null ? null : m + k * sd[i]!));
  const lower = mid.map((m, i) => (m == null || sd[i] == null ? null : m - k * sd[i]!));
  return { upper, mid, lower };
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (!values.length) return out;

  const k = 2 / (period + 1);
  let emaPrev: number | null = null;
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];

    if (i < period) {
      sum += v;
      if (i === period - 1) {
        emaPrev = sum / period;
        out[i] = emaPrev;
      }
      continue;
    }

    emaPrev = emaPrev == null ? v : v * k + emaPrev * (1 - k);
    out[i] = emaPrev;
  }

  return out;
}

function rsiWilder(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += -diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  out[period] = 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }

  return out;
}

function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);

  const line: (number | null)[] = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    if (typeof f !== "number" || typeof s !== "number") return null;
    return f - s;
  });

  const lineForEma = line.map((v) => (typeof v === "number" ? v : 0));
  const sigAll = ema(lineForEma, signal);
  const sig: (number | null)[] = sigAll.map((v, i) => (line[i] == null ? null : v));
  const hist: (number | null)[] = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]!));

  return { line, signal: sig, hist };
}

function atr(points: Point[], period = 14): (number | null)[] {
  const tr: (number | null)[] = Array(points.length).fill(null);

  for (let i = 0; i < points.length; i++) {
    const h = points[i].high;
    const l = points[i].low;
    const cPrev = i > 0 ? points[i - 1].close : null;

    if (typeof h !== "number" || !Number.isFinite(h)) continue;
    if (typeof l !== "number" || !Number.isFinite(l)) continue;

    const hl = h - l;
    const hc = cPrev == null ? hl : Math.abs(h - cPrev);
    const lc = cPrev == null ? hl : Math.abs(l - cPrev);

    tr[i] = Math.max(hl, hc, lc);
  }

  const out: (number | null)[] = Array(points.length).fill(null);

  let sum = 0;
  let count = 0;
  let prevATR: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const v = tr[i];

    if (v == null) {
      out[i] = prevATR;
      continue;
    }

    if (prevATR == null) {
      sum += v;
      count++;
      if (count === period) {
        prevATR = sum / period;
        out[i] = prevATR;
      }
      continue;
    }

    prevATR = (prevATR * (period - 1) + v) / period;
    out[i] = prevATR;
  }

  return out;
}

type AggregatedPoint = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

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

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7);
}

function aggregatePoints(points: Point[], interval: "w" | "m"): AggregatedPoint[] {
  const bucketed: AggregatedPoint[] = [];
  let currentKey = "";
  let current: AggregatedPoint | null = null;

  for (const point of points) {
    const key = interval === "w" ? startOfWeekUtc(point.date) : monthKey(point.date);

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

function computeMa200ProximityBasic(
  points: Point[],
  interval: "d" | "w"
): { pctDistance: number; timeframe: "D" | "W" } | null {
  const series = interval === "d" ? points : aggregatePoints(points, "w");

  const closes = series.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 200) return null;

  const ma200Arr = movingAverage(closes, 200);
  const lastClose = closes[closes.length - 1];
  const lastMA200 = lastNum(ma200Arr);

  if (
    typeof lastClose !== "number" ||
    typeof lastMA200 !== "number" ||
    !Number.isFinite(lastClose) ||
    !Number.isFinite(lastMA200) ||
    lastMA200 === 0
  ) {
    return null;
  }

  const pctDistance = ((lastClose - lastMA200) / lastMA200) * 100;

  if (pctDistance < -1 || pctDistance > 3) return null;

  return {
    pctDistance,
    timeframe: interval === "d" ? "D" : "W",
  };
}

function averageDollarVolume(points: Point[], lookback = 20) {
  const slice = points.slice(-lookback);
  const values = slice
    .map((p) => {
      if (
        typeof p.close !== "number" ||
        !Number.isFinite(p.close) ||
        typeof p.volume !== "number" ||
        !Number.isFinite(p.volume)
      ) {
        return null;
      }
      return p.close * p.volume;
    })
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  return values.length ? avg(values) : 0;
}

function liquidityScore(points: Point[]) {
  const adv = averageDollarVolume(points, 20);
  return scoreLinear(Math.log10(Math.max(adv, 1)), 5, 8.7);
}

function recentVolatilityPct(points: Point[], lookback = 20) {
  const slice = points.slice(-lookback).filter((p) => Number.isFinite(p.close));
  if (slice.length < 2) return 0;

  let total = 0;
  let count = 0;

  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1].close;
    const cur = slice[i].close;
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) continue;
    total += Math.abs(((cur - prev) / prev) * 100);
    count++;
  }

  return count ? total / count : 0;
}

function computeMacroSupportResistanceCandidate(points: Point[]): MacroSupportResistanceCandidate | null {
  const weeklyPoints = aggregatePoints(points, "w").map((point) => ({
    date: point.date,
    close: point.close,
    high: point.high,
    low: point.low,
    volume: point.volume,
  }));

  const series = weeklyPoints.slice(-260);

  if (series.length < 90) return null;

  const last = series[series.length - 1];
  const lastClose = last?.close;

  if (!Number.isFinite(lastClose) || lastClose <= 0) return null;

  type Pivot = {
    idx: number;
    price: number;
    kind: "support" | "resistance";
  };

  const pivots: Pivot[] = [];
  const leftRight = 2;

  for (let i = leftRight; i < series.length - leftRight; i++) {
    const point = series[i];
    const high = typeof point.high === "number" ? point.high : point.close;
    const low = typeof point.low === "number" ? point.low : point.close;

    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let offset = 1; offset <= leftRight; offset++) {
      const left = series[i - offset];
      const right = series[i + offset];

      const leftHigh = typeof left.high === "number" ? left.high : left.close;
      const rightHigh = typeof right.high === "number" ? right.high : right.close;
      const leftLow = typeof left.low === "number" ? left.low : left.close;
      const rightLow = typeof right.low === "number" ? right.low : right.close;

      if (high < leftHigh || high < rightHigh) isSwingHigh = false;
      if (low > leftLow || low > rightLow) isSwingLow = false;
    }

    if (isSwingHigh) {
      pivots.push({ idx: i, price: high, kind: "resistance" });
    }

    if (isSwingLow) {
      pivots.push({ idx: i, price: low, kind: "support" });
    }
  }

  if (pivots.length < 6) return null;

  const maxZonePct = 4.5;
  const normalVolumeValues = series
    .slice(-52)
    .map((point) => point.volume)
    .filter((volume): volume is number => typeof volume === "number" && Number.isFinite(volume) && volume > 0);
  const normalWeeklyVolume = normalVolumeValues.length ? avg(normalVolumeValues) : 0;

  type Cluster = {
    kind: "support" | "resistance";
    level: number;
    zoneLow: number;
    zoneHigh: number;
    touches: number;
    zonePct: number;
    spanWeeks: number;
    distancePct: number;
    volumeRatio: number;
    score: number;
  };

  const clusters: Cluster[] = [];

  for (const pivot of pivots) {
    const sameKind = pivots.filter((candidate) => candidate.kind === pivot.kind);

    const members = sameKind.filter((candidate) => {
      const mid = (candidate.price + pivot.price) / 2;
      if (mid <= 0) return false;
      return Math.abs(((candidate.price - pivot.price) / mid) * 100) <= maxZonePct;
    });

    if (members.length < 3) continue;

    const prices = members.map((member) => member.price);
    const zoneLow = Math.min(...prices);
    const zoneHigh = Math.max(...prices);
    const level = avg(prices);
    const zonePct = level > 0 ? ((zoneHigh - zoneLow) / level) * 100 : 999;

    if (zonePct > maxZonePct) continue;

    const firstIdx = Math.min(...members.map((member) => member.idx));
    const lastIdx = Math.max(...members.map((member) => member.idx));
    const spanWeeks = lastIdx - firstIdx;

    if (spanWeeks < 18) continue;

    let distancePct = 999;

    if (pivot.kind === "support") {
      distancePct = ((lastClose - level) / level) * 100;
      if (distancePct < -3 || distancePct > 12) continue;
    } else {
      distancePct = ((level - lastClose) / lastClose) * 100;
      if (distancePct < -3 || distancePct > 12) continue;
    }

    const zoneVolumes: number[] = [];

    for (const point of series) {
      const high = typeof point.high === "number" ? point.high : point.close;
      const low = typeof point.low === "number" ? point.low : point.close;
      const volume = point.volume;

      if (
        typeof volume !== "number" ||
        !Number.isFinite(volume) ||
        volume <= 0 ||
        !Number.isFinite(high) ||
        !Number.isFinite(low)
      ) {
        continue;
      }

      const overlapsZone = low <= zoneHigh && high >= zoneLow;
      if (overlapsZone) zoneVolumes.push(volume);
    }

    const touchVolumes = members
      .map((member) => series[member.idx]?.volume)
      .filter((volume): volume is number => typeof volume === "number" && Number.isFinite(volume) && volume > 0);

    const combinedZoneVolume = [...zoneVolumes, ...touchVolumes];
    const zoneVolumeAvg = combinedZoneVolume.length ? avg(combinedZoneVolume) : 0;
    const volumeRatio = normalWeeklyVolume > 0 && zoneVolumeAvg > 0 ? zoneVolumeAvg / normalWeeklyVolume : 1;

    const touchScore = scoreLinear(members.length, 3, 7);
    const tightnessScore = scoreInverse(zonePct, 1, maxZonePct);
    const proximityScore = scoreInverse(Math.abs(distancePct), 0, 12);
    const spanScore = scoreLinear(spanWeeks, 18, 120);
    const volumeScore = scoreLinear(Math.min(volumeRatio, 2.5), 0.8, 2.2);
    const liqScore = liquidityScore(points);

    const score =
      touchScore * 0.27 +
      proximityScore * 0.24 +
      tightnessScore * 0.18 +
      volumeScore * 0.16 +
      spanScore * 0.09 +
      liqScore * 0.06;

    clusters.push({
      kind: pivot.kind,
      level,
      zoneLow,
      zoneHigh,
      touches: members.length,
      zonePct,
      spanWeeks,
      distancePct,
      volumeRatio,
      score,
    });
  }

  const deduped = clusters.filter((cluster, index, all) => {
    const duplicateIndex = all.findIndex(
      (candidate) =>
        candidate.kind === cluster.kind &&
        Math.abs(((candidate.level - cluster.level) / cluster.level) * 100) <= 1.2
    );

    return duplicateIndex === index;
  });

  const best = deduped
    .sort((a, b) => b.score - a.score || Math.abs(a.distancePct) - Math.abs(b.distancePct))[0];

  if (!best) return null;

  // The clustering above uses the structural pivot type (swing lows form
  // candidate support zones, swing highs form candidate resistance zones) to
  // find where the wall is. But whether the zone should be *labelled*
  // support or resistance depends on where price is sitting right now, not
  // on how the zone originally formed:
  //   - price below the zone  -> resistance (price is being capped from below)
  //   - price above the zone  -> support    (price is being held up from above)
  //   - price inside the zone -> ambiguous; default using the previous 3
  //     weekly bars (excluding the current one) -- mostly-below defaults to
  //     resistance, mostly-above defaults to support, and a tie falls back to
  //     the original structural classification.
  let displayKind: "support" | "resistance";

  if (lastClose < best.zoneLow) {
    displayKind = "resistance";
  } else if (lastClose > best.zoneHigh) {
    displayKind = "support";
  } else {
    const priorBars = series.slice(-4, -1);
    let below = 0;
    let above = 0;

    for (const bar of priorBars) {
      if (!Number.isFinite(bar.close)) continue;
      if (bar.close < best.level) below++;
      else if (bar.close > best.level) above++;
    }

    displayKind = below > above ? "resistance" : above > below ? "support" : best.kind;
  }

  const kindLabel = displayKind === "support" ? "Macro support" : "Macro resistance";
  const distancePctFromLevel = best.level > 0 ? Math.abs(((lastClose - best.level) / best.level) * 100) : 0;
  const distanceSide = lastClose >= best.level ? "above" : "below";
  const zoneLabel =
    Math.abs(best.zoneHigh - best.zoneLow) / best.level < 0.008
      ? `$${best.level.toFixed(2)}`
      : `$${best.zoneLow.toFixed(2)}-$${best.zoneHigh.toFixed(2)}`;

  return {
    score: best.score,
    kind: displayKind,
    zoneLow: best.zoneLow,
    zoneHigh: best.zoneHigh,
    level: best.level,
    touches: best.touches,
    distancePct: best.distancePct,
    zonePct: best.zonePct,
    spanWeeks: best.spanWeeks,
    volumeRatio: best.volumeRatio,
    tone: displayKind === "support" ? "green" : "orange",
    note: `${kindLabel} ${zoneLabel} • ${best.touches} touches • ${distancePctFromLevel.toFixed(1)}% ${distanceSide} zone • ${best.volumeRatio.toFixed(1)}x zone volume`,
  };
}

function computeMa200Candidate(points: Point[], interval: "d" | "w"): Ma200Candidate | null {
  const baseSeries = interval === "d" ? points : aggregatePoints(points, "w").map((p) => ({
    date: p.date,
    close: p.close,
    high: p.high,
    low: p.low,
    volume: p.volume,
  }));

  if (baseSeries.length < 220) return null;

  const closes = baseSeries.map((p) => p.close);
  const ma200Arr = movingAverage(closes, 200);

  const lastClose = closes[closes.length - 1];
  const lastMA200 = lastNum(ma200Arr);

  if (
    typeof lastClose !== "number" ||
    typeof lastMA200 !== "number" ||
    !Number.isFinite(lastClose) ||
    !Number.isFinite(lastMA200) ||
    lastMA200 === 0
  ) {
    return null;
  }

  const pctDistance = pctChange(lastMA200, lastClose);
  if (pctDistance < -1 || pctDistance > 3) return null;

  const lookback = Math.min(interval === "d" ? 500 : 260, closes.length);
  const start = Math.max(0, closes.length - lookback);

  let counted = 0;
  let deepUnder = 0;
  let above = 0;

  for (let i = start; i < closes.length; i++) {
    const close = closes[i];
    const ma200 = ma200Arr[i];
    if (typeof close !== "number" || typeof ma200 !== "number" || ma200 <= 0) continue;

    const distPct = ((close - ma200) / ma200) * 100;
    counted++;
    if (distPct < -7) deepUnder++;
    if (distPct > 0) above++;
  }

  if (!counted) return null;

  const deepUnderPct = (deepUnder / counted) * 100;
  const abovePct = (above / counted) * 100;

  const slopeLookback = Math.min(interval === "d" ? 30 : 12, ma200Arr.length - 1);
  const oldMA200 = ma200Arr[ma200Arr.length - 1 - slopeLookback];
  const slopePct =
    typeof oldMA200 === "number" && oldMA200 > 0
      ? ((lastMA200 - oldMA200) / oldMA200) * 100
      : 0;

  const distanceScore = scoreTargetBand(pctDistance, -0.25, 1.5, -1, 3);
  const deepUnderScore = scoreInverse(deepUnderPct, 20, 60);
  const aboveScore = scoreLinear(abovePct, 45, 85);
  const slopeScore = scoreLinear(slopePct, -2, 4);
  const liqScore = liquidityScore(points);

  const score =
    distanceScore * 0.28 +
    deepUnderScore * 0.32 +
    aboveScore * 0.18 +
    slopeScore * 0.14 +
    liqScore * 0.08;

  return {
    pctDistance,
    timeframe: interval === "d" ? "D" : "W",
    score,
    deepUnderPct,
    abovePct,
    slopePct,
  };
}

function compositeToneFromCounts(overbought: number, oversold: number, spikes: number) {
  const net = overbought - oversold;
  const intensity = overbought + oversold + spikes;

  if (intensity <= 1) return { tone: "yellow" as const, tag: "Calm" };

  if (net >= 2) {
    return {
      tone: intensity >= 5 ? ("red" as const) : ("orange" as const),
      tag: "Overbought-leaning",
    };
  }

  if (net === 1) return { tone: "orange" as const, tag: "Slightly overbought" };

  if (net <= -2) {
    return {
      tone: intensity >= 5 ? ("green" as const) : ("yellow" as const),
      tag: "Oversold-leaning",
    };
  }

  if (net === -1) return { tone: "yellow" as const, tag: "Slightly oversold" };

  return { tone: intensity >= 5 ? ("orange" as const) : ("yellow" as const), tag: "Mixed" };
}

function buildCompositeFromHistory(points: Point[]): CompositeResult | null {
  if (!points.length) return null;

  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 60) return null;

  const lastClose = closes[closes.length - 1];
  if (!Number.isFinite(lastClose)) return null;

  const bb = bollinger(closes, 20, 2);
  const rsi14 = rsiWilder(closes, 14);
  const macdAll = macd(closes, 12, 26, 9);
  const ema20 = ema(closes, 20);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);

  const atr14 = atr(points, 14);

  const volume: (number | null)[] = points.map((p) =>
    typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null
  );
  const volSma20 = smaNullable(volume, 20);
  const atrSma20 = smaNullable(atr14, 20);

  const last = {
    bbU: lastNum(bb.upper),
    bbL: lastNum(bb.lower),
    rsi: lastNum(rsi14),
    macdHist: lastNum(macdAll.hist),
    ema20: lastNum(ema20),
    ma50: lastNum(ma50),
    ma200: lastNum(ma200),
    vol: lastNum(volume),
    volSma: lastNum(volSma20),
    atr: lastNum(atr14),
    atrSma: lastNum(atrSma20),
  };

  let overbought = 0;
  let oversold = 0;
  let spikes = 0;

  // Track how far past its own trigger threshold each check landed (as a
  // ratio of the threshold itself), so the strongest contributor to an
  // oversold/overbought read can be identified afterwards and mapped to a
  // chart indicator -- rather than only exposing the aggregate counts.
  const oversoldRatios: Array<{ label: string; ratio: number }> = [];
  const overboughtRatios: Array<{ label: string; ratio: number }> = [];

  if (typeof last.rsi === "number") {
    if (last.rsi >= 70) {
      overbought++;
      overboughtRatios.push({ label: "RSI(14)", ratio: (last.rsi - 70) / 70 });
    } else if (last.rsi <= 30) {
      oversold++;
      oversoldRatios.push({ label: "RSI(14)", ratio: (30 - last.rsi) / 30 });
    }
  }

  if (typeof last.bbU === "number" && lastClose > last.bbU) {
    overbought++;
    overboughtRatios.push({ label: "Bollinger(20,2)", ratio: (lastClose - last.bbU) / last.bbU });
  } else if (typeof last.bbL === "number" && lastClose < last.bbL) {
    oversold++;
    oversoldRatios.push({ label: "Bollinger(20,2)", ratio: (last.bbL - lastClose) / last.bbL });
  }

  if (typeof last.ema20 === "number" && last.ema20 > 0) {
    const pct = (lastClose - last.ema20) / last.ema20;
    if (pct >= 0.05) {
      overbought++;
      overboughtRatios.push({ label: "EMA20", ratio: (pct - 0.05) / 0.05 });
    } else if (pct <= -0.05) {
      oversold++;
      oversoldRatios.push({ label: "EMA20", ratio: (-pct - 0.05) / 0.05 });
    }
  }

  if (typeof last.ma50 === "number" && last.ma50 > 0) {
    const pct = (lastClose - last.ma50) / last.ma50;
    if (pct >= 0.05) {
      overbought++;
      overboughtRatios.push({ label: "MA50", ratio: (pct - 0.05) / 0.05 });
    } else if (pct <= -0.05) {
      oversold++;
      oversoldRatios.push({ label: "MA50", ratio: (-pct - 0.05) / 0.05 });
    }
  }

  if (typeof last.ma200 === "number" && last.ma200 > 0) {
    const pct = (lastClose - last.ma200) / last.ma200;
    if (pct >= 0.05) {
      overbought++;
      overboughtRatios.push({ label: "MA200", ratio: (pct - 0.05) / 0.05 });
    } else if (pct <= -0.05) {
      oversold++;
      oversoldRatios.push({ label: "MA200", ratio: (-pct - 0.05) / 0.05 });
    }
  }

  if (typeof last.macdHist === "number") {
    const thresh = Math.abs(lastClose) * 0.002;
    if (last.macdHist >= thresh) {
      overbought++;
      overboughtRatios.push({ label: "MACD(12,26,9)", ratio: thresh > 0 ? (last.macdHist - thresh) / thresh : 0 });
    } else if (last.macdHist <= -thresh) {
      oversold++;
      oversoldRatios.push({ label: "MACD(12,26,9)", ratio: thresh > 0 ? (-last.macdHist - thresh) / thresh : 0 });
    }
  }

  if (typeof last.vol === "number" && typeof last.volSma === "number" && last.volSma > 0) {
    if (last.vol >= last.volSma * 1.8) spikes++;
  }

  if (typeof last.atr === "number" && typeof last.atrSma === "number" && last.atrSma > 0) {
    if (last.atr >= last.atrSma * 1.5) spikes++;
  }

  const total = 8;
  const flagged = overbought + oversold + spikes;

  const toneInfo = compositeToneFromCounts(overbought, oversold, spikes);

  // Strongest first, same ordering the dominant label is picked by, so the
  // first entry always equals dominant*Indicator.
  const byRatio = (rs: Array<{ label: string; ratio: number }>) =>
    [...rs].sort((a, b) => b.ratio - a.ratio).map((r) => r.label);
  const oversoldIndicators = byRatio(oversoldRatios);
  const overboughtIndicators = byRatio(overboughtRatios);

  const dominantOversoldIndicator = oversoldRatios.length
    ? oversoldRatios.reduce((best, cur) => (cur.ratio > best.ratio ? cur : best)).label
    : undefined;
  const dominantOverboughtIndicator = overboughtRatios.length
    ? overboughtRatios.reduce((best, cur) => (cur.ratio > best.ratio ? cur : best)).label
    : undefined;

  return {
    total,
    flagged,
    overbought,
    oversold,
    spikes,
    tone: toneInfo.tone,
    tag: toneInfo.tag,
    dominantOversoldIndicator,
    dominantOverboughtIndicator,
    oversoldIndicators,
    overboughtIndicators,
  };
}

function pickIsGreenOverallSignal(c: CompositeResult) {
  return c.oversold >= 2 && c.oversold > c.overbought;
}

function pickIsRedOverallSignal(c: CompositeResult) {
  return c.overbought >= 2 && c.overbought > c.oversold;
}

function buildTrendScoreFromHistory(points: Point[]): TrendScoreResult | null {
  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 220) return null;

  const ma50Arr = movingAverage(closes, 50);
  const ma200Arr = movingAverage(closes, 200);
  const macdAll = macd(closes, 12, 26, 9);

  const lastClose = closes[closes.length - 1];
  const lastMA50 = lastNum(ma50Arr);
  const lastMA200 = lastNum(ma200Arr);
  const lastMacdHist = lastNum(macdAll.hist);

  const priceAboveMA200 =
    typeof lastClose === "number" &&
    typeof lastMA200 === "number" &&
    lastClose > lastMA200;

  const priceAboveMA50 =
    typeof lastClose === "number" &&
    typeof lastMA50 === "number" &&
    lastClose > lastMA50;

  const ma50AboveMA200 =
    typeof lastMA50 === "number" &&
    typeof lastMA200 === "number" &&
    lastMA50 > lastMA200;

  const macdBullish =
    typeof lastMacdHist === "number" &&
    lastMacdHist > 0;

  let passed = 0;
  if (priceAboveMA200) passed += 1;
  if (priceAboveMA50) passed += 1;
  if (ma50AboveMA200) passed += 1;
  if (macdBullish) passed += 1;

  return {
    total: 4,
    passed,
    priceAboveMA200,
    priceAboveMA50,
    ma50AboveMA200,
    macdBullish,
  };
}

// How the composite treats a null trendScore. "live" is exactly what ships and
// is the default, so adding this parameter changes nothing on its own.
//
//   live                    structureScore falls back to the MINIMUM the four
//                           checks can produce, and the structural-weakness
//                           penalty applies. An unassessable trend is treated
//                           as not-yet-qualified, never as passing.
//   no-structure-waived     structure term dropped and the remaining weights
//                           renormalised (/0.95). Kept only so the diagnostic
//                           can still price "drop the term" against live; it
//                           was measured and rejected -- see the comment in
//                           computeOversoldCandidate.
//   no-structure-penalised  as above. Since `live` now penalises a null
//                           trendScore too, this differs from
//                           no-structure-waived only in that both apply it,
//                           i.e. the two are now equivalent; the pair is
//                           retained so a future comparison can distinguish
//                           them again without re-deriving the shape.
//
// Only "live" is reachable from buildPickersPayload. The other two exist for
// app/api/debug/picker-structure, which prices the alternatives against real
// universe data rather than against an estimate.
export type StructureMode = "live" | "no-structure-waived" | "no-structure-penalised";

// The structure term's weight in both composites. Named because it is easy to
// misread: there is a SECOND `structureScore` in the divergence block further
// down this file, weighted 0.2 and derived from real divergence data. They are
// unrelated. Read the weight at the site that uses the value.
const STRUCTURE_WEIGHT = 0.05;

function computeOversoldCandidate(points: Point[], comp: CompositeResult | null, trendScore: TrendScoreResult | null, mode: StructureMode = "live"): OversoldCandidate | null {
  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 60 || !comp) return null;
  if (!pickIsGreenOverallSignal(comp)) return null;

  const rsi14 = rsiWilder(closes, 14);
  const ema20Arr = ema(closes, 20);
  const ma50Arr = movingAverage(closes, 50);
  const bb = bollinger(closes, 20, 2);

  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2] ?? lastClose;
  const lastRsi = lastNum(rsi14);
  const lastEma20 = lastNum(ema20Arr);
  const lastMa50 = lastNum(ma50Arr);
  const lastBbLower = lastNum(bb.lower);

  const advScore = liquidityScore(points);

  const oversoldStrength =
    clamp(
      (typeof lastRsi === "number" ? scoreInverse(lastRsi, 15, 35) : 0) * 0.45 +
      comp.oversold * 12 +
      comp.flagged * 3,
      0,
      100
    );

  const distFromEma20 =
    typeof lastEma20 === "number" && lastEma20 > 0
      ? Math.abs(((lastClose - lastEma20) / lastEma20) * 100)
      : 0;

  const distFromMa50 =
    typeof lastMa50 === "number" && lastMa50 > 0
      ? Math.abs(((lastClose - lastMa50) / lastMa50) * 100)
      : 0;

  const distanceScore = clamp(
    scoreLinear(distFromEma20, 2, 12) * 0.6 + scoreLinear(distFromMa50, 3, 15) * 0.4,
    0,
    100
  );

  const dailyDrop1 = prevClose > 0 ? Math.max(0, ((prevClose - lastClose) / prevClose) * 100) : 0;
  const dailyDrop5Base = closes.length >= 6 ? closes[closes.length - 6] : prevClose;
  const dailyDrop5 = dailyDrop5Base > 0 ? Math.max(0, ((dailyDrop5Base - lastClose) / dailyDrop5Base) * 100) : 0;
  const avgAbsMove = recentVolatilityPct(points, 20);

  const exhaustionScore = clamp(
    scoreLinear(dailyDrop1, 0.8, 6) * 0.4 +
    scoreLinear(dailyDrop5, 2, 12) * 0.45 +
    scoreLinear(avgAbsMove, 1.2, 4.5) * 0.15,
    0,
    100
  );

  // A null trendScore (fewer than 220 closes) takes the MINIMUM the four terms
  // below can produce -- the all-false sum, 20+5+5+5 -- not a mid-range 50.
  //
  // 50 was near the weak end of the achievable range anyway, so the structure
  // term was never the main distortion; the waived penalty below was. But 50 is
  // still a value the checks can genuinely produce, so an unmeasured stock was
  // presented as having been measured and scored 50. The minimum says the
  // opposite: nothing here has been demonstrated.
  //
  // Deliberately NOT "drop the term and renormalise". That was measured against
  // production and reshuffles 313 stocks across the two lists (103 of 135
  // oversold, 210 of 259 overbought; 53 of them by 5+ places) because adjacent
  // ranks in the 15-55 band are separated by a median of 0.30 points and the
  // renormalisation swing is 3.25. This form leaves every stock with a real
  // trendScore on its exact current score.
  let structureScore = 20 + 5 + 5 + 5;
  if (trendScore) {
    structureScore =
      (trendScore.priceAboveMA200 ? 45 : 20) +
      (trendScore.priceAboveMA50 ? 20 : 5) +
      (trendScore.ma50AboveMA200 ? 20 : 5) +
      (trendScore.macdBullish ? 15 : 5);
  }

  if (typeof lastBbLower === "number" && lastClose < lastBbLower) {
    structureScore += 5;
  }

  const recencyScore = 100;

  let penalty = 0;
  if (dailyDrop1 < 0.6 && dailyDrop5 < 3) penalty += 12;
  if (advScore < 35) penalty += 25;
  // `trendScore &&` reads as a null check but decides an outcome: when the
  // trend cannot be assessed the penalty is skipped, so unmeasured scores the
  // same as measured-and-fine. Under "no-structure-penalised" an unassessable
  // trend takes the penalty instead -- not-yet-qualified rather than passing.
  const structurallyWeak = trendScore
    ? !trendScore.priceAboveMA200 && !trendScore.ma50AboveMA200
    : true;
  if (structurallyWeak) penalty += 10;

  const keep = mode === "live" ? 1 : 1 - STRUCTURE_WEIGHT;
  const score =
    (oversoldStrength * 0.3 +
      advScore * 0.25 +
      exhaustionScore * 0.2 +
      distanceScore * 0.15 +
      (mode === "live" ? clamp(structureScore, 0, 100) * STRUCTURE_WEIGHT : 0) +
      recencyScore * 0.05) /
      keep -
    penalty;

  return {
    score,
    note: `${comp.oversold} oversold • liquid ${Math.round(advScore)} • exhaustion ${Math.round(exhaustionScore)}`,
    dominantIndicator: comp.dominantOversoldIndicator,
    firedIndicators: comp.oversoldIndicators,
  };
}

function computeOverboughtCandidate(points: Point[], comp: CompositeResult | null, trendScore: TrendScoreResult | null, mode: StructureMode = "live"): OverboughtCandidate | null {
  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 60 || !comp) return null;
  if (!pickIsRedOverallSignal(comp)) return null;

  const rsi14 = rsiWilder(closes, 14);
  const ema20Arr = ema(closes, 20);
  const ma50Arr = movingAverage(closes, 50);
  const bb = bollinger(closes, 20, 2);

  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2] ?? lastClose;
  const lastRsi = lastNum(rsi14);
  const lastEma20 = lastNum(ema20Arr);
  const lastMa50 = lastNum(ma50Arr);
  const lastBbUpper = lastNum(bb.upper);

  const advScore = liquidityScore(points);

  const overboughtStrength =
    clamp(
      (typeof lastRsi === "number" ? scoreLinear(lastRsi, 65, 85) : 0) * 0.45 +
      comp.overbought * 12 +
      comp.flagged * 3,
      0,
      100
    );

  const distFromEma20 =
    typeof lastEma20 === "number" && lastEma20 > 0
      ? Math.abs(((lastClose - lastEma20) / lastEma20) * 100)
      : 0;

  const distFromMa50 =
    typeof lastMa50 === "number" && lastMa50 > 0
      ? Math.abs(((lastClose - lastMa50) / lastMa50) * 100)
      : 0;

  const distanceScore = clamp(
    scoreLinear(distFromEma20, 2, 12) * 0.6 + scoreLinear(distFromMa50, 3, 15) * 0.4,
    0,
    100
  );

  const dailyJump1 = prevClose > 0 ? Math.max(0, ((lastClose - prevClose) / prevClose) * 100) : 0;
  const dailyJump5Base = closes.length >= 6 ? closes[closes.length - 6] : prevClose;
  const dailyJump5 = dailyJump5Base > 0 ? Math.max(0, ((lastClose - dailyJump5Base) / dailyJump5Base) * 100) : 0;
  const avgAbsMove = recentVolatilityPct(points, 20);

  const extensionScore = clamp(
    scoreLinear(dailyJump1, 0.8, 6) * 0.4 +
    scoreLinear(dailyJump5, 2, 12) * 0.45 +
    scoreLinear(avgAbsMove, 1.2, 4.5) * 0.15,
    0,
    100
  );

  // Minimum achievable, same reasoning as computeOversoldCandidate above: the
  // all-false sum, 10+5+5+10. There is no trendScore-dependent penalty on this
  // side, so this term is the whole of the change here.
  let structureScore = 10 + 5 + 5 + 10;
  if (trendScore) {
    structureScore =
      (trendScore.priceAboveMA200 ? 35 : 10) +
      (trendScore.priceAboveMA50 ? 25 : 5) +
      (trendScore.ma50AboveMA200 ? 20 : 5) +
      (trendScore.macdBullish ? 20 : 10);
  }

  if (typeof lastBbUpper === "number" && lastClose > lastBbUpper) {
    structureScore += 5;
  }

  let penalty = 0;
  if (dailyJump1 < 0.6 && dailyJump5 < 3) penalty += 12;
  if (advScore < 35) penalty += 25;

  const keep = mode === "live" ? 1 : 1 - STRUCTURE_WEIGHT;
  const score =
    (overboughtStrength * 0.3 +
      advScore * 0.25 +
      extensionScore * 0.2 +
      distanceScore * 0.15 +
      (mode === "live" ? clamp(structureScore, 0, 100) * STRUCTURE_WEIGHT : 0) +
      100 * 0.05) /
      keep -
    penalty;

  return {
    score,
    note: `${comp.overbought} overbought • liquid ${Math.round(advScore)} • extension ${Math.round(extensionScore)}`,
    dominantIndicator: comp.dominantOverboughtIndicator,
    firedIndicators: comp.overboughtIndicators,
  };
}

function computeAthPullback(points: Point[]): AthPullbackCandidate | null {
  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 220) return null;

  const lastClose = closes[closes.length - 1];
  const allTimeHigh = Math.max(...closes);
  if (!Number.isFinite(allTimeHigh) || allTimeHigh <= 0) return null;

  const drawdownPct = ((allTimeHigh - lastClose) / allTimeHigh) * 100;
  if (drawdownPct < 20) return null;

  const adv = averageDollarVolume(points, 20);
  const advScore = liquidityScore(points);

  const distanceScore = scoreTargetBand(drawdownPct, 20, 35, 20, 65);

  const last20 = closes.slice(-20);
  const max20 = Math.max(...last20);
  const min20 = Math.min(...last20);
  const rangePct = min20 > 0 ? ((max20 - min20) / min20) * 100 : 0;
  const structureScore = scoreInverse(rangePct, 8, 35);

  const ma200Arr = movingAverage(closes, 200);
  const ma50Arr = movingAverage(closes, 50);
  const lastMa200 = lastNum(ma200Arr);
  const lastMa50 = lastNum(ma50Arr);

  let trendContext = 35;
  if (typeof lastMa200 === "number" && typeof lastMa50 === "number") {
    trendContext =
      (lastClose > lastMa200 ? 45 : 12) +
      (lastClose > lastMa50 ? 25 : 8) +
      (lastMa50 > lastMa200 ? 20 : 6);
  }

  const lookback10 = closes.length >= 11 ? closes[closes.length - 11] : closes[0];
  const recentBehaviour = lookback10 > 0 ? scoreTargetBand(pctChange(lookback10, lastClose), -4, 6, -15, 12) : 40;

  let penalty = 0;
  if (drawdownPct > 50) penalty += 20;
  if (drawdownPct > 60) penalty += 15;
  if (advScore < 35) penalty += 30;
  if (typeof lastMa200 === "number" && lastClose < lastMa200 * 0.85) penalty += 15;

  const score =
    distanceScore * 0.3 +
    advScore * 0.3 +
    structureScore * 0.2 +
    clamp(trendContext, 0, 100) * 0.1 +
    recentBehaviour * 0.1 -
    penalty;

  let athDate = "";
  for (const p of points) {
    if (Number.isFinite(p.close) && p.close === allTimeHigh) {
      athDate = String(p.date ?? "");
      break;
    }
  }

  return {
    score,
    drawdownPct,
    avgDollarVolume: adv,
    athPrice: allTimeHigh,
    athDate,
  };
}

function findMostRecentAthBreakoutBarsAgo(closes: number[]) {
  if (closes.length < 2) return null;

  for (let i = closes.length - 1; i >= 1; i--) {
    const before = closes.slice(0, i);
    if (!before.length) continue;
    const priorHigh = Math.max(...before);
    if (closes[i] >= priorHigh * 1.001) {
      return closes.length - 1 - i;
    }
  }

  return null;
}

function computeAthBreakout(points: Point[]): BreakoutCandidate | null {
  const pts = points.filter((p) => p?.date && Number.isFinite(p.close));
  if (pts.length < 120) return null;

  const closes = pts.map((p) => p.close);
  const lastClose = closes[closes.length - 1];
  const allTimeHigh = Math.max(...closes);
  if (!Number.isFinite(allTimeHigh) || allTimeHigh <= 0) return null;

  const eps = 0.01;
  const isAtAth = lastClose >= allTimeHigh * (1 - eps);
  if (!isAtAth) return null;

  const breakoutBarsAgo = findMostRecentAthBreakoutBarsAgo(closes);
  const breakoutPct = ((lastClose - allTimeHigh) / allTimeHigh) * 100;
  const adv = averageDollarVolume(points, 20);
  const advScore = liquidityScore(points);

  const recencyScore = breakoutBarsAgo == null ? 50 : scoreInverse(breakoutBarsAgo, 0, 25);
  const extensionScore = scoreInverse(Math.abs(breakoutPct), 0, 8);

  const volumeArr: (number | null)[] = pts.map((p) =>
    typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null
  );
  const volSma20 = smaNullable(volumeArr, 20);
  const lastVol = lastNum(volumeArr);
  const lastVolSma = lastNum(volSma20);
  const volumeScore =
    typeof lastVol === "number" && typeof lastVolSma === "number" && lastVolSma > 0
      ? scoreLinear(lastVol / lastVolSma, 0.9, 2.2)
      : 45;

  let penalty = 0;
  if (advScore < 35) penalty += 25;
  if (Math.abs(breakoutPct) > 6) penalty += 15;

  const score =
    recencyScore * 0.45 +
    volumeScore * 0.25 +
    advScore * 0.2 +
    extensionScore * 0.1 -
    penalty;

  let athDate = "";
  for (const p of pts) {
    if (p.close === allTimeHigh) {
      athDate = String(p.date ?? "");
      break;
    }
  }

  return {
    score,
    breakoutPct,
    breakoutBarsAgo: breakoutBarsAgo ?? 999,
    avgDollarVolume: adv,
    highPrice: allTimeHigh,
    highDate: athDate,
  };
}

function computeThreeMonthBreakout(points: Point[]): BreakoutCandidate | null {
  const pts = points.filter((p) => p?.date && Number.isFinite(p.close));
  if (pts.length < 90) return null;

  const closes = pts.map((p) => p.close);
  const lastClose = closes[closes.length - 1];
  if (!Number.isFinite(lastClose)) return null;

  const LOOKBACK_BARS = 63;
  const EXCLUDE_RECENT_BARS = 5;

  const endExclusive = closes.length - EXCLUDE_RECENT_BARS;
  const startInclusive = endExclusive - LOOKBACK_BARS;

  if (startInclusive < 0 || endExclusive <= startInclusive) return null;

  const breakoutWindow = closes.slice(startInclusive, endExclusive);
  if (!breakoutWindow.length) return null;

  const rangeHigh = Math.max(...breakoutWindow);
  if (!Number.isFinite(rangeHigh) || rangeHigh <= 0) return null;

  const eps = 0.005;
  if (lastClose < rangeHigh * (1 - eps)) return null;

  let breakoutBarsAgo = 0;
  for (let i = closes.length - 1; i >= endExclusive; i--) {
    if (closes[i] >= rangeHigh * (1 - eps)) {
      breakoutBarsAgo = closes.length - 1 - i;
    }
  }

  const breakoutPct = ((lastClose - rangeHigh) / rangeHigh) * 100;
  const adv = averageDollarVolume(points, 20);
  const advScore = liquidityScore(points);

  const recencyScore = scoreInverse(breakoutBarsAgo, 0, 20);
  const extensionScore = scoreInverse(Math.abs(breakoutPct), 0, 10);

  const volumeArr: (number | null)[] = pts.map((p) =>
    typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null
  );
  const volSma20 = smaNullable(volumeArr, 20);
  const lastVol = lastNum(volumeArr);
  const lastVolSma = lastNum(volSma20);
  const volumeScore =
    typeof lastVol === "number" && typeof lastVolSma === "number" && lastVolSma > 0
      ? scoreLinear(lastVol / lastVolSma, 0.9, 2.2)
      : 45;

  let penalty = 0;
  if (advScore < 35) penalty += 25;
  if (Math.abs(breakoutPct) > 8) penalty += 12;

  const score =
    recencyScore * 0.45 +
    volumeScore * 0.25 +
    advScore * 0.2 +
    extensionScore * 0.1 -
    penalty;

  let rangeHighDate = "";
  for (let i = 0; i < breakoutWindow.length; i++) {
    if (breakoutWindow[i] === rangeHigh) {
      rangeHighDate = String(pts[startInclusive + i]?.date ?? "");
      break;
    }
  }

  return {
    score,
    breakoutPct,
    breakoutBarsAgo,
    avgDollarVolume: adv,
    highPrice: rangeHigh,
    highDate: rangeHighDate,
  };
}

/* -------------------------- concurrency limit ------------------------ */

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

/* ------------------------------ fetchers ----------------------------- */

// Reads the market snapshot in-process instead of the server HTTP-fetching its
// own public URL. Same self-block class already fixed for playsBuilder.ts and
// descendingTrianglesBuilder.ts in #262/#263 -- pickersBuilder was missed.
//
// The self-fetch carried no BotID header and no session cookie, so our own
// firewall could challenge it; fetchJSON throws on non-ok, and this is the
// FIRST thing buildPickersPayload does, so that throw took the whole build with
// it whenever the pickers cache was also cold. getPickerData() then swallowed
// it into an empty page -- which is how a deploy came to bake 32 empty screener
// pages as their prerendered artefacts. See
// claude/picker-pages-isr-2026-08-20.md.
//
// readMarketState() never throws: a miss degrades to an empty snapshot, the
// universe falls back to readDynamicUniverse() + PRESET_UNIVERSE, and the
// emptiness guard in PickerResultPage catches the case where that leaves
// nothing worth prerendering. MarketStateSnapshot is structurally identical to
// MarketPayload -- same six fields, same row shape.
async function fetchMarket(): Promise<MarketPayload> {
  return readMarketState();
}

// Pure transform over already-fetched points -- the actual Redis/FMP fetch
// now happens once for the whole universe via getDailyHistoryBulk() before
// this is called (see the comment at that call site), rather than per
// symbol here.
function normalizeHistory(pts: Point[], days: number) {
  return pts
    .map((p) => ({
      date: String(p?.date ?? ""),
      close: Number(p?.close),
      open: p?.open == null ? undefined : Number(p.open),
      high: p?.high == null ? undefined : Number(p.high),
      low: p?.low == null ? undefined : Number(p.low),
      volume: p?.volume == null ? undefined : Number(p.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close))
    .slice(-days);
}

/* ------------------------------ universe ----------------------------- */


// Raised 200 -> 260 so guaranteeing the ~100-name PRESET_UNIVERSE (the largest
// US companies, prepended below) doesn't push the day's active/mover names out
// of the analyzed set -- we now fit both the big caps AND ~160 dynamic names.
// The scan universe ceiling. Now equal to MAX_DYNAMIC_UNIVERSE_SIZE (700) in
// dynamicUniverseCache, so the cap is no longer the thing limiting how much of
// the universe gets scanned -- the discovery pool is.
//
// Measured on the way here rather than guessed. At 260 -> 450 the live rebuild
// produced universe 416 in 6,232ms with 0 failed symbols, against a 300s
// function limit (2% of budget) and a 698KB Redis write against a 10MB request
// limit. Extrapolating: 700 symbols is ~10.5s and ~1.2MB. The scan was never
// the constraint -- the payload was, and #214 removed it by moving chart series
// off-payload.
//
// What this does NOT do is instantly produce 700 symbols. The pool feeding the
// backfill is ~353, so today this yields the same ~416. Discovery fills toward
// 700 at 50 candidates/5min when FMP capacity allows, and the universe follows.
//
// The one thing that genuinely degrades as this grows: warm-stock-data uses a
// FIXED 25-symbol slice per run, so full coverage of valuation/dividend/analyst
// data stretches linearly -- ~2.8h at 416, ~4.7h at 700. REFRESH_SLICE_SIZE is
// the dial if that matters (~8 FMP calls per symbol).
const UNIVERSE_CAP = 700;

// Popular Searches promotion (see claude/popular-searches-universe-spec-2026-07-23.md).
// A ticker only earns a guaranteed analyzed-universe slot once real users have
// deliberately selected it enough times over the 14-day demand window -- a
// one-off search never gets analyzed (the promotion THRESHOLD), and the slice is
// hard-capped so it can never blow up a build's FMP budget (the SUB-CAP). Because
// selection counts are deduped per (caller, symbol) per 30 min upstream, a
// symbol's demand score approximates the number of distinct interested callers,
// so the threshold reads as "at least this many different people looked it up".
const POPULAR_SEARCH_MIN_SCORE = 3; // promotion threshold (~distinct callers)
const POPULAR_SEARCH_QUOTA = 30; // FMP sub-cap: max promoted names per build

/* --------------------------- builder function ------------------------ */

// `origin` and `forceFreshMarket` are vestigial: both existed only to drive the
// old fetchMarket() self-fetch, which now reads in-process. They are kept on the
// signature because getPickersData() still takes an `origin` from seven callers
// (the ticker-lookup and debug routes, warmTargets, the two divergence pages),
// and threading that removal through all of them is a separate change. Nothing
// in here reads them.
async function buildPickersPayload(origin: string, forceFreshMarket = false): Promise<PickersPayload> {
  const buildStartedAt = Date.now();
  const market = await fetchMarket();

  const topTraded = (market?.topTraded ?? [])
    .map((x) => x.symbol)
    .filter(Boolean);

  const topMoversRaw: MarketRow[] = market?.topMovers ?? [];

  const topMovers = topMoversRaw
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

  const dynamicUniverseSet = new Set(dynamicUniverse);

  // Popular Searches promotion: pull the 14-day demand ranking and keep only
  // names that clear the promotion threshold AND aren't already guaranteed by
  // PRESET_UNIVERSE (no point spending a promoted slot on AAPL). Bounded to the
  // sub-cap. Fail-open -- a Redis hiccup here just means no promoted names this
  // build, never a broken payload.
  const presetSet = new Set(
    PRESET_UNIVERSE.map((s) => s.trim().toUpperCase())
  );
  let popularSearchSymbols: string[] = [];
  try {
    const demand = await readSearchDemand(POPULAR_SEARCH_QUOTA * 4);
    popularSearchSymbols = demand
      .filter((d) => d.score >= POPULAR_SEARCH_MIN_SCORE)
      .map((d) => String(d.symbol).trim().toUpperCase())
      .filter((s) => s && !presetSet.has(s))
      .slice(0, POPULAR_SEARCH_QUOTA);
  } catch {
    popularSearchSymbols = [];
  }
  const popularSearchSet = new Set(popularSearchSymbols);

  // Persist the promoted names into the shared dynamic universe under their own
  // "search" source, so their provenance is tracked and (with the same 14-day
  // decay as market names) their presence accumulates across builds while people
  // keep looking them up. The raw demand score stays separate (searchDemand.ts)
  // for the /popular-searches ranking; this is only membership/provenance.
  if (popularSearchSymbols.length) {
    await addToDynamicUniverse(popularSearchSymbols, "search", 1);
  }

  // Explicit-quota universe assembly -- NOT concat-then-slice. That exact
  // pattern is what sliced the mega-caps off (PRESET was appended after the big
  // dynamic set, then the whole thing was cut to the cap, dropping AAPL/NVDA/...
  // -- only active movers like MU survived, which is why the biggest companies
  // were missing from the All Stocks screener). Instead, three disjoint, bounded
  // slices are filled in priority order so no single source can starve another:
  //   1. PRESET_UNIVERSE  -- all ~100 largest US caps, always guaranteed first.
  //   2. Popular searches -- up to POPULAR_SEARCH_QUOTA promoted names.
  //   3. Market-dynamic   -- the day's active/mover + accumulated dynamic names,
  //                          filling whatever slots remain up to UNIVERSE_CAP.
  // Slice 3 backfills any slots slices 1-2 didn't use, so there are never gaps.
  const universeSlots = new Set<string>();
  const fillSlots = (symbols: string[], maxFromThisSource: number) => {
    let added = 0;
    for (const raw of symbols) {
      if (universeSlots.size >= UNIVERSE_CAP) break;
      if (added >= maxFromThisSource) break;
      const s = String(raw).trim().toUpperCase();
      if (!s || universeSlots.has(s)) continue;
      universeSlots.add(s);
      added++;
    }
  };
  fillSlots(PRESET_UNIVERSE, PRESET_UNIVERSE.length);
  fillSlots(popularSearchSymbols, POPULAR_SEARCH_QUOTA);
  fillSlots(dynamicUniverse, UNIVERSE_CAP); // backfills the remainder
  const universe = Array.from(universeSlots);

  // Queue missing earnings data for the background warmer. The picker route reads
  // earnings from Redis only, so page loads never spend FMP calls on earnings.
  await queueEarningsWarmupSymbols(universe);

  // One pipelined bulk read for the whole universe instead of one Redis
  // call per symbol inside the loop below.
  const earningsBySymbol = await readCachedFmpEarningsBulk(universe);

  // Same idea for price history: one pipelined mget for the whole universe
  // up front instead of one Redis GET per symbol inside the loop below (was
  // up to ~200 individual Upstash REST calls just to check "is this already
  // cached", before any FMP fetch even happens). Cache misses still fall
  // back to the existing per-symbol lock+fetch path inside this helper.
  const historyBySymbol = await getDailyHistoryBulk(universe);

  const limit = pLimit(10);
  const days = 1300;

  const hotDynamicNames: PickerItem[] = [];
  const green: PickerItem[] = [];
  const red: PickerItem[] = [];
  const trendLeaders: PickerItem[] = [];
  const dips: PickerItem[] = [];
  const athBreakouts: PickerItem[] = [];
  const threeMonthBreakouts: PickerItem[] = [];
  const dailyMa200Proximity: PickerItem[] = [];
  const weeklyMa200Proximity: PickerItem[] = [];
  const macroSupportResistance: PickerItem[] = [];
  const divergences: PickerItem[] = [];
  const positiveLastEarnings: PickerItem[] = [];
  const strongEarningsGrowth: PickerItem[] = [];
  const signalRecords: SignalRecord[] = [];

  // Track symbols that failed to fetch usable history (empty result or a
  // thrown error) so we can detect a degraded build instead of silently
  // shipping a payload where sections like ATH breakouts may have lost
  // legitimate matches purely due to upstream fetch failures.
  let failedSymbolCount = 0;
  const failedSymbols: string[] = [];

  const isDynamicUniverse = (sym: string) => dynamicUniverseSet.has(sym);
  const isPopularSearch = (sym: string) => popularSearchSet.has(sym);
  // Popular-search names get the same ranking nudge dynamic names get (and both,
  // if a name qualifies as both), so a ticker real users keep looking up floats
  // up within whatever category it lands in rather than sitting at the bottom.
  const dynamicBoost = (sym: string) =>
    (isDynamicUniverse(sym) ? 10 : 0) + (isPopularSearch(sym) ? 10 : 0);

  await Promise.all(
    universe.map((symbol) =>
      limit(async () => {
        try {
          const rawPts = historyBySymbol.get(symbol) ?? [];
          const pts = normalizeHistory(rawPts, days);
          if (!pts.length) {
            failedSymbolCount++;
            failedSymbols.push(symbol);
            return;
          }

          const earningsRows = earningsBySymbol.get(symbol) ?? [];

          const dynamicName = isDynamicUniverse(symbol);
          const popularName = isPopularSearch(symbol);
          const chartPoints = buildPickerChartPoints(pts);

          const positiveLastEarningsCandidate = computePositiveLastEarningsCandidate(earningsRows);
          if (positiveLastEarningsCandidate) {
            positiveLastEarnings.push({
              symbol,
              chartPoints,
              tone: positiveLastEarningsCandidate.tone,
              note: positiveLastEarningsCandidate.note,
              _score: positiveLastEarningsCandidate.score + dynamicBoost(symbol),
            });
          }

          const strongEarningsGrowthCandidate = computeStrongEarningsGrowthCandidate(earningsRows);
          if (strongEarningsGrowthCandidate) {
            strongEarningsGrowth.push({
              symbol,
              chartPoints,
              tone: strongEarningsGrowthCandidate.tone,
              note: strongEarningsGrowthCandidate.note,
              _score: strongEarningsGrowthCandidate.score + dynamicBoost(symbol),
              epsGrowthPct: strongEarningsGrowthCandidate.epsGrowthPct,
              revenueGrowthPct: strongEarningsGrowthCandidate.revenueGrowthPct,
              releaseDate: strongEarningsGrowthCandidate.releaseDate,
            });
          }

          const comp = buildCompositeFromHistory(pts);
          const trendScore = buildTrendScoreFromHistory(pts);

          if (comp) {
            const hotSignals =
              (comp.oversold >= 2 ? 1 : 0) +
              (comp.overbought >= 2 ? 1 : 0) +
              (comp.spikes >= 1 ? 1 : 0);

            if (dynamicName && hotSignals > 0) {
              hotDynamicNames.push({
                symbol,
                chartPoints,
                tone: comp.tone,
                note: `${comp.tag} • ${comp.flagged}/${comp.total} checks`,
                _score: hotSignals * 100 + comp.flagged * 10 + dynamicBoost(symbol),
              });
            }
          }

          const oversoldCandidate = computeOversoldCandidate(pts, comp, trendScore);
          if (oversoldCandidate) {
            green.push({
              symbol,
              chartPoints,
              tone: "green",
              note: oversoldCandidate.note,
              _score: oversoldCandidate.score + dynamicBoost(symbol),
              dominantIndicator: oversoldCandidate.dominantIndicator,
              firedIndicators: oversoldCandidate.firedIndicators,
            });
          }

          const overboughtCandidate = computeOverboughtCandidate(pts, comp, trendScore);
          if (overboughtCandidate) {
            red.push({
              symbol,
              chartPoints,
              tone: "red",
              note: overboughtCandidate.note,
              _score: overboughtCandidate.score + dynamicBoost(symbol),
              dominantIndicator: overboughtCandidate.dominantIndicator,
              firedIndicators: overboughtCandidate.firedIndicators,
            });
          }

          if (trendScore && trendScore.passed >= 3) {
            const liqScore = liquidityScore(pts);
            const score =
              trendScore.passed * 20 +
              (trendScore.priceAboveMA200 ? 18 : 0) +
              (trendScore.priceAboveMA50 ? 12 : 0) +
              (trendScore.ma50AboveMA200 ? 18 : 0) +
              (trendScore.macdBullish ? 12 : 0) +
              liqScore * 0.2 +
              dynamicBoost(symbol);

            trendLeaders.push({
              symbol,
              chartPoints,
              tone: trendScore.passed === 4 ? "green" : "yellow",
              note: `${trendScore.passed}/${trendScore.total} trend checks`,
              // The note is the COUNT; this is which ones. Same derivation the
              // universe path uses, so the section's top 20 and the other 16
              // rows on the page cannot disagree about the same stock.
              firedIndicators: trendIndicatorsFrom(trendScore),
              _score: score,
            });
          }

          const athPullback = computeAthPullback(pts);
          if (athPullback) {
            dips.push({
              symbol,
              chartPoints,
              tone: athPullback.drawdownPct <= 35 ? "yellow" : "orange",
              note: `Down ${athPullback.drawdownPct.toFixed(1)}% from ATH • liquid ${Math.round(liquidityScore(pts))}`,
              _score: athPullback.score + dynamicBoost(symbol),
              chartFocus: { kind: "ath", price: athPullback.athPrice, date: athPullback.athDate },
            });
          }

          const athBo = computeAthBreakout(pts);
          if (athBo) {
            athBreakouts.push({
              symbol,
              chartPoints,
              tone: "orange",
              note: `ATH breakout • ${athBo.breakoutBarsAgo} bars ago`,
              _score: athBo.score + dynamicBoost(symbol),
              chartFocus: { kind: "ath", price: athBo.highPrice, date: athBo.highDate },
            });
          }

          const threeMonthBo = computeThreeMonthBreakout(pts);
          if (threeMonthBo) {
            threeMonthBreakouts.push({
              symbol,
              chartPoints,
              tone: "orange",
              note: `3-month breakout • ${threeMonthBo.breakoutBarsAgo} bars ago`,
              _score: threeMonthBo.score + dynamicBoost(symbol),
              chartFocus: { kind: "rangeHigh", price: threeMonthBo.highPrice, date: threeMonthBo.highDate },
            });
          }

          const macroSupportResistanceCandidate = computeMacroSupportResistanceCandidate(pts);
          if (macroSupportResistanceCandidate) {
            const weeklyChartPoints = buildPickerChartPoints(
              aggregatePoints(pts, "w").map((p) => ({
                date: p.date,
                close: p.close,
                high: p.high,
                low: p.low,
                volume: p.volume,
              })),
              72
            );

            macroSupportResistance.push({
              symbol,
              chartPoints: weeklyChartPoints,
              tone: macroSupportResistanceCandidate.tone,
              note: macroSupportResistanceCandidate.note,
              timeframe: "W",
              dashboardHref: buildDashboardHref({
                symbol,
                timeframe: "W",
              }),
              supportResistanceZone: {
                kind: macroSupportResistanceCandidate.kind,
                lower: macroSupportResistanceCandidate.zoneLow,
                upper: macroSupportResistanceCandidate.zoneHigh,
              },
              _score: macroSupportResistanceCandidate.score + dynamicBoost(symbol),
            });
          }

          const dailyMa200Candidate = computeMa200Candidate(pts, "d");
          if (dailyMa200Candidate) {
            const side = dailyMa200Candidate.pctDistance >= 0 ? "above" : "below";

            dailyMa200Proximity.push({
              symbol,
              chartPoints,
              tone: dailyMa200Candidate.pctDistance >= 0 ? "yellow" : "orange",
              note: `Near Daily MA200 • ${Math.abs(dailyMa200Candidate.pctDistance).toFixed(1)}% ${side} • deep-under ${dailyMa200Candidate.deepUnderPct.toFixed(0)}%`,
              timeframe: "D",
              indicator: "MA200",
              dashboardHref: buildDashboardHref({
                symbol,
                timeframe: "D",
                indicator: "MA200",
              }),
              _score: dailyMa200Candidate.score + dynamicBoost(symbol),
            });
          }

          const weeklyMa200Candidate = computeMa200Candidate(pts, "w");
          if (weeklyMa200Candidate) {
            const side = weeklyMa200Candidate.pctDistance >= 0 ? "above" : "below";

            weeklyMa200Proximity.push({
              symbol,
              chartPoints: buildPickerChartPoints(
                aggregatePoints(pts, "w").map((p) => ({
                  date: p.date,
                  close: p.close,
                  high: p.high,
                  low: p.low,
                  volume: p.volume,
                })),
                72
              ),
              tone: weeklyMa200Candidate.pctDistance >= 0 ? "yellow" : "orange",
              note: `Near Weekly MA200 • ${Math.abs(weeklyMa200Candidate.pctDistance).toFixed(1)}% ${side} • deep-under ${weeklyMa200Candidate.deepUnderPct.toFixed(0)}%`,
              timeframe: "W",
              indicator: "MA200",
              dashboardHref: buildDashboardHref({
                symbol,
                timeframe: "W",
                indicator: "MA200",
              }),
              // Independent section now (own take:20), so no cross-timeframe
              // score boost is needed -- each timeframe is ranked only
              // against itself. See the Daily/Weekly MA200 Proximity
              // sections below.
              _score: weeklyMa200Candidate.score + dynamicBoost(symbol),
            });
          }

          const hasDailyMa200Proximity = !!dailyMa200Candidate;
          const hasWeeklyMa200Proximity = !!weeklyMa200Candidate;

          const dailyDiv = detectDivergenceFromHistory(pts, {
            lookbackBars: 45,
            leftRight: 2,
            minPriceSwingPct: 1.6,
            minRsiSwing: 6,
            macdStdMult: 0.5,
            maxPivot2AgeBars: 16,
          });

          const weeklyPts = aggregatePoints(pts, "w").map((p) => ({
            date: p.date,
            close: p.close,
            high: p.high,
            low: p.low,
            volume: p.volume,
          }));

          // Raw numeric weekly MA200 distance, independent of the -1%..+3%
          // "proximity" gate inside computeMa200Candidate (that gate decides
          // whether a symbol qualifies for the MA200 Proximity picker
          // section; the ticker feed wants a distance for every symbol with
          // enough weekly history so it can rank "closest to weekly MA200"
          // across the whole universe, not just symbols already flagged).
          const weeklyMa200DistancePct = (() => {
            const wCloses = weeklyPts
              .map((p) => p.close)
              .filter((x): x is number => Number.isFinite(x));
            if (wCloses.length < 220) return undefined;
            const wMa200Arr = movingAverage(wCloses, 200);
            const wLastClose = wCloses[wCloses.length - 1];
            const wLastMa200 = lastNum(wMa200Arr);
            if (
              typeof wLastMa200 !== "number" ||
              !Number.isFinite(wLastMa200) ||
              wLastMa200 === 0
            ) {
              return undefined;
            }
            return pctChange(wLastMa200, wLastClose);
          })();

          const weeklyDiv = detectDivergenceFromHistory(weeklyPts, {
            lookbackBars: 30,
            leftRight: 2,
            minPriceSwingPct: 2.0,
            minRsiSwing: 5,
            macdStdMult: 0.35,
            maxPivot2AgeBars: 10,
          });

          const divergenceCandidates = [dailyDiv, weeklyDiv]
            .filter(Boolean)
            .map((div, idx) => {
              const timeframe = idx === 0 ? ("D" as const) : ("W" as const);
              const timeframeScore = timeframe === "W" ? 100 : 65;
              const durationScore = scoreLinear(div!.pivotSpanBars, timeframe === "W" ? 5 : 6, timeframe === "W" ? 20 : 30);
              const magnitudeScore = scoreLinear(Math.abs(div!.priceSwingPct), 2, 15);
              const structureScore = scoreLinear(div!.score, 20, 95);

              const closes = pts.map((p) => p.close).filter((x) => Number.isFinite(x));
              const ma200Arr = movingAverage(closes, 200);
              const lastClose = closes[closes.length - 1];
              const lastMA200 = lastNum(ma200Arr);
              const locationDist =
                typeof lastClose === "number" && typeof lastMA200 === "number" && lastMA200 > 0
                  ? Math.abs(((lastClose - lastMA200) / lastMA200) * 100)
                  : 999;
              const locationScore = scoreInverse(locationDist, 0, 12);

              const reactionLookback = timeframe === "W" ? Math.min(4, weeklyPts.length - 1) : Math.min(5, pts.length - 1);
              const reactionSeries = timeframe === "W" ? weeklyPts : pts;
              const latestClose = reactionSeries[reactionSeries.length - 1]?.close ?? 0;
              const oldClose = reactionSeries[reactionSeries.length - 1 - reactionLookback]?.close ?? latestClose;
              const recentReactionPct = oldClose > 0 ? ((latestClose - oldClose) / oldClose) * 100 : 0;

              let reactionScore = 50;
              if (div!.kind === "bullish") {
                reactionScore = scoreLinear(recentReactionPct, -2, 8);
              } else {
                reactionScore = scoreLinear(-recentReactionPct, -2, 8);
              }

              let penalties = 0;
              if (liquidityScore(pts) < 35) penalties += 20;
              if (Math.abs(div!.priceSwingPct) < 2.5) penalties += 10;
              if (div!.pivotSpanBars < 4) penalties += 8;

              const finalScore =
                timeframeScore * 0.3 +
                durationScore * 0.2 +
                structureScore * 0.2 +
                magnitudeScore * 0.15 +
                locationScore * 0.1 +
                reactionScore * 0.05 -
                penalties;

              return {
                div: div!,
                timeframe,
                score: finalScore,
              };
            });

          const bestDiv = divergenceCandidates.sort((a, b) => b.score - a.score)[0] ?? null;

          if (bestDiv) {
            const preferredIndicator =
              bestDiv.div.hasRsi && !bestDiv.div.hasMacd
                ? "RSI(14)"
                : !bestDiv.div.hasRsi && bestDiv.div.hasMacd
                  ? "MACD(12,26,9)"
                  : bestDiv.div.hasRsi && bestDiv.div.hasMacd
                    ? "MACD(12,26,9)"
                    : undefined;

            const timeframeLabel = bestDiv.timeframe === "W" ? "Weekly" : "Daily";

            divergences.push({
              symbol,
              chartPoints,
              tone: bestDiv.div.kind === "bullish" ? "green" : "red",
              note: `${timeframeLabel} ${bestDiv.div.note} • ${bestDiv.div.priceSwingPct.toFixed(1)}% • ${bestDiv.div.pivotSpanBars} bars`,
              timeframe: bestDiv.timeframe,
              indicator: preferredIndicator,
              dashboardHref: buildDashboardHref({
                symbol,
                timeframe: bestDiv.timeframe,
                indicator: preferredIndicator,
              }),
              _score: bestDiv.score + dynamicBoost(symbol),
            });
          }

          const closes = pts.map((p) => p.close).filter((x) => Number.isFinite(x));
          const ma50Arr = closes.length ? movingAverage(closes, 50) : [];
          const ma200Arr = closes.length ? movingAverage(closes, 200) : [];
          const atrArr = pts.length ? atr(pts, 14) : [];

          const volumeArr: (number | null)[] = pts.map((p) =>
            typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null
          );

          const volSma20Arr = smaNullable(volumeArr, 20);
          const atrSma20Arr = smaNullable(atrArr, 20);

          const lastClose = closes.length ? closes[closes.length - 1] : null;
          const lastMA50 = lastNum(ma50Arr);
          const lastMA200 = lastNum(ma200Arr);
          const lastVol = lastNum(volumeArr);
          const lastVolSma20 = lastNum(volSma20Arr);
          const lastAtr = lastNum(atrArr);
          const lastAtrSma20 = lastNum(atrSma20Arr);

          const oversold = !!oversoldCandidate;
          const overbought = !!overboughtCandidate;
          const buyTheDip = !!athPullback;
          const breakout = !!athBo || !!threeMonthBo;

          const volumeSpike =
            typeof lastVol === "number" &&
            typeof lastVolSma20 === "number" &&
            lastVolSma20 > 0 &&
            lastVol >= lastVolSma20 * 1.8;

          const atrSpike =
            typeof lastAtr === "number" &&
            typeof lastAtrSma20 === "number" &&
            lastAtrSma20 > 0 &&
            lastAtr >= lastAtrSma20 * 1.5;

          const aboveMA50 =
            typeof lastClose === "number" &&
            typeof lastMA50 === "number" &&
            lastClose > lastMA50;

          const belowMA50 =
            typeof lastClose === "number" &&
            typeof lastMA50 === "number" &&
            lastClose < lastMA50;

          const aboveMA200 =
            typeof lastClose === "number" &&
            typeof lastMA200 === "number" &&
            lastClose > lastMA200;

          const belowMA200 =
            typeof lastClose === "number" &&
            typeof lastMA200 === "number" &&
            lastClose < lastMA200;

          const chosenDiv = bestDiv?.div ?? null;

          const bullishRsiDivergence = !!chosenDiv && chosenDiv.kind === "bullish" && chosenDiv.hasRsi;
          const bearishRsiDivergence = !!chosenDiv && chosenDiv.kind === "bearish" && chosenDiv.hasRsi;
          const bullishMacdDivergence = !!chosenDiv && chosenDiv.kind === "bullish" && chosenDiv.hasMacd;
          const bearishMacdDivergence = !!chosenDiv && chosenDiv.kind === "bearish" && chosenDiv.hasMacd;

          const preferredDivergenceIndicator =
            bullishRsiDivergence || bearishRsiDivergence
              ? bullishMacdDivergence || bearishMacdDivergence
                ? "MACD(12,26,9)"
                : "RSI(14)"
              : bullishMacdDivergence || bearishMacdDivergence
                ? "MACD(12,26,9)"
                : undefined;

          const preferredTimeframe: "D" | "W" | undefined =
            preferredDivergenceIndicator && bestDiv ? bestDiv.timeframe : undefined;

          signalRecords.push({
            symbol,
            chartPoints,
            note: comp ? `${comp.flagged}/${comp.total} checks • ${comp.tag}` : undefined,
            tone: comp?.tone,
            oversold,
            overbought,
            buyTheDip,
            breakout,
            volumeSpike,
            atrSpike,
            aboveMA50,
            belowMA50,
            aboveMA200,
            belowMA200,
            dailyMa200Proximity: hasDailyMa200Proximity,
            weeklyMa200Proximity: hasWeeklyMa200Proximity,
            weeklyMa200DistancePct,
            bullishRsiDivergence,
            bearishRsiDivergence,
            bullishMacdDivergence,
            bearishMacdDivergence,
            positiveLastEarnings: !!positiveLastEarningsCandidate,
            strongEarningsGrowth: !!strongEarningsGrowthCandidate,
            preferredTimeframe,
            preferredIndicator: preferredDivergenceIndicator,
            dashboardHref:
              preferredTimeframe && preferredDivergenceIndicator
                ? buildDashboardHref({
                    symbol,
                    timeframe: preferredTimeframe,
                    indicator: preferredDivergenceIndicator,
                  })
                : undefined,
            supportResistanceZone: macroSupportResistanceCandidate
              ? {
                  kind: macroSupportResistanceCandidate.kind,
                  lower: macroSupportResistanceCandidate.zoneLow,
                  upper: macroSupportResistanceCandidate.zoneHigh,
                }
              : undefined,
            dominantOversoldIndicator: comp?.dominantOversoldIndicator,
            dominantOverboughtIndicator: comp?.dominantOverboughtIndicator,
            // The full fired-check lists, alongside the dominant labels that
            // were already here. `comp` is the same object those two read from,
            // so this costs nothing but the two array references.
            oversoldIndicators: comp?.oversoldIndicators,
            overboughtIndicators: comp?.overboughtIndicators,
            // Same story, same fix: trendScore is already computed above for
            // the trendLeaders ranking and was discarded here.
            trendChecks: trendScore
              ? {
                  priceAboveMA200: trendScore.priceAboveMA200,
                  priceAboveMA50: trendScore.priceAboveMA50,
                  ma50AboveMA200: trendScore.ma50AboveMA200,
                  macdBullish: trendScore.macdBullish,
                }
              : undefined,
            isDynamicUniverse: dynamicName,
            isPopularSearch: popularName,
          });
        } catch {
          failedSymbolCount++;
          failedSymbols.push(symbol);
          // Per-symbol failures are expected at low volume (delisted tickers,
          // transient upstream errors); only the aggregate count/ratio is
          // used downstream to detect a systemically degraded build.
        }
      })
    )
  );

  if (failedSymbolCount > 0) {
    const ratio = universe.length > 0 ? failedSymbolCount / universe.length : 0;
    const severity = ratio >= DEGRADED_BUILD_FAILURE_RATIO ? "warn" : "info";

    // Visible in Vercel function logs. Previously these failures were fully
    // silent, which made it impossible to tell a real "no matches" result
    // apart from a build where matching symbols simply failed to fetch.
    console[severity === "warn" ? "warn" : "log"](
      `[pickers] ${failedSymbolCount}/${universe.length} symbols (${(ratio * 100).toFixed(1)}%) failed to fetch usable history this build.` +
        (severity === "warn"
          ? ` Exceeds degraded-build threshold (${(DEGRADED_BUILD_FAILURE_RATIO * 100).toFixed(0)}%). Sample: ${failedSymbols.slice(0, 10).join(", ")}`
          : "")
    );
  }

  // Most sections' chartPoints are byte-identical to this same symbol's
  // signalRecords entry -- both come from the single `chartPoints =
  // buildPickerChartPoints(pts)` computed once per symbol above and threaded
  // into whichever category buckets that symbol qualifies for. Shipping that
  // array again on every section item roughly doubled the payload for no
  // reason (a symbol can land in several sections at once). Consumers now
  // fall back to a signalRecords lookup when an item's chartPoints is absent
  // (see PickerResultPage.tsx's entriesFromSection/buildEntries and the
  // bullish/bearish-divergence-stocks pages), so it's safe to omit here.
  // Weekly MA200 Proximity and Macro Support & Resistance are the exception:
  // their items carry genuinely different weekly-aggregated points (see
  // `weeklyChartPoints` above), so those two keep their own copy via
  // keepChartPoints.
  const takeTop = (arr: PickerItem[], n: number, opts?: { keepChartPoints?: boolean }) => {
    const sorted = [...arr].sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
    return sorted
      .slice(0, n)
      .map(({ symbol, note, tone, timeframe, indicator, dashboardHref, chartPoints, supportResistanceZone, chartFocus, dominantIndicator, firedIndicators, _score, score }) => ({
        symbol,
        note,
        tone,
        timeframe,
        indicator,
        dashboardHref,
        chartPoints: opts?.keepChartPoints ? chartPoints : undefined,
        supportResistanceZone,
        chartFocus,
        dominantIndicator,
        firedIndicators,
        score: typeof score === "number" ? score : typeof _score === "number" ? Math.round(_score) : undefined,
      }));
  };

  const buildSection = (args: {
    title: string;
    description?: string;
    source: PickerItem[];
    take: number;
    keepChartPoints?: boolean;
  }): PickerSection => {
    const items = takeTop(args.source, args.take, { keepChartPoints: args.keepChartPoints });

    return {
      title: args.title,
      description: args.description,
      foundCount: args.source.length,
      shownCount: items.length,
      items,
    };
  };

  const sections: PickerSection[] = [
    buildSection({
      title: "Oversold Stocks Today (Potential Rebound Setups)",
      description:
        "Oversold setups ranked by signal strength, liquidity, move exhaustion and short-term stretch rather than simple raw matches.",
      source: green,
      take: 20,
    }),
    buildSection({
      title: "Best Trend Score Stocks",
      description:
        "Stocks with the strongest current trend structure based on price vs MA50 and MA200, MA50 vs MA200, and positive MACD momentum.",
      source: trendLeaders,
      take: 20,
    }),
    buildSection({
      title: "Stocks With Positive Last Earnings",
      description:
        "Stocks ranked by the latest reported earnings beat, using EPS surprise, revenue surprise, positive EPS and report freshness.",
      source: positiveLastEarnings,
      take: 20,
    }),
    buildSection({
      title: "Stocks With Strong Earnings Growth",
      description:
        "Stocks ranked by year-over-year EPS and revenue growth, recent positive earnings consistency and beat history.",
      source: strongEarningsGrowth,
      take: 20,
    }),
    buildSection({
      title: "Daily MA200 Proximity",
      description:
        "Stocks trading close to their Daily MA200, with ranking favouring constructive MA200 behaviour over messy long-term weakness.",
      source: dailyMa200Proximity,
      take: 20,
    }),
    buildSection({
      title: "Weekly MA200 Proximity",
      description:
        "Stocks trading close to their Weekly MA200, with ranking favouring constructive MA200 behaviour over messy long-term weakness.",
      source: weeklyMa200Proximity,
      take: 20,
      // Weekly-aggregated points, distinct from this symbol's daily
      // signalRecords chartPoints -- can't be deduped against it.
      keepChartPoints: true,
    }),
    buildSection({
      title: "Macro Support and Resistance Stocks",
      description:
        "Stocks near wider weekly support or resistance zones, ranked by repeated touches, distance to the zone, structure length and volume traded around the level.",
      source: macroSupportResistance,
      take: 20,
      // Weekly-aggregated points, distinct from this symbol's daily
      // signalRecords chartPoints -- can't be deduped against it.
      keepChartPoints: true,
    }),
    buildSection({
      title: "Overbought Stocks Today (Potential Pullback Setups)",
      description:
        "Overbought setups ranked by signal strength, liquidity, extension and short-term stretch rather than simple raw matches.",
      source: red,
      take: 20,
    }),
    buildSection({
      title: "Bullish & Bearish Divergence Stocks (RSI & MACD Signals)",
      description:
        "Divergences ranked by timeframe, duration, structure quality, magnitude and location context. Clicking a result opens the strongest divergence view.",
      source: divergences,
      take: 20,
    }),
    buildSection({
      title: "Stocks Down 20% From All-Time Highs",
      description:
        "Stocks at least 20% below their all-time highs, ranked to favour liquid, tradable pullbacks over weak broken charts.",
      source: dips,
      take: 20,
    }),
    buildSection({
      title: "All-Time High Breakout Stocks",
      description:
        "Stocks trading at or very near all-time closing highs, ranked by breakout recency, liquidity and breakout quality.",
      source: athBreakouts,
      take: 20,
    }),
    buildSection({
      title: "3-Month High Breakout Stocks",
      description:
        "Stocks breaking above their highest closing level from the last 3 months, ranked by breakout recency, liquidity and breakout quality.",
      source: threeMonthBreakouts,
      take: 20,
    }),
  ];

  // Ship the FULL analyzed universe in signalRecords so the All Stocks screener
  // (/stock-screener) and the preset condition pages can show every symbol.
  // Previously this was trimmed to just section members, which silently dropped
  // the mega-caps (AAPL, NVDA, AMZN, GOOGL, META, ...) -- they're in the
  // analyzed universe but don't always land in a section's top-20, so sorting
  // All Stocks by market cap showed MSFT/LLY/MU at the top with the true giants
  // missing entirely.
  //
  // chartPoints used to be stripped here for any symbol outside a section's
  // top 20 (114 of 260 on 2026-08-04), so those symbols' chart-view cards
  // rendered "Chart preview unavailable" -- and *which* 114 changed every
  // rebuild as section membership shifted, reading as random breakage. Now
  // that section items no longer carry their own duplicate chartPoints copy
  // (see buildSection/takeTop above -- that alone freed more than this
  // costs), every signalRecords entry ships its chartPoints and every card
  // gets a real chart. writePickersCache's reduced-payload fallback (see
  // buildReducedPickersPayload) is the safety net if this ever pushes the
  // payload over Upstash's 10MB Max Request Size.
  const fullSignalRecords = signalRecords;

  // Homepage dashboard scrolling ticker: a handful of candidates per
  // category, ranked here so the client doesn't need a second fetch or
  // its own re-derivation of "top movers" / "recent earnings growth".
  // Weekly MA200 proximity and buy-signal counts are cheap to derive
  // client-side from filteredSignalRecords, so they aren't duplicated here.
  const topMoversForTicker = topMoversRaw
    .filter((row) => typeof row.changePct === "number" && Number.isFinite(row.changePct))
    .slice(0, 8);

  const earningsGrowthForTicker: TickerEarningsGrowthItem[] = strongEarningsGrowth
    .filter((item) => !!item.releaseDate)
    .slice()
    .sort((a, b) => {
      const ad = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
      const bd = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
      return bd - ad;
    })
    .slice(0, 8)
    .map((item) => ({
      symbol: item.symbol,
      epsGrowthPct: item.epsGrowthPct ?? null,
      revenueGrowthPct: item.revenueGrowthPct ?? null,
      releaseDate: item.releaseDate ?? null,
      tone: item.tone ?? "green",
    }));

  // Build duration is the number that decides how far UNIVERSE_CAP can go. It
  // was previously never logged, so there was no way to tell a comfortable build
  // from one about to hit the function limit -- both just return a payload.
  console.log(
    `[pickers] build complete: universe ${universe.length}, ` +
      `${signalRecords.length} records, ${failedSymbolCount} failed, ` +
      `${Date.now() - buildStartedAt}ms`
  );

  return {
    updatedAt: new Date().toISOString(),
    universeSize: universe.length,
    dynamicUniverseCount:
      typeof market?.dynamicUniverseSize === "number"
        ? market.dynamicUniverseSize
        : dynamicUniverse.length,
    dynamicUniversePreview: dynamicUniverse.slice(0, 20),
    dynamicSymbols: dynamicUniverse,
    estimatedApiCalls: process.env.FMP_API_KEY ? universe.length * 2 + 1 : universe.length + 1,
    sections,
    signalRecords: fullSignalRecords,
    tickerFeed: {
      topMovers: topMoversForTicker,
      earningsGrowth: earningsGrowthForTicker,
    },
    degradedSymbolCount: failedSymbolCount,
    degradedSymbolPct: universe.length > 0 ? Number(((failedSymbolCount / universe.length) * 100).toFixed(1)) : 0,
  };
}

/* -------------------------------- GET -------------------------------- */

// In-process equivalent of the GET handler below: returns the pickers payload
// using the same in-memory memo + Redis cache + build lock, WITHOUT any HTTP
// round trip. Server components (app/components/PickerResultPage.tsx) call this
// directly, so a picker page render never has to fetch the site's own
// /api/pickers over the network -- removing a self-request that our own Vercel
// firewall/bot rules would otherwise treat as an anonymous bot and block. It
// shares memo/cache/lock with GET (same module), so the public endpoint and
// SSR stay perfectly consistent.
/* ------------------- structure-mode diagnostics (debug) ------------------ */

export type PickerStructureRow = {
  symbol: string;
  closes: number;
  /** null when buildTrendScoreFromHistory refused: fewer than 220 usable closes. */
  trendScoreNull: boolean;
  source: "preset" | "popular-search" | "dynamic";
  oversold: { live: number | null; waived: number | null; penalised: number | null };
  overbought: { live: number | null; waived: number | null; penalised: number | null };
};

/**
 * Prices the three structure modes against the real universe.
 *
 * READ-ONLY. buildPickersPayload's own universe assembly calls
 * addToDynamicUniverse() as a side effect; this does not, so running the
 * diagnostic never alters what the next build sees. It reads the same three
 * sources in the same priority order, so membership matches a build's universe
 * except for that write.
 *
 * Scores come from computeOversoldCandidate/computeOverboughtCandidate -- the
 * functions that actually ship -- called three times per symbol with different
 * modes. Nothing here reimplements the composite.
 */
export async function buildPickerStructureDiagnostics() {
  const presetSet = new Set(PRESET_UNIVERSE);

  const dynamicEntries = await readDynamicUniverse();
  const dynamicUniverse = dynamicEntries.map((e) => String(e.symbol).trim().toUpperCase());
  const dynamicSet = new Set(dynamicUniverse);

  let popularSearchSymbols: string[] = [];
  try {
    const demand = await readSearchDemand(POPULAR_SEARCH_QUOTA * 4);
    popularSearchSymbols = demand
      .filter((d) => d.score >= POPULAR_SEARCH_MIN_SCORE)
      .map((d) => String(d.symbol).trim().toUpperCase())
      .filter((sym) => sym && !presetSet.has(sym))
      .slice(0, POPULAR_SEARCH_QUOTA);
  } catch {
    popularSearchSymbols = [];
  }
  const popularSet = new Set(popularSearchSymbols);

  const slots = new Set<string>();
  const fill = (symbols: string[], max: number) => {
    let added = 0;
    for (const raw of symbols) {
      if (slots.size >= UNIVERSE_CAP || added >= max) break;
      const sym = String(raw).trim().toUpperCase();
      if (!sym || slots.has(sym)) continue;
      slots.add(sym);
      added++;
    }
  };
  fill(PRESET_UNIVERSE, PRESET_UNIVERSE.length);
  fill(popularSearchSymbols, POPULAR_SEARCH_QUOTA);
  fill(dynamicUniverse, UNIVERSE_CAP);
  const universe = Array.from(slots);

  const historyBySymbol = await getDailyHistoryBulk(universe);
  const boost = (sym: string) => (dynamicSet.has(sym) ? 10 : 0) + (popularSet.has(sym) ? 10 : 0);

  const rows: PickerStructureRow[] = [];
  for (const symbol of universe) {
    const pts = normalizeHistory(historyBySymbol.get(symbol) ?? [], 1300);
    const closes = pts.map((pt) => pt.close).filter((x) => Number.isFinite(x)).length;
    const comp = buildCompositeFromHistory(pts);
    const trendScore = buildTrendScoreFromHistory(pts);
    const b = boost(symbol);
    const os = (mode: StructureMode) => {
      const c = computeOversoldCandidate(pts, comp, trendScore, mode);
      return c ? c.score + b : null;
    };
    const ob = (mode: StructureMode) => {
      const c = computeOverboughtCandidate(pts, comp, trendScore, mode);
      return c ? c.score + b : null;
    };
    rows.push({
      symbol,
      closes,
      trendScoreNull: trendScore === null,
      source: presetSet.has(symbol) ? "preset" : popularSet.has(symbol) ? "popular-search" : "dynamic",
      oversold: { live: os("live"), waived: os("no-structure-waived"), penalised: os("no-structure-penalised") },
      overbought: { live: ob("live"), waived: ob("no-structure-waived"), penalised: ob("no-structure-penalised") },
    });
  }

  // Rank within each list/mode, highest score first, exactly as the builder
  // sorts. A symbol absent from a list has no rank in that mode.
  const rankOf = (list: "oversold" | "overbought", mode: "live" | "waived" | "penalised") => {
    const ranked = rows
      .filter((r) => r[list][mode] !== null)
      .sort((a, b2) => (b2[list][mode] as number) - (a[list][mode] as number))
      .map((r) => r.symbol);
    const map = new Map<string, number>();
    ranked.forEach((sym, i) => map.set(sym, i + 1));
    return map;
  };

  const build = (list: "oversold" | "overbought") => {
    const live = rankOf(list, "live");
    const waived = rankOf(list, "waived");
    const penalised = rankOf(list, "penalised");
    return rows
      .filter((r) => live.has(r.symbol) || waived.has(r.symbol) || penalised.has(r.symbol))
      .map((r) => ({
        symbol: r.symbol,
        closes: r.closes,
        trendScoreNull: r.trendScoreNull,
        source: r.source,
        rankLive: live.get(r.symbol) ?? null,
        rankNoStructureWaived: waived.get(r.symbol) ?? null,
        rankNoStructurePenalised: penalised.get(r.symbol) ?? null,
        scoreLive: r[list].live === null ? null : Number((r[list].live as number).toFixed(2)),
        scoreNoStructureWaived: r[list].waived === null ? null : Number((r[list].waived as number).toFixed(2)),
        scoreNoStructurePenalised: r[list].penalised === null ? null : Number((r[list].penalised as number).toFixed(2)),
        rankDeltaPenalised:
          live.get(r.symbol) != null && penalised.get(r.symbol) != null
            ? (penalised.get(r.symbol) as number) - (live.get(r.symbol) as number)
            : null,
      }))
      .sort((a, b2) => (a.rankLive ?? 9999) - (b2.rankLive ?? 9999));
  };

  const thin = rows.filter((r) => r.trendScoreNull);
  const scorable = rows.filter((r) => r.closes >= 60);

  return {
    universeSize: universe.length,
    withHistory: rows.filter((r) => r.closes > 0).length,
    // The band where the composites run (>= 60 closes) but the trend score
    // refuses (< 220). This is the population the whole question is about.
    scorableCount: scorable.length,
    trendScoreNullCount: thin.length,
    affectedBand: scorable.filter((r) => r.trendScoreNull).length,
    affectedBandSymbols: scorable
      .filter((r) => r.trendScoreNull)
      .map((r) => ({ symbol: r.symbol, closes: r.closes, source: r.source }))
      .sort((a, b2) => a.closes - b2.closes),
    oversold: build("oversold"),
    overbought: build("overbought"),
  };
}

/* ---------------- jitter instrument (debug) ---------------- */

// Does the published ordering survive an ordinary price tick?
//
// The composite orders only 20 stocks per section (`take: 20` in the two
// buildSection calls below), and rank 20 sits in the flattest part of the score
// distribution -- adjacent gaps there have a median of 0.20 on a ~100-point
// scale, against a smallest discrete step of 0.90. So the boundary between the
// badged, ordered block and the unranked tail is decided in the noisiest region
// of the range. This measures whether that boundary is stable.
//
// Deterministic: mulberry32 seeded from the request, so the same seed produces
// the same result and a finding can be re-run and audited. No Math.random, no
// Date.now.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The perturbation is applied to the LAST BAR'S CLOSE and everything is
// recomputed downstream. lastClose is not a single input: it feeds RSI through
// the closes series, Bollinger position, EMA20 and MA50 distance, dailyDrop1,
// dailyDrop5, avgAbsMove and dollar volume in liquidityScore. Perturbing a
// derived scalar would understate the effect. high/low are clamped so the bar
// stays internally consistent.
function jitterLastBar(pts: Point[], fraction: number): Point[] {
  if (!pts.length) return pts;
  const out = pts.slice();
  const last = out[out.length - 1];
  const close = last.close * (1 + fraction);
  out[out.length - 1] = {
    ...last,
    close,
    high: typeof last.high === "number" ? Math.max(last.high, close) : last.high,
    low: typeof last.low === "number" ? Math.min(last.low, close) : last.low,
  };
  return out;
}

type JitterRow = { symbol: string; pts: Point[]; boost: number; volPct: number };

function rankMap(scored: { symbol: string; score: number }[]) {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const m = new Map<string, number>();
  sorted.forEach((r, i) => m.set(r.symbol, i + 1));
  return m;
}

// Kendall tau-b over the symbols present in both orderings.
function kendallTauB(a: Map<string, number>, b: Map<string, number>) {
  const syms = [...a.keys()].filter((s) => b.has(s));
  let concordant = 0, discordant = 0;
  for (let i = 0; i < syms.length; i++) {
    for (let j = i + 1; j < syms.length; j++) {
      const da = (a.get(syms[i]) as number) - (a.get(syms[j]) as number);
      const db = (b.get(syms[i]) as number) - (b.get(syms[j]) as number);
      const s = Math.sign(da) * Math.sign(db);
      if (s > 0) concordant++;
      else if (s < 0) discordant++;
    }
  }
  const n = concordant + discordant;
  return n ? Number(((concordant - discordant) / n).toFixed(6)) : null;
}

function summarise(deltas: number[]) {
  const abs = deltas.map(Math.abs).sort((x, y) => x - y);
  const at = (q: number) => (abs.length ? abs[Math.min(abs.length - 1, Math.floor(q * abs.length))] : 0);
  const bucket = (lo: number, hi: number) => abs.filter((d) => d >= lo && d <= hi).length;
  return {
    n: abs.length,
    median: at(0.5),
    p90: at(0.9),
    max: abs.length ? abs[abs.length - 1] : 0,
    histogram: { "0": bucket(0, 0), "1": bucket(1, 1), "2": bucket(2, 2), "3-4": bucket(3, 4), "5-9": bucket(5, 9), "10+": abs.filter((d) => d >= 10).length },
  };
}

export async function buildPickerJitterDiagnostics(opts: {
  trials: number;
  seed: number;
  bps: number;
  mode: "all" | "each";
  scaled: boolean;
}) {
  const presetSet = new Set(PRESET_UNIVERSE);
  const dynamicEntries = await readDynamicUniverse();
  const dynamicUniverse = dynamicEntries.map((e) => String(e.symbol).trim().toUpperCase());
  const dynamicSet = new Set(dynamicUniverse);

  let popularSearchSymbols: string[] = [];
  try {
    const demand = await readSearchDemand(POPULAR_SEARCH_QUOTA * 4);
    popularSearchSymbols = demand
      .filter((d) => d.score >= POPULAR_SEARCH_MIN_SCORE)
      .map((d) => String(d.symbol).trim().toUpperCase())
      .filter((sym) => sym && !presetSet.has(sym))
      .slice(0, POPULAR_SEARCH_QUOTA);
  } catch {
    popularSearchSymbols = [];
  }
  const popularSet = new Set(popularSearchSymbols);

  const slots = new Set<string>();
  const fill = (symbols: string[], max: number) => {
    let added = 0;
    for (const raw of symbols) {
      if (slots.size >= UNIVERSE_CAP || added >= max) break;
      const sym = String(raw).trim().toUpperCase();
      if (!sym || slots.has(sym)) continue;
      slots.add(sym);
      added++;
    }
  };
  fill(PRESET_UNIVERSE, PRESET_UNIVERSE.length);
  fill(popularSearchSymbols, POPULAR_SEARCH_QUOTA);
  fill(dynamicUniverse, UNIVERSE_CAP);
  const universe = Array.from(slots);

  const historyBySymbol = await getDailyHistoryBulk(universe);
  const rows: JitterRow[] = universe.map((symbol) => {
    const pts = normalizeHistory(historyBySymbol.get(symbol) ?? [], 1300);
    return {
      symbol,
      pts,
      boost: (dynamicSet.has(symbol) ? 10 : 0) + (popularSet.has(symbol) ? 10 : 0),
      volPct: recentVolatilityPct(pts, 20),
    };
  });

  // Both lists, scored the way the builder scores them.
  const scoreList = (list: "oversold" | "overbought", pts: Point[], row: JitterRow) => {
    const comp = buildCompositeFromHistory(pts);
    const trendScore = buildTrendScoreFromHistory(pts);
    const c =
      list === "oversold"
        ? computeOversoldCandidate(pts, comp, trendScore)
        : computeOverboughtCandidate(pts, comp, trendScore);
    return c ? c.score + row.boost : null;
  };

  const baselineOf = (list: "oversold" | "overbought") => {
    const scored: { symbol: string; score: number }[] = [];
    for (const row of rows) {
      const v = scoreList(list, row.pts, row);
      if (v !== null) scored.push({ symbol: row.symbol, score: v });
    }
    return scored;
  };

  // `bps` is 10 by default: 0.1% of last close. Grounded rather than picked --
  // recentVolatilityPct(pts, 20) is the 20-day mean absolute daily move, which
  // for these names typically runs 1.2-2%, so 0.1% is roughly a fifteenth of one
  // ordinary day's range: minutes of trading, smaller than any news. It is
  // deliberately the FLOOR. `scaled` instead jitters each symbol by 5% of its
  // own volPct, which is fairer across volatility regimes; the two are reported
  // side by side because a disagreement between them is itself a finding about
  // which names are fragile.
  const fractionFor = (row: JitterRow, rnd: () => number) => {
    const magnitude = opts.scaled ? (row.volPct / 100) * 0.05 : opts.bps / 10000;
    return (rnd() < 0.5 ? -1 : 1) * magnitude;
  };

  const SECTION_TAKE = 20; // pickersBuilder's own take for both sections
  const PAGE_CAP = 36;     // maxItems on the two screener pages

  const runList = (list: "oversold" | "overbought") => {
    const base = baselineOf(list);
    const baseRank = rankMap(base);
    const inTop = (m: Map<string, number>, n: number, sym: string) => (m.get(sym) ?? Infinity) <= n;

    const perTrial: {
      seed: number;
      tau: number | null;
      deltas: ReturnType<typeof summarise>;
      cut20: { entered: string[]; left: string[] };
      cut36: { entered: string[]; left: string[] };
      top10Changed: number;
    }[] = [];
    const pooled: number[] = [];
    // In `each` mode the pooled distribution is dominated by the symbols that
    // were deliberately held still, so its median is 0 by construction and says
    // nothing. Track the PERTURBED symbol's own movement separately -- that is
    // the quantity `each` exists to measure.
    const targetDeltas: { symbol: string; delta: number }[] = [];

    for (let t = 0; t < opts.trials; t++) {
      const seed = opts.seed + t;
      const rnd = mulberry32(seed);
      const scored: { symbol: string; score: number }[] = [];
      let targetSymbol: string | null = null;

      if (opts.mode === "all") {
        // Every symbol ticks independently -- what actually happens between two
        // page loads. A uniform same-sign move was considered and rejected:
        // these scores are largely functions of ratios and distances, so a
        // correlated move barely disturbs relative order and would produce a
        // reassuring number that means nothing.
        for (const row of rows) {
          const v = scoreList(list, jitterLastBar(row.pts, fractionFor(row, rnd)), row);
          if (v !== null) scored.push({ symbol: row.symbol, score: v });
        }
      } else {
        // One symbol at a time, competitors frozen: attributes a rank change to
        // a stock's OWN move. Only the perturbed symbol is rescored.
        //
        // base can be empty -- a list with no qualifying candidates is a real
        // state, and `t % 0` is NaN, which indexed to undefined and threw. Found
        // by running the instrument against a synthetic universe where every
        // stock was oversold-biased, so the overbought list came back empty.
        const target = base.length ? base[t % base.length] : null;
        targetSymbol = target ? target.symbol : null;
        const row = target ? rows.find((r) => r.symbol === target.symbol) : undefined;
        for (const b of base) {
          if (!target || !row || b.symbol !== target.symbol) { scored.push(b); continue; }
          const v = scoreList(list, jitterLastBar(row.pts, fractionFor(row, rnd)), row);
          if (v !== null) scored.push({ symbol: b.symbol, score: v });
        }
      }

      const jitRank = rankMap(scored);
      const deltas: number[] = [];
      for (const [sym, r] of baseRank) {
        const j = jitRank.get(sym);
        if (j != null) deltas.push(j - r);
      }
      pooled.push(...deltas);
      if (targetSymbol) {
        const before = baseRank.get(targetSymbol), after = jitRank.get(targetSymbol);
        if (before != null && after != null) targetDeltas.push({ symbol: targetSymbol, delta: after - before });
      }

      const syms = [...baseRank.keys()];
      const cross = (n: number) => ({
        entered: syms.filter((s) => !inTop(baseRank, n, s) && inTop(jitRank, n, s)).sort(),
        left: syms.filter((s) => inTop(baseRank, n, s) && !inTop(jitRank, n, s)).sort(),
      });

      perTrial.push({
        seed,
        tau: kendallTauB(baseRank, jitRank),
        deltas: summarise(deltas),
        cut20: cross(SECTION_TAKE),
        cut36: cross(PAGE_CAP),
        top10Changed: syms.filter((s) => inTop(baseRank, 10, s) !== inTop(jitRank, 10, s)).length,
      });
    }

    const c20 = perTrial.reduce((a, t) => a + t.cut20.left.length, 0);
    const c36 = perTrial.reduce((a, t) => a + t.cut36.left.length, 0);
    return {
      listSize: base.length,
      sectionTake: SECTION_TAKE,
      pageCap: PAGE_CAP,
      // Named, not just counted: "SATA and MICC swap in and out of the badged
      // block on a 0.1% tick" is checkable; "0.8 crossings per trial" is not.
      cut20CrossingsByName: Array.from(
        new Set(perTrial.flatMap((t) => [...t.cut20.entered, ...t.cut20.left]))
      ).sort(),
      cut36CrossingsByName: Array.from(
        new Set(perTrial.flatMap((t) => [...t.cut36.entered, ...t.cut36.left]))
      ).sort(),
      cut20CrossingsPerTrial: Number((c20 / Math.max(1, opts.trials)).toFixed(3)),
      cut36CrossingsPerTrial: Number((c36 / Math.max(1, opts.trials)).toFixed(3)),
      pooled: summarise(pooled),
      // Only populated in mode=each. Read this instead of `pooled` there.
      perturbedSymbolMovement: targetDeltas.length
        ? {
            summary: summarise(targetDeltas.map((d) => d.delta)),
            moved: targetDeltas.filter((d) => d.delta !== 0).map((d) => `${d.symbol} ${d.delta > 0 ? "+" : ""}${d.delta}`),
          }
        : null,
      medianTau: (() => {
        const t = perTrial.map((x) => x.tau).filter((x): x is number => x != null).sort((a, b) => a - b);
        return t.length ? t[Math.floor(t.length / 2)] : null;
      })(),
      trials: perTrial,
    };
  };

  const oversold = runList("oversold");
  const overbought = runList("overbought");

  // Stated so a clean jitter result cannot be read as "the ordering is sound".
  const limits = [
    "Measures sensitivity to price jitter only. It cannot detect the async tie-break instability: takeTop sorts stably and green/red are pushed from inside pLimit(10) callbacks, so equal scores are ordered by which Redis read finished first, which is a property of build timing rather than of inputs. That stays established by code reading.",
    "A uniform same-sign move across all symbols was considered and rejected: these scores are largely ratios and distances, so a correlated move barely disturbs relative order and would look reassuring while measuring nothing.",
  ];

  const preRegistered = {
    smallestDiscreteStep: 0.9,
    note: "comp.flagged contributes 3 points to oversoldStrength, weighted 0.3 -> 0.90 composite points. Any median |delta-rank| driven by gaps below this is moving stocks across differences smaller than the smallest real signal the composite can express.",
    readings: [
      "median |delta-rank| >= 3 AND >= 1 cut-20 crossing per trial: ordering below the top ten does not carry information at published resolution",
      "median |delta-rank| <= 1 AND cut-20 crossings ~ 0: ordering is robust and the density concern is theoretical",
      "anything between: report the numbers and claim nothing",
    ],
  };

  return {
    params: { ...opts, magnitude: opts.scaled ? "5% of each symbol's 20-day mean absolute daily move" : `${opts.bps} bps (${opts.bps / 100}%) of last close` },
    universeSize: universe.length,
    preRegistered,
    limits,
    oversold,
    overbought,
  };
}

export async function getPickersData(
  origin: string,
  opts: { forceRefresh?: boolean } = {}
): Promise<PickersPayload> {
  const forceRefresh = opts.forceRefresh ?? false;
  const now = Date.now();

  if (!forceRefresh && memo && now - memo.ts < MEMORY_CACHE_MS) {
    return memo.data;
  }

  const cached = forceRefresh ? null : await readPickersCache();

  if (!forceRefresh && cached?.data) {
    memo = { ts: now, data: cached.data };
    return cached.data;
  }

  const lockToken = await acquirePickersLock();

  if (!lockToken && cached?.data) {
    memo = { ts: now, data: cached.data };
    return cached.data;
  }

  try {
    const data = await buildPickersPayload(origin, forceRefresh);

    const isDegraded =
      typeof data.degradedSymbolPct === "number" &&
      data.degradedSymbolPct / 100 >= DEGRADED_BUILD_FAILURE_RATIO;

    if (isDegraded && cached?.data && !forceRefresh) {
      console.warn(
        `[pickers] Build degraded (${data.degradedSymbolPct}% symbol failure) -- serving last known-good cache instead.`
      );
      memo = { ts: now, data: cached.data };
      return cached.data;
    }

    memo = { ts: now, data };
    await writePickersCache(data, () => buildReducedPickersPayload(data));
    return data;
  } catch (error) {
    if (cached?.data) {
      memo = { ts: now, data: cached.data };
      return cached.data;
    }
    throw error instanceof Error ? error : new Error("Unknown pickers error");
  } finally {
    await releasePickersLock(lockToken);
  }
}

export async function GET(req: NextRequest) {
  const now = Date.now();
  const forceRequested = req.nextUrl.searchParams.get("force") === "1";

  let forceRefresh = false;

  if (forceRequested) {
    const ip = getClientIp(req);
    const lockout = await checkBackfillLockout(ip);

    if (lockout.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lockout.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(lockout.retryAfterSeconds) } }
      );
    }

    const key = req.nextUrl.searchParams.get("key") ?? "";

    if (checkBackfillKey(key)) {
      await clearBackfillFailures(ip);
      forceRefresh = true;
    } else {
      await recordBackfillFailure(ip);
      // Falls through with forceRefresh left false -- serves the normal
      // cached response instead of denying the request outright.
    }
  }

  if (!forceRefresh && memo && now - memo.ts < MEMORY_CACHE_MS) {
    return NextResponse.json(memo.data, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  }

  const cached = forceRefresh ? null : await readPickersCache();

  if (!forceRefresh && cached?.data) {
    memo = { ts: now, data: cached.data };

    return NextResponse.json(cached.data, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  }

  const lockToken = await acquirePickersLock();

  if (!lockToken && cached?.data) {
    memo = { ts: now, data: cached.data };

    return NextResponse.json(cached.data, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  }

  try {
    const origin = originFromReq(req);
    const data = await buildPickersPayload(origin, forceRefresh);

    // If this build looks systemically degraded (a large share of the
    // universe failed to fetch), prefer the last known-good cache over
    // publishing a thin payload that could silently zero out sections like
    // ATH breakouts even when real matches exist. Falls through to the
    // fresh (degraded) data only if no usable cache is available.
    const isDegraded =
      typeof data.degradedSymbolPct === "number" &&
      data.degradedSymbolPct / 100 >= DEGRADED_BUILD_FAILURE_RATIO;

    if (isDegraded && cached?.data && !forceRefresh) {
      console.warn(
        `[pickers] Build degraded (${data.degradedSymbolPct}% symbol failure) — serving last known-good cache instead.`
      );

      memo = { ts: now, data: cached.data };

      return NextResponse.json(cached.data, {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
          "X-Pickers-Degraded-Fallback": "true",
        },
      });
    }

    memo = { ts: now, data };
    await writePickersCache(data, () => buildReducedPickersPayload(data));

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": forceRefresh
          ? "no-store"
          : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  } catch (error) {
    if (cached?.data) {
      memo = { ts: now, data: cached.data };

      return NextResponse.json(cached.data, {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
        },
      });
    }

    const message =
      error instanceof Error ? error.message : "Unknown pickers error";

    return NextResponse.json(
      {
        updatedAt: new Date().toISOString(),
        universeSize: 0,
        dynamicUniverseCount: 0,
        dynamicUniversePreview: [],
        dynamicSymbols: [],
        estimatedApiCalls: 0,
        sections: [],
        signalRecords: [],
        tickerFeed: { topMovers: [], earningsGrowth: [] },
        error: message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } finally {
    await releasePickersLock(lockToken);
  }
}
