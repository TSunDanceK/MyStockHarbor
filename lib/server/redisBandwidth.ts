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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AND IT IS WRONG BY MORE THAN 20%. Measured 2026-09-11:
 *
 *   STRLEN msh:pickers:v9:charts-off-payload  =  7,248,807  over 700 records
 *                                             =  ~10,356 bytes per record
 *
 * That is FIVE TIMES this constant, and it is a direct measurement of the
 * stripped payload against a residual computed a month ago at a third of the
 * universe. The direct one wins.
 *
 * NOT CORRECTED HERE, DELIBERATELY, and this note is the alternative to a
 * silent edit. Changing it multiplies the reported picker-payload bandwidth by
 * five, which would move the /cache-health projection and the growth gate in
 * check-redis-bandwidth.mjs on the strength of one STRLEN. #427 logs the real
 * serialized size on every build; a few days of that settles it properly, and
 * a chunking PR is the wrong place to re-baseline a meter.
 *
 * The chunking projection in chunkByBytes.ts uses the measurement rather than
 * this constant, so the thing that must not breach is sized against the larger
 * of the two.
 * ─────────────────────────────────────────────────────────────────────────
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
  // THE SYMBOL LIST, SPLIT OUT FROM picker-payload BECAUSE IT IS NOW A
  // DIFFERENT READ. Three crons used to pull the whole ~1.5MB stripped payload
  // to take one field off each record; they now read a few KB from their own
  // key. Folding it into picker-payload would hide the improvement inside the
  // number it improves, which is the opposite of what this meter is for.
  | "picker-symbols"
  | "picker-charts"
  // SPLIT FROM history-bulk, and the split is the point rather than tidiness.
  // #418 metered only the two BULK paths, so the twelve single-symbol readers --
  // /api/history, the stock page and its news/earnings tabs, the dashboard, the
  // SPX page, insight snapshots, and the three plays builders, which read ~700
  // symbols each ONE AT A TIME -- all reported as zero. The bytes are identical
  // per symbol; only the call shape differs. A meter that ranks a reader at zero
  // because of how it loops is a meter that answers "who reads history" wrong.
  | "history-single"
  | "history-bulk"
  | "price-pool";

const BYTES_PER_UNIT: Record<RedisReadSource, number> = {
  "picker-payload": BYTES_PER_SYMBOL_PICKER_PAYLOAD,
  // A ticker string plus JSON punctuation. Measured rather than guessed:
  // JSON.stringify(["AAPL"]).length is 8 for one 4-character symbol, and the
  // universe averages ~4.3 characters, so ~9 bytes a symbol including the
  // comma. Three orders of magnitude below the payload it replaces, which is
  // the point of recording it separately.
  "picker-symbols": 9,
  "picker-charts": BYTES_PER_SYMBOL_PICKER_CHARTS,
  "history-single": BYTES_PER_SYMBOL_HISTORY,
  "history-bulk": BYTES_PER_SYMBOL_HISTORY,
  "price-pool": BYTES_PER_SYMBOL_PRICE_POOL,
};

export const REDIS_READ_SOURCES = Object.keys(BYTES_PER_UNIT) as RedisReadSource[];

