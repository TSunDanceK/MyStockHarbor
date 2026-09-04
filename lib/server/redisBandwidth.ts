// Byte accounting for REDIS, alongside the FMP meter in fmpUsage.ts.
//
// WHY THIS EXISTS, AND WHY IT IS THE METER THAT WAS MISSING.
//
// The Upstash plan meters BANDWIDTH. Commands are unlimited on it -- so the
// 17M -> 338k command reduction of #414/#415 bought real latency and real
// safety and bought NOTHING against the limit that binds. Owner's figures:
//
//   2026-09-01   5 GB      2026-09-02   9 GB      2026-09-03   6 GB
//   average 6.67 GB/day  ->  ~207 GB/month against a 200 GB cap
//
// FMP, the meter we DO have, sat at 11.4% of its cap over the same window. The
// unmeasured limit was the one at 100%, which is the identical shape as
// fmpUsage.ts's own opening note one file over: a plausible number reasoned out
// from constants is the thing that stops people looking.
//
// SHAPE
//   msh:redis-units:v1:<YYYYMMDD>   Redis HASH, one per UTC day, 31-day TTL
//     <source>:units    symbols (or payloads) moved by that source
//     <source>:reads    how many times the source ran
//
// UNITS, NOT BYTES, AND THAT IS DELIBERATE. Measuring the real byte size means
// JSON.stringify-ing the value we just read -- an 8 MB serialisation on a hot
// render path, to measure a read. So the counter records the SHAPE (how many
// symbols) and the bytes are derived from a per-unit constant that was measured
// once, offline, from the code that writes the value. The constants below carry
// the date and the method that produced them, for the same reason
// EARNINGS_PEAK_DAY_SHARE does: a bare number with no history is exactly as bad
// as a typed one.
//
// THE COST OF THE METER: one HINCRBY pipeline per instrumented read. On a plan
// where commands are unlimited and bandwidth is the cap, that is free in the
// dimension that matters -- which is the whole point of the file.

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { ANALYSIS_UNIVERSE_CAP } from "./dynamicUniverseCache";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const UNITS_KEY_PREFIX = "msh:redis-units:v1:";
const UNITS_TTL_SECONDS = 31 * 24 * 60 * 60;

/** The Upstash plan's monthly bandwidth allowance. */
export const REDIS_BANDWIDTH_CAP_BYTES = 200 * 1024 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// THE MEASURED PER-UNIT CONSTANTS.
//
// Method, so the next person can redo it rather than trust it:
// scripts/check-redis-bandwidth.mjs RE-DERIVES every figure below by building
// the exact structures these modules write -- field set, rounding and bar count
// read out of the source, not typed -- and serialising them. It fails if a
// constant here drifts from what the code would actually produce. So these are
// not estimates that go stale silently; they are measurements the build checks.
//
// Cross-check against the only live figure available: pickerChartsCache's own
// header records avgChartChars = 11,016 measured in production on 2026-08-06.
// The re-derivation lands at 10,963 -- 0.5% apart. The shape reconstruction is
// therefore representative, which is what makes the rest of this trustworthy.
// ─────────────────────────────────────────────────────────────────────────────

/** One symbol's 72-bar enriched series in the picker-charts hash. */
export const BYTES_PER_SYMBOL_PICKER_CHARTS = 10_963;
/**
 * One symbol's non-chart share of the stripped pickers payload.
 *
 * NOT RE-DERIVED BY THE CHECK, unlike the two either side of it, and labelled
 * so rather than left to look equally solid. A signalRecord's field set is
 * assembled across ~30 code paths in a 112KB builder, so reconstructing it
 * would be reconstructing the builder. This figure is the residual from the
 * 2026-08-06 production split (payloadChars 3,382,852 less 260 x 11,016 of
 * charts, over 260 symbols) and it is the weakest number in this file. It is
 * also ~15% of the picker term and ~5% of the bill, so being 20% wrong about it
 * moves nothing that matters.
 */
export const BYTES_PER_SYMBOL_PICKER_PAYLOAD = 2_000;
/** One symbol's stored daily history entry: ~1,188 bars of OHLCV. */
export const BYTES_PER_SYMBOL_HISTORY = 109_962;
/**
 * One symbol's price-pool row. ALSO NOT RE-DERIVED, and the least important
 * figure here by three orders of magnitude -- under 1% of the bill. It is
 * metered anyway because a ranking whose smallest entry is assumed rather than
 * counted has an assumption in it, and this read runs every five minutes.
 */
export const BYTES_PER_SYMBOL_PRICE_POOL = 220;

export const BYTES_MEASURED_AT = "2026-09-04";
export const BYTES_MEASURED_BY =
  "scripts/check-redis-bandwidth.mjs, re-derived from the writing modules' own " +
  "field sets and bar counts; cross-checked against pickerChartsCache's live " +
  "2026-08-06 avgChartChars of 11,016 (0.5% apart)";

export type RedisReadSource =
  | "picker-payload"
  | "picker-charts"
  | "history-bulk"
  | "price-pool";

const BYTES_PER_UNIT: Record<RedisReadSource, number> = {
  "picker-payload": BYTES_PER_SYMBOL_PICKER_PAYLOAD,
  "picker-charts": BYTES_PER_SYMBOL_PICKER_CHARTS,
  "history-bulk": BYTES_PER_SYMBOL_HISTORY,
  "price-pool": BYTES_PER_SYMBOL_PRICE_POOL,
};

