import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  hasFmpCapacity,
  reserveFmpCallSlot,
} from "../../../../lib/server/historyCache";

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
const EARNINGS_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const EARNINGS_LOCK_TTL_SECONDS = 4 * 60;
const EARNINGS_BATCH_SIZE = 40;
const EARNINGS_MIN_HEADROOM_CALLS = 90;

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

async function fetchFmpEarnings(symbol: string): Promise<FmpEarningsRow[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];

  await reserveFmpCallSlot();

  const url = `https://financialmodelingprep.com/stable/earnings?symbol=${encodeURIComponent(
    symbol
  )}&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
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

  try {
    const queue = (await redis.smembers<string>(EARNINGS_QUEUE_KEY)) || [];
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
          await redis.set(`${EARNINGS_REDIS_KEY_PREFIX}${symbol}`, rows, {
            ex: EARNINGS_CACHE_TTL_SECONDS,
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
