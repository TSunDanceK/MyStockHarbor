import { NextRequest, NextResponse } from "next/server";
import {
  EARNINGS_TTL_DAY,
  EARNINGS_TTL_NEAR_REPORT_SECONDS,
  EARNINGS_REDIS_KEY_PREFIX as STORE_KEY_PREFIX,
  computeEarningsTtlSeconds,
  normalizeEarningsRows,
  type EarningsRow,
} from "@/lib/server/earningsStore";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { deferSymbol, markRefreshed, registerSymbols } from "../../../../lib/server/stalenessQueue";
import { fmpFetch } from "@/lib/server/fmpUsage";
import { Redis } from "@upstash/redis";
import {
  FMP_SAFE_CALLS_PER_MINUTE,
  hasFmpCapacity,
  reserveFmpCallSlot,
} from "../../../../lib/server/historyCache";
import {
  ANALYSIS_UNIVERSE_CAP,
  MAX_DYNAMIC_UNIVERSE_SIZE,
  readDynamicUniverse,
} from "../../../../lib/server/dynamicUniverseCache";
import {
  EARNINGS_PEAK_DAY_SHARE,
  planEarningsDay,
  type EarningsDayPlan,
} from "../../../../lib/server/earningsPlan";
import { JOBS, cronIntervalSeconds } from "../../../../lib/server/jobRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DECLARED RATHER THAN INHERITED, and that is a decision rather than a copy of
// the neighbouring routes.
//
// This route previously set no maxDuration at all, so it ran on whatever the
// platform default happens to be. On Vercel that default is not a fixed
// number: it is 300s for a Pro team with Fluid compute enabled and 15s for a
// Pro team without it, and nothing in this repo -- or in anything reachable
// from a sandbox that cannot fetch vercel.com -- records which of those this
// project is. The plan is Pro (checked against the Vercel API); the Fluid
// setting is a dashboard toggle and could be changed by anyone at any time
// WITHOUT A COMMIT, which is what makes inheriting it the wrong basis for a
// loop that now waits.
//
// Both pickers entry points already carry this exact lesson in their headers:
// "Neither pickers entry point set maxDuration, so the full universe build ran
// on Vercel's default limit -- a timeout cliff at ANY universe size, and one
// that would bite silently as UNIVERSE_CAP grows. Set explicitly."
//
// So the wait below is sized against a number this file states, not against
// one it hopes for.
export const maxDuration = 300;

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

// Key, row type, normaliser and TTL rule all live in lib/server/earningsStore.ts
// now, because the render path writes to this same store on a cache miss. Two
// copies of the normaliser would let the two writers disagree about what a
// null EPS is, in a store neither owns.
const EARNINGS_REDIS_KEY_PREFIX = STORE_KEY_PREFIX;
// The TTL constants moved with computeEarningsTtlSeconds -- they were only
// ever read by it.
const EARNINGS_QUEUE_KEY = "msh:pickers:earnings:v1:queue";
const EARNINGS_DUE_KEY_PREFIX = "msh:pickers:earnings:v1:due:";
const EARNINGS_LOCK_KEY = "msh:pickers:earnings:v1:lock";
const EARNINGS_ENQUEUE_GUARD_KEY = "msh:pickers:earnings:v1:enqueue-guard";
// MUST EXCEED maxDuration, same rule as the price pool's lock. It was 4
// minutes, which was fine while a run was a handful of seconds and is NOT fine
// now that a run may spend EARNINGS_RUN_BUDGET_MS (4 min) waiting: the lock
// would expire while the run holding it is still going, letting a second run
// start and duplicate its FMP calls -- failing open in exactly the case the
// lock exists for.
const EARNINGS_LOCK_TTL_SECONDS = 6 * 60;
const EARNINGS_MIN_HEADROOM_CALLS = 90;