export const REDIS_READ_SOURCES = Object.keys(BYTES_PER_UNIT) as RedisReadSource[];

function dayKey(nowMs = Date.now()) {
  return `${UNITS_KEY_PREFIX}${new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "")}`;
}

/**
 * Record that `units` symbols were read from `source`.
 *
 * Fails open and silent: a meter that can break the thing it measures is worse
 * than no meter. One pipeline, two HINCRBYs and an EXPIRE.
 */
export async function recordRedisRead(source: RedisReadSource, units: number): Promise<void> {
  if (!redis || !Number.isFinite(units) || units <= 0) return;
  try {
    const key = dayKey();
    const p = redis.pipeline();
    p.hincrby(key, `${source}:units`, Math.round(units));
    p.hincrby(key, `${source}:reads`, 1);
    p.expire(key, UNITS_TTL_SECONDS);
    await p.exec();
  } catch {
    // bookkeeping -- never throws into a render path
  }
}

export type RedisBandwidthRow = {
  source: RedisReadSource;
  units: number;
  reads: number;
  bytes: number;
  unitsPerRead: number;
};

export type RedisBandwidthReport = {
  days: number;
  daysMissing: number;
  rows: RedisBandwidthRow[];
  totalBytes: number;
  bytesPerDay: number;
  /** Projected 30-day total at the observed daily rate. */
  projectedMonthBytes: number;
  capBytes: number;
};

/**
 * Roll the last `days` day-hashes into one report, ranked by bytes.
 *
 * `daysMissing` is reported for the same reason readFmpUsage reports it: a
 * window the meter was not running for makes the total a FLOOR, and a floor
 * presented as a measurement is how a small number stops people looking.
 */
export async function readRedisBandwidth(days = 7): Promise<RedisBandwidthReport> {
  const empty: RedisBandwidthReport = {
    days,
    daysMissing: days,
    rows: [],
    totalBytes: 0,
    bytesPerDay: 0,
    projectedMonthBytes: 0,
    capBytes: REDIS_BANDWIDTH_CAP_BYTES,
  };
  if (!redis) return empty;

  const keys: string[] = [];
  for (let i = 0; i < days; i++) keys.push(dayKey(Date.now() - i * 86_400_000));

  const totals = new Map<string, number>();
  let daysMissing = 0;
  try {
    for (const key of keys) {
      const hash = await redis.hgetall<Record<string, string | number>>(key);
      if (!hash || !Object.keys(hash).length) {
        daysMissing++;
        continue;
      }
      for (const [field, value] of Object.entries(hash)) {
        const n = Number(value);
        if (!Number.isFinite(n)) continue;
        totals.set(field, (totals.get(field) ?? 0) + n);
      }
    }
  } catch {
    return empty;
  }

  const rows: RedisBandwidthRow[] = REDIS_READ_SOURCES.map((source) => {
    const units = totals.get(`${source}:units`) ?? 0;
    const reads = totals.get(`${source}:reads`) ?? 0;
    return {
      source,
      units,
      reads,
      bytes: units * BYTES_PER_UNIT[source],
      unitsPerRead: reads > 0 ? Math.round(units / reads) : 0,
    };
  })
    .filter((row) => row.reads > 0)
    .sort((a, b) => b.bytes - a.bytes);

  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const observedDays = Math.max(1, days - daysMissing);
  const bytesPerDay = totalBytes / observedDays;

  return {
    days,
    daysMissing,
    rows,
    totalBytes,
    bytesPerDay,
    projectedMonthBytes: bytesPerDay * 30,
    capBytes: REDIS_BANDWIDTH_CAP_BYTES,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GROWTH COUPLING.
//
// claude/earnings-season-measurement-2026-09-02.md sequenced ANALYSIS_UNIVERSE_CAP
// 700 -> 1,500 -> 3,000 behind the earnings work, and the end-of-day plan of
// 2026-09-03 carried the same order. That sequence is now blocked here instead:
// every term in the bill above scales linearly with the universe, and at 1,500
// the projection is roughly twice the plan cap. Twice the cap is a bill or a
// throttle, not a degradation.
//
// WHY THIS IS A CEILING AND NOT A BUDGET ASSERTION. The honest budget check --
// "the projection at the configured cap must fit under the plan limit" -- is RED
// TODAY, at the cap we already run. A check that is red on main from the day it
// lands is a check that gets muted, and then it is not protecting anything. So
// the rule this file enforces is the DIRECTION instead: the cap may not RISE
// while the projection is over. That is green today and red on exactly the
// action the report exists to stop.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The universe cap in force when the overage was measured.
 *
 * Not a copy of ANALYSIS_UNIVERSE_CAP kept in step by hand -- it is the value
 * the 2026-09-04 measurement was taken AT, and scripts/check-redis-bandwidth.mjs
 * fails if ANALYSIS_UNIVERSE_CAP moves above it while the projection is still
 * over the plan cap. Lowering it needs no ceremony; raising it means re-taking
 * the measurement, which is the point.
 */
export const REDIS_OVERAGE_MEASURED_AT_CAP = 700;

/** Sanity: the ceiling is about the cap that actually ships. */
export const CONFIGURED_UNIVERSE_CAP = ANALYSIS_UNIVERSE_CAP;