function dayKey(nowMs = Date.now()) {
  return `${UNITS_KEY_PREFIX}${new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// WHY THE FIELD KEY CARRIES A CALLER, AND WHY IT CARRIES AN HOUR.
//
// "history-bulk: 2.5 GB/day" identifies a KEYSPACE, not a reader, and the whole
// question this meter was built to answer is WHO. Three readers with wildly
// different fixes -- a daily cron, a five-minute cron, and a scraper hitting a
// public route -- are indistinguishable in a single per-source total.
//
// The HOUR is the second half of the same question and it is what makes the
// answer falsifiable rather than argued. The three shapes are unmistakable in a
// 24-bar profile and impossible to tell apart in a daily total:
//
//   flat across all 24 hours          a cron
//   diurnal, quiet 02:00-06:00 UTC    human traffic
//   flat AND high, no overnight dip   scrapers
//
// Both live as extra FIELDS on the day hash rather than as extra KEYS: an
// hourly key would make a 7-day report 168 HGETALLs, which is a meter that
// costs what it measures.
const CALLER_PATTERN = /^[a-z0-9-]{1,40}$/;

/** Unattributed reads are labelled, not dropped -- a silent bucket is a gap. */
export const UNATTRIBUTED_CALLER = "unattributed";

function safeCaller(caller: string | undefined): string {
  if (!caller || !CALLER_PATTERN.test(caller)) return UNATTRIBUTED_CALLER;
  return caller;
}

function hourField(source: RedisReadSource, nowMs: number) {
  const hh = String(new Date(nowMs).getUTCHours()).padStart(2, "0");
  return `${source}:h${hh}:units`;
}

/**
 * Record that `units` symbols were read from `source`.
 *
 * Fails open and silent: a meter that can break the thing it measures is worse
 * than no meter. One pipeline, two HINCRBYs and an EXPIRE.
 */
export async function recordRedisRead(
  source: RedisReadSource,
  units: number,
  caller?: string
): Promise<void> {
  if (!redis || !Number.isFinite(units) || units <= 0) return;
  try {
    const nowMs = Date.now();
    const key = dayKey(nowMs);
    const who = safeCaller(caller);
    const p = redis.pipeline();
    // The source total stays, unchanged in meaning, so the #418 report keeps
    // working across the deploy rather than reading as a collapse to zero.
    p.hincrby(key, `${source}:units`, Math.round(units));
    p.hincrby(key, `${source}:reads`, 1);
    p.hincrby(key, `${source}:${who}:units`, Math.round(units));
    p.hincrby(key, `${source}:${who}:reads`, 1);
    p.hincrby(key, hourField(source, nowMs), Math.round(units));
    p.expire(key, UNITS_TTL_SECONDS);
    await p.exec();
  } catch {
    // bookkeeping -- never throws into a render path
  }
}

export type RedisBandwidthRow = {
  source: RedisReadSource;
  /** Which code path did the reading. See the note on CALLER_PATTERN. */
  caller: string;
  units: number;
  reads: number;
  bytes: number;
  unitsPerRead: number;
};

/**
 * Units read in each UTC hour, summed across the window, one entry per source.
 *
 * THE SHAPE IS THE ANSWER, not the total. Cron reads are flat; human traffic
 * dips overnight; scrapers are flat and high. Those three want completely
 * different fixes and a daily total cannot tell them apart.
 */
export type RedisHourlyProfile = {
  source: RedisReadSource;
  /** 24 entries, index = UTC hour. */
  units: number[];
  /** max/mean over the 24. ~1 is flat (cron-shaped); >2 is peaky (traffic). */
  peakToMean: number;
};

export type RedisBandwidthReport = {
  days: number;
  daysMissing: number;
  rows: RedisBandwidthRow[];
  hourly: RedisHourlyProfile[];
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
    hourly: [],
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

  // PER CALLER, DERIVED FROM THE FIELDS PRESENT rather than from a list of
  // callers kept here -- a hand-typed list is how the caller added next month
  // reports as nothing at all.
  const rows: RedisBandwidthRow[] = [];
  for (const [field, units] of totals) {
    const parts = field.split(":");
    if (parts.length !== 3 || parts[2] !== "units") continue;
    const [source, caller] = parts as [RedisReadSource, string, string];
    if (!(source in BYTES_PER_UNIT)) continue;
    // The hourly buckets share the three-part shape; they are not callers.
    if (/^h\d{2}$/.test(caller)) continue;
    rows.push({
      source,
      caller,
      units,
      reads: totals.get(`${source}:${caller}:reads`) ?? 0,
      bytes: units * BYTES_PER_UNIT[source],
      unitsPerRead: 0,
    });
  }
  for (const row of rows) {
    row.unitsPerRead = row.reads > 0 ? Math.round(row.units / row.reads) : 0;
  }
  rows.sort((a, b) => b.bytes - a.bytes);

  const hourly: RedisHourlyProfile[] = REDIS_READ_SOURCES.map((source) => {
    const units = Array.from({ length: 24 }, (_, h) =>
      totals.get(`${source}:h${String(h).padStart(2, "0")}:units`) ?? 0
    );
    const total = units.reduce((a, b) => a + b, 0);
    const mean = total / 24;
    return {
      source,
      units,
      // 0 rather than Infinity when nothing was read: an unmeasured source must
      // not render as the peakiest thing on the page.
      peakToMean: mean > 0 ? Math.max(...units) / mean : 0,
    };
  }).filter((profile) => profile.units.some((u) => u > 0));

  // FROM THE PER-SOURCE TOTALS, not by summing the per-caller rows. The two
  // agree today; if a write ever lands one and not the other, the total is the
  // one that matches the #418 report and the caller rows are the newer, more
  // fragile half.
  const totalBytes = REDIS_READ_SOURCES.reduce(
    (sum, source) => sum + (totals.get(`${source}:units`) ?? 0) * BYTES_PER_UNIT[source],
    0
  );
  const observedDays = Math.max(1, days - daysMissing);
  const bytesPerDay = totalBytes / observedDays;

  return {
    days,
    daysMissing,
    rows,
    hourly,
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
 * The universe cap in force when the bandwidth measurement was taken.
 *
 * Not a copy of ANALYSIS_UNIVERSE_CAP kept in step by hand -- it is the value
 * the measurement was taken AT, and scripts/check-redis-bandwidth.mjs fails if
 * ANALYSIS_UNIVERSE_CAP moves above it. Lowering it needs no ceremony; raising
 * it means re-taking the measurement, which is the point.
 */
export const REDIS_OVERAGE_MEASURED_AT_CAP = 700;

// ─────────────────────────────────────────────────────────────────────────────
// RE-DERIVED 2026-09-11. THE GATE STAYS; ITS ARITHMETIC WAS OBSOLETE.
//
// The block above was calibrated against a 207 GB/month projection at cap 700 --
// over a 200 GB plan cap -- and every sentence justifying it was arithmetic on
// that number: "at 1,500 the projection is roughly twice the plan cap", "twice
// the cap is a bill or a throttle". THE MEASUREMENT IT RESTS ON NO LONGER
// EXISTS. #419 (the history read path), #420 (tier 2 hourly) and #421 (ISR
// windows) landed between, and #419 also closed the meter's own hole -- twelve
// single-symbol readers reporting zero bytes -- so the current figure counts
// MORE and reads LESS.
//
//     2026-09-04   ~207 GB/month projected, at cap 700, meter under-counting
//     2026-09-11     48.60 GB/month projected, at cap 700, hole closed
//
// At 1,500 the projection would now be ~104 GB, 52% of the plan cap, not 200%.
// Leaving that prose in place would have meant the next person to read it being
// told a number that is wrong by a factor of four, in the direction that stops
// them looking.
//
// TWO RULES NOW, AND THEY ARE NOT THE SAME RULE.
//
//   THE BUDGET RULE -- the projection at the configured cap must fit under the
//   plan limit. This is the honest check, and the comment above records that it
//   could not be used because it was RED ON MAIN from the day it would have
//   landed: "a check that is red on main from the day it lands is a check that
//   gets muted". At 24.3% of the plan cap it is now green, so it can finally be
//   the rule it was always meant to be -- and it goes red if the bill regresses,
//   which the direction rule alone could never detect.
//
//   THE DECISION RULE -- ANALYSIS_UNIVERSE_CAP may not exceed the cap the
//   measurement was taken at. This is NOT a budget statement any more and must
//   not be read as one: the budget would permit roughly 2,880 symbols
//   (redisAffordableUniverseCap below computes it). It is the rule that raising
//   the universe is a deliberate act with a fresh measurement behind it rather
//   than a one-character edit, and the owner has not taken that decision.
//
// THE SECOND RULE IS WHY THE FIRST DOES NOT UNBLOCK GROWTH. Replacing the
// ceiling with the affordable figure would have made this file the growth
// decision, which is not what re-deriving a gate means.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The projected monthly Redis bandwidth at REDIS_OVERAGE_MEASURED_AT_CAP.
 *
 * A MEASUREMENT WITH ITS DATE ATTACHED, like every other byte figure in this
 * file, because the last one went stale silently and took four sentences of
 * reasoning with it.
 */
export const REDIS_PROJECTION_MEASURED_BYTES = Math.round(48.6 * 1024 * 1024 * 1024);
export const REDIS_PROJECTION_MEASURED_AT = "2026-09-11";
/**
 * The universe cap the projection above was measured at.
 *
 * SEPARATE FROM REDIS_OVERAGE_MEASURED_AT_CAP AND ASSERTED EQUAL TO IT, which
 * is not redundancy. The gate blocks ANALYSIS_UNIVERSE_CAP from rising past the
 * ceiling -- so raising THE CEILING, alone, weakens the gate and changes
 * nothing that a check comparing the cap to it can see. Found exactly that way:
 * a breakage run set the ceiling to the affordable 2,880 and every assertion
 * stayed green. Tying the ceiling to a figure that is part of the measurement's
 * own provenance means moving it requires claiming a measurement that was taken
 * there.
 */
export const REDIS_PROJECTION_MEASURED_AT_CAP = 700;
export const REDIS_PROJECTION_MEASURED_SOURCE =
  "/cache-health Redis bandwidth panel, 7-day window projected to 30 days, at " +
  "ANALYSIS_UNIVERSE_CAP 700, after #419 closed the single-symbol metering hole. " +
  "The previous figure was ~207 GB on 2026-09-04, taken before that fix.";

/**
 * The largest universe the measured bill would still fit the plan cap at.
 *
 * PURE AND EXPORTED so scripts/check-redis-bandwidth.mjs can RUN it rather than
 * re-derive the division and prove only that two copies agree. Every term in
 * the bill scales linearly with the universe, which is the assumption this
 * rests on and the reason the model is a single multiplication rather than a
 * simulation.
 *
 * INFORMATIONAL, NOT A PERMISSION. The gate is the smaller of this and
 * REDIS_OVERAGE_MEASURED_AT_CAP; see the block above for why those are two
 * different questions.
 */
export function redisAffordableUniverseCap(
  measuredBytes = REDIS_PROJECTION_MEASURED_BYTES,
  measuredAtCap = REDIS_OVERAGE_MEASURED_AT_CAP,
  planCapBytes = REDIS_BANDWIDTH_CAP_BYTES
): number {
  if (!(measuredBytes > 0) || !(measuredAtCap > 0) || !(planCapBytes > 0)) return 0;
  return Math.floor((measuredAtCap * planCapBytes) / measuredBytes);
}

/**
 * The projected bill at any universe size, scaled from the measurement.
 *
 * Separate from the function above so the check can assert the BUDGET rule
 * directly -- "the projection at the configured cap fits under the plan limit"
 * -- rather than inferring it from a ceiling.
 */
export function redisProjectedBytesAt(
  universeCap: number,
  measuredBytes = REDIS_PROJECTION_MEASURED_BYTES,
  measuredAtCap = REDIS_OVERAGE_MEASURED_AT_CAP
): number {
  if (!(measuredAtCap > 0) || !(universeCap > 0)) return 0;
  return (measuredBytes * universeCap) / measuredAtCap;
}

/** Sanity: the ceiling is about the cap that actually ships. */
export const CONFIGURED_UNIVERSE_CAP = ANALYSIS_UNIVERSE_CAP;