// ─────────────────────────────────────────────────────────────────────────────
// THE MINUTE IS A PAUSE. THE RUN'S OWN CLOCK IS THE ONLY THING THAT ENDS IT.
//
// This loop used to read:
//
//     const hasCapacity = await hasFmpCapacity(1, EARNINGS_MIN_HEADROOM_CALLS);
//     if (!hasCapacity) { deferred.push(symbol); break; }
//
// `break`, not wait. EARNINGS_MIN_HEADROOM_CALLS is 90 against a 200 guard, so
// the run ABANDONED ITSELF at 110 calls inside one minute and reported the
// remainder as `deferred` -- a clean-looking record for a run that stopped
// early. This is the identical defect #396 fixed in warmPricePool, where it
// pinned priceRefreshed at 128-136 for days while two other changes were
// designed around the selector instead.
//
// It has never bitten because EARNINGS_BATCH_SIZE is 40. It bites the moment
// the batch is raised -- which is when the universe is growing and a silent
// shortfall is least welcome.
//
// 240s against a 300s maxDuration, for the pool's reason: a run that spends
// all 300 has nothing left for the queue bookkeeping, the run record and the
// response, and would be killed mid-write. Worst case the last symbol starts
// at 239.9s and then costs one reserveFmpCallSlot wait (<=20s) plus the FMP
// round trip -- inside maxDuration, and inside the 6-minute lock.
const EARNINGS_RUN_BUDGET_MS = 240_000;
// Poll rather than sleeping to the bucket edge: the minute may roll over, or
// another job may finish and free room, well before the boundary.
const EARNINGS_BUDGET_POLL_MS = 5_000;

// THE MOST CALLS THIS RUN COULD MAKE IF IT SPENT ITS WHOLE BUDGET, derived
// from the constants above rather than typed. Nothing reads it at runtime --
// it exists so scripts/check-earnings-minute-wall.mjs can assert that
// EARNINGS_BATCH_SIZE stays inside what a run can actually reach. A batch
// above this is a batch the run cannot finish, which puts the shortfall back
// exactly where this change took it from.
export const EARNINGS_USABLE_CALLS_PER_MINUTE =
  FMP_SAFE_CALLS_PER_MINUTE - EARNINGS_MIN_HEADROOM_CALLS;
export const EARNINGS_MAX_CALLS_PER_RUN = Math.floor(
  EARNINGS_USABLE_CALLS_PER_MINUTE * (EARNINGS_RUN_BUDGET_MS / 60_000)
);

// ─────────────────────────────────────────────────────────────────────────────
// EARNINGS_BATCH_SIZE, DERIVED. It was a typed 40.
//
// 40 was never a decision -- it predates every measurement in this thread and
// survived because the minute wall (#406) meant nothing above ~110 worked
// anyway. Today's universe needs 144 calls on the busiest day of the season and
// the job could make 40, so earnings coverage was structurally behind before the
// authentication bug (#408) took two thirds of the passes away on top.
//
// TYPING 282, OR 262, OR ANY OF THEM IS THE FAILURE THIS REBUILD HAS REMOVED
// TWICE. PRICE_TARGET_RUNS stated coverage in a unit that silently changed
// meaning when the cron moved; `priceCap` was derived from one tier while the
// universe sat on two. A batch typed once against a measurement taken once is
// the same shape -- right today, silently wrong the moment
// ANALYSIS_UNIVERSE_CAP moves, and wrong in the direction that just quietly
// does less work.
//
// THE BASIS IS THE UNION OF THE TWO CAPS, not the analysed cap alone and not
// the observed universe. getWarmTargetSymbols hands this job the symbols a
// pickers build analysed UNIONED with the rolling dynamic pool, and those are
// separately capped -- which is why the live figure is 762 against a 700
// analysis cap, ~9% above it. check-price-tiers uses exactly this sum for the
// pre-open buffer, for the same reason: this is worst-case work inside ONE RUN,
// where the sum is the honest bound and either cap alone understates it.
//
// The pools overlap heavily, so the sum is LOOSE -- 1,400 permitted against 762
// observed. That costs nothing: the loop stops at symbols that are actually
// DUE, so the batch is a ceiling on a busy day rather than a workload on a
// quiet one.
const EARNINGS_UNIVERSE_BASIS = ANALYSIS_UNIVERSE_CAP + MAX_DYNAMIC_UNIVERSE_SIZE;

