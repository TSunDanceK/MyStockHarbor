import { NextRequest, NextResponse } from "next/server";
import { fmpFetch } from "@/lib/server/fmpUsage";
import { Redis } from "@upstash/redis";
import {
  hasFmpCapacity,
  reserveFmpCallSlot,
} from "../../../../lib/server/historyCache";
import { readDynamicUniverse } from "../../../../lib/server/dynamicUniverseCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const EARNINGS_REDIS_KEY_PREFIX = "msh:pickers:earnings:v1:";
const EARNINGS_QUEUE_KEY = "msh:pickers:earnings:v1:queue";
const EARNINGS_DUE_KEY_PREFIX = "msh:pickers:earnings:v1:due:";
const EARNINGS_LOCK_KEY = "msh:pickers:earnings:v1:lock";
const EARNINGS_ENQUEUE_GUARD_KEY = "msh:pickers:earnings:v1:enqueue-guard";
const EARNINGS_LOCK_TTL_SECONDS = 4 * 60;
const EARNINGS_BATCH_SIZE = 40;
const EARNINGS_MIN_HEADROOM_CALLS = 90;

// Earnings only change once a quarter, so the flat 24h TTL was pure waste --
// it re-fetched every symbol daily. We now derive the cache lifetime from the
// symbol's own NEXT scheduled report date (see computeEarningsTtlSeconds): a
// symbol is cached until ~a day before it next reports (capped at ~a quarter),
// with a short 12h window right around/after a report so the freshly-released
// actuals + the new next-date get picked up. Net effect: steady-state earnings
// calls drop to "only symbols reporting this week".
const EARNINGS_TTL_DAY = 24 * 60 * 60;
const EARNINGS_TTL_MAX_SECONDS = 95 * EARNINGS_TTL_DAY; // ~one quarter
const EARNINGS_TTL_NEAR_REPORT_SECONDS = 12 * 60 * 60; // report imminent/just passed
const EARNINGS_TTL_UNKNOWN_SECONDS = 10 * EARNINGS_TTL_DAY; // no future date known

// How often the dynamic-universe backfill enqueue is allowed to run. The
// enqueue does one bulk read of up to ~700 cached-earnings entries to find
// which are missing; throttling it to once an hour keeps that read rare even
// if the job itself is hit every few minutes.
const EARNINGS_ENQUEUE_THROTTLE_SECONDS = 60 * 60;

type FmpEarningsRow = {
  symbol?: string;
  date?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string;
};

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

function normalizeEarningsRows(value: unknown, fallbackSymbol: string): FmpEarningsRow[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): FmpEarningsRow => ({
      symbol: typeof item?.symbol === "string" ? item.symbol : fallbackSymbol,
      date: typeof item?.date === "string" ? item.date : "",
      epsActual:
        typeof item?.epsActual === "number" && Number.isFinite(item.epsActual)
          ? item.epsActual
          : null,
      epsEstimated:
        typeof item?.epsEstimated === "number" && Number.isFinite(item.epsEstimated)
          ? item.epsEstimated
          : null,
      revenueActual:
        typeof item?.revenueActual === "number" && Number.isFinite(item.revenueActual)
          ? item.revenueActual
          : null,
      revenueEstimated:
        typeof item?.revenueEstimated === "number" && Number.isFinite(item.revenueEstimated)
          ? item.revenueEstimated
          : null,
      lastUpdated: typeof item?.lastUpdated === "string" ? item.lastUpdated : "",
    }))
    .filter((item) => Boolean(item.date))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

// Cache lifetime for one symbol's earnings, derived from its next scheduled
// report date. Long by default (nothing changes between reports); short right
// around a report so the actuals + the rolled-forward next date are refreshed.
function computeEarningsTtlSeconds(rows: FmpEarningsRow[], nowMs: number): number {
  let nextMs: number | null = null;
  for (const row of rows) {
    if (!row.date) continue;
    const t = Date.parse(row.date);
    if (!Number.isFinite(t)) continue;
    if (t > nowMs && (nextMs === null || t < nextMs)) nextMs = t;
  }

  if (nextMs === null) return EARNINGS_TTL_UNKNOWN_SECONDS;

  const secondsUntil = Math.floor((nextMs - nowMs) / 1000);
  if (secondsUntil <= 2 * EARNINGS_TTL_DAY) return EARNINGS_TTL_NEAR_REPORT_SECONDS;

  // Cache until ~a day before the next report, capped at ~a quarter.
  return Math.min(secondsUntil - EARNINGS_TTL_DAY, EARNINGS_TTL_MAX_SECONDS);
}

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
    return NextResponse.json({ ok: true, skipped: true, reason: "locked" });
  }

  const now = Date.now();
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

      const dueAt = await redis.get<number>(`${EARNINGS_DUE_KEY_PREFIX}${symbol}`);
      if (typeof dueAt === "number" && dueAt > now) {
        deferred.push(symbol);
        continue;
      }

      const hasCapacity = await hasFmpCapacity(1, EARNINGS_MIN_HEADROOM_CALLS);
      if (!hasCapacity) {
        deferred.push(symbol);
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

    return NextResponse.json({
      ok: true,
      checked: cleanQueue.length,
      dynamicEnqueued,
      fetchedCount: fetched.length,
      deferredCount: deferred.length,
      failedCount: failed.length,
      fetched,
      deferred: deferred.slice(0, 20),
      failed: failed.slice(0, 20),
      batchSize: EARNINGS_BATCH_SIZE,
    });
  } finally {
    await releaseLock(lock);
  }
}