export const EARNINGS_PLAN: EarningsDayPlan | null = planEarningsDay({
  universeSize: EARNINGS_UNIVERSE_BASIS,
  peakDayShare: EARNINGS_PEAK_DAY_SHARE,
  callsPerRun: EARNINGS_MAX_CALLS_PER_RUN,
  runPeriodSeconds: cronIntervalSeconds(JOBS["warm-earnings"].cron),
  leadSeconds: EARNINGS_TTL_DAY,
  nearReportTtlSeconds: EARNINGS_TTL_NEAR_REPORT_SECONDS,
});

// THE FALLBACK EXISTS SO THE JOB STILL RUNS, AND THE CHECK EXISTS SO IT NEVER
// DOES. planEarningsDay returns null only if one of its inputs is zero or
// unparseable -- all five are compile-time constants, so that means somebody
// edited one to nonsense. Falling back to the old 40 silently would be the
// absence-reads-as-health defect this whole series keeps finding, so it is
// loud, and scripts/check-earnings-batch.mjs asserts the plan is not null at
// the current caps.
const EARNINGS_BATCH_FALLBACK = 40;
if (!EARNINGS_PLAN) {
  console.error(
    "[warm-earnings] planEarningsDay returned null -- one of its inputs is zero " +
      `or unparseable, so the batch has fallen back to ${EARNINGS_BATCH_FALLBACK} ` +
      "and this run will do a fraction of a peak day's work."
  );
}

// WHY batchPerPass RATHER THAN callsOnPeakRun. They are the same number while
// one pass suffices, and they diverge exactly when it stops: at a universe
// needing two passes, batchPerPass is half the peak day and a single daily run
// would cover half the work while looking fully sized. That divergence is why
// the check asserts passesNeeded === 1 at the current caps -- the constant
// alone cannot tell you a second pass is missing.
const EARNINGS_BATCH_SIZE = EARNINGS_PLAN?.batchPerPass ?? EARNINGS_BATCH_FALLBACK;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Wait until there is FMP room for one more call, or until the run is out of
 * its own time.
 *
 * Returns "out-of-time" ONLY on the run's clock. An exhausted minute is a
 * pause; the end of the budget is the only thing that ends the run.
 *
 * WHY NOT LEAN ON reserveFmpCallSlot'S OWN WAIT: it waits at most
 * FMP_MAX_WAIT_MS (20s) and then THROWS capacity-timeout, and inside
 * fetchFmpEarnings that throw would be caught by the loop's try/catch and
 * counted as a FAILED symbol -- which then gets deferSymbol'd for seven days.
 * A busy minute would park a perfectly good ticker for a week. Waiting out
 * here, outside the fetch, is what keeps pacing from being recorded as
 * failure.
 */
async function waitForEarningsBudget(deadlineMs: number): Promise<"ok" | "out-of-time"> {
  while (true) {
    if (await hasFmpCapacity(1, EARNINGS_MIN_HEADROOM_CALLS)) return "ok";
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) return "out-of-time";
    await sleep(Math.min(EARNINGS_BUDGET_POLL_MS, remaining));
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Earnings only change once a quarter, so the flat 24h TTL was pure waste --
// it re-fetched every symbol daily. We now derive the cache lifetime from the
// symbol's own NEXT scheduled report date (see computeEarningsTtlSeconds): a
// symbol is cached until ~a day before it next reports (capped at ~a quarter),
// with a short 12h window right around/after a report so the freshly-released
// actuals + the new next-date get picked up. Net effect: steady-state earnings
// calls drop to "only symbols reporting this week".

// How often the dynamic-universe backfill enqueue is allowed to run. The
// enqueue does one bulk read of up to ~700 cached-earnings entries to find
// which are missing; throttling it to once an hour keeps that read rare even
// if the job itself is hit every few minutes.
const EARNINGS_ENQUEUE_THROTTLE_SECONDS = 60 * 60;

type FmpEarningsRow = EarningsRow;

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

function cleanSymbol(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}


// Cache lifetime for one symbol's earnings, derived from its next scheduled
// report date. Long by default (nothing changes between reports); short right
// around a report so the actuals + the rolled-forward next date are refreshed.

async function acquireLock() {
  if (!redis) return "no-redis";

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(EARNINGS_LOCK_KEY, token, {
    nx: true,
    ex: EARNINGS_LOCK_TTL_SECONDS,
  });

  return result === "OK" ? token : null;
}

async function releaseLock(token: string | null) {
  if (!redis || !token || token === "no-redis") return;

  try {
    const current = await redis.get<string>(EARNINGS_LOCK_KEY);
    if (current === token) await redis.del(EARNINGS_LOCK_KEY);
  } catch {
    // fail open
  }
}

// Adds every dynamic-universe symbol that doesn't already have cached earnings
// to the warm queue, so coverage extends across the whole ~700-symbol dynamic
// pool (not just the ~200 the pickers build enqueues). Throttled to once an
// hour via a Redis guard so its bulk existence-check stays cheap. Best-effort:
// any failure just means no new symbols were added this run.
async function enqueueDynamicUniverseMissing(): Promise<number> {
  if (!redis) return 0;

  // Throttle: only one machine wins the guard per window; others skip.
  try {
    const won = await redis.set(EARNINGS_ENQUEUE_GUARD_KEY, "1", {
      nx: true,
      ex: EARNINGS_ENQUEUE_THROTTLE_SECONDS,
    });
    if (won !== "OK") return 0;
  } catch {
    return 0;
  }

  let entries;
  try {
    entries = await readDynamicUniverse();
  } catch {
    return 0;
  }

  const symbols = Array.from(
    new Set(entries.map((entry) => cleanSymbol(entry.symbol)).filter(Boolean))
  );
  if (!symbols.length) return 0;

  let cached: (FmpEarningsRow[] | null)[];
  try {
    const keys = symbols.map((symbol) => `${EARNINGS_REDIS_KEY_PREFIX}${symbol}`);
    cached = (await redis.mget(...keys)) as unknown as (FmpEarningsRow[] | null)[];
  } catch {
    return 0;
  }

  const missing = symbols.filter((_symbol, i) => {
    const rows = cached[i];
    return !(Array.isArray(rows) && rows.length > 0);
  });
  if (!missing.length) return 0;

  try {
    const pipeline = redis.pipeline();
    for (const symbol of missing) pipeline.sadd(EARNINGS_QUEUE_KEY, symbol);
    await pipeline.exec();
  } catch {
    // best-effort
  }

  return missing.length;
}

async function fetchFmpEarnings(symbol: string): Promise<FmpEarningsRow[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];

  await reserveFmpCallSlot();

  const url = `https://financialmodelingprep.com/stable/earnings?symbol=${encodeURIComponent(
    symbol
  )}&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fmpFetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) return [];

  const json = await res.json().catch(() => null);
  return normalizeEarningsRows(json, symbol);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!redis) {
    return NextResponse.json(
      { error: "Missing Upstash Redis configuration." },
      { status: 500 }
    );
  }

  if (!process.env.FMP_API_KEY) {
    return NextResponse.json(
      { error: "Missing FMP_API_KEY environment variable." },
      { status: 500 }
    );
  }

  const lock = await acquireLock();
  if (!lock) {
    // A lock-skip is a healthy outcome, not a gap. Left unrecorded, a run of
    // skips would age the record out and the page would say "never run".
    await recordJobRun("warm-earnings", true, { skipped: true, reason: "locked" });
    return NextResponse.json({ ok: true, skipped: true, reason: "locked" });
  }

  const now = Date.now();
  const runDeadlineMs = now + EARNINGS_RUN_BUDGET_MS;
  let outOfTime = false;
  const fetched: string[] = [];
  const deferred: string[] = [];
  const failed: string[] = [];
  let dynamicEnqueued = 0;

  try {
    // Extend coverage to the full dynamic universe (throttled internally).
    dynamicEnqueued = await enqueueDynamicUniverseMissing();

    const queueRaw = (await redis.smembers(EARNINGS_QUEUE_KEY)) || [];
    const queue = Array.isArray(queueRaw) ? queueRaw.map(String) : [];
    const cleanQueue = Array.from(new Set(queue.map(cleanSymbol).filter(Boolean)));

    for (const symbol of cleanQueue) {
      if (fetched.length >= EARNINGS_BATCH_SIZE) break;

      // The run's own clock, checked before starting a symbol rather than
      // after. A symbol begun at the deadline still gets to finish; one begun
      // past it would push the bookkeeping tail past maxDuration.
      if (Date.now() >= runDeadlineMs) {
        outOfTime = true;
        break;
      }

      const dueAt = await redis.get<number>(`${EARNINGS_DUE_KEY_PREFIX}${symbol}`);
      if (typeof dueAt === "number" && dueAt > now) {
        deferred.push(symbol);
        continue;
      }

      // A BUSY MINUTE IS NOT A RESULT. The symbol is left in the queue with no
      // due key written, exactly as before -- but it is no longer pushed onto
      // `deferred`, because that list now means one thing ("not due yet")
      // instead of two. A run that stopped at the minute wall used to report
      // the same field as a run that had nothing to do.
      if ((await waitForEarningsBudget(runDeadlineMs)) === "out-of-time") {
        outOfTime = true;
        break;
      }

      try {
        const rows = await fetchFmpEarnings(symbol);

        if (rows.length > 0) {
          const ttl = computeEarningsTtlSeconds(rows, now);
          await redis.set(`${EARNINGS_REDIS_KEY_PREFIX}${symbol}`, rows, {
            ex: ttl,
          });
        }

        await Promise.all([
          redis.srem(EARNINGS_QUEUE_KEY, symbol),
          redis.del(`${EARNINGS_DUE_KEY_PREFIX}${symbol}`),
        ]);

        fetched.push(symbol);
      } catch {
        failed.push(symbol);
      }
    }

    // fetched / failed map exactly onto the queue's two outcomes. Deferring the
    // failures is queue rule 1: a symbol FMP cannot answer for stays the stalest
    // thing in the set and holds the front of the queue forever otherwise.
    await registerSymbols("earnings", cleanQueue);
    if (fetched.length) await markRefreshed("earnings", fetched);
    for (const sym of failed) await deferSymbol("earnings", sym);

    await recordJobRun("warm-earnings", true, {
      checked: cleanQueue.length,
      fetched: fetched.length,
      deferred: deferred.length,
      failed: failed.length,
      // THE SHORTFALL, NAMED. Without this a run that ran out of budget and
      // one that drained its queue produce the same record -- which is how the
      // `break` stayed invisible for as long as it did.
      outOfTime,
      // THE PLAN THAT SIZED THIS RUN, on the record. A batch that came from
      // arithmetic should be readable as arithmetic afterwards, or the next
      // person to wonder why it is 262 has to re-derive it.
      batchSize: EARNINGS_BATCH_SIZE,
      batchBasisUniverse: EARNINGS_UNIVERSE_BASIS,
      peakDayReporters: EARNINGS_PLAN?.peakDayReporters ?? null,
      passesNeeded: EARNINGS_PLAN?.passesNeeded ?? null,
    });

    return NextResponse.json({
      ok: true,
      checked: cleanQueue.length,
      dynamicEnqueued,
      fetchedCount: fetched.length,
      deferredCount: deferred.length,
      failedCount: failed.length,
      outOfTime,
      fetched,
      deferred: deferred.slice(0, 20),
      failed: failed.slice(0, 20),
      batchSize: EARNINGS_BATCH_SIZE,
    });
  } finally {
    await releaseLock(lock);
  }
}
