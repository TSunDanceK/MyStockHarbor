// The per-symbol earnings store: one key shape, one normaliser, one TTL rule.
//
// WHY THIS EXISTS. warm-earnings has populated msh:pickers:earnings:v1:<SYM>
// since it was written, and lib/latest-earnings-data.ts -- the render path
// reached from three /stock/* pages and the dashboard -- ignored it and fetched
// FMP itself behind a 24h Next revalidate. That cost is driven by DISTINCT
// SYMBOLS RENDERED PER DAY rather than by traffic, because the 24h cache
// collapses repeats: ~616 calls/day today, and it scales with how many stock
// pages exist rather than with how busy they are.
//
// SHARED RATHER THAN COPIED. The normaliser and the TTL rule moved here out of
// the cron route so both sides use the same ones. Two copies of a normaliser
// that must agree about what a null EPS is would be the divergence this repo
// keeps finding (claude/traps/two-validators-for-one-value.md), and the render
// path writing rows the cron would not recognise is exactly how a shared store
// stops being shared.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export const EARNINGS_REDIS_KEY_PREFIX = "msh:pickers:earnings:v1:";

const EARNINGS_TTL_DAY = 24 * 60 * 60;
const EARNINGS_TTL_MAX_SECONDS = 95 * EARNINGS_TTL_DAY; // ~one quarter
const EARNINGS_TTL_NEAR_REPORT_SECONDS = 12 * 60 * 60; // report imminent/just passed
const EARNINGS_TTL_UNKNOWN_SECONDS = 10 * EARNINGS_TTL_DAY; // no future date known

export type EarningsRow = {
  symbol?: string;
  date?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string;
};

export function cleanEarningsSymbol(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

/**
 * Moved verbatim from the warm-earnings route so both writers produce the same
 * rows. Sorts newest-first and drops undated rows.
 *
 * THE ORDERING IS SAFE FOR THE RENDER PATH, checked rather than assumed:
 * latest-earnings-data re-sorts a copy in both of its selections (latest
 * completed, next scheduled), so it does not depend on the order it receives.
 */
export function normalizeEarningsRows(value: unknown, fallbackSymbol: string): EarningsRow[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): EarningsRow => ({
      symbol: typeof item?.symbol === "string" ? item.symbol : fallbackSymbol,
      date: typeof item?.date === "string" ? item.date : "",
      epsActual:
        typeof item?.epsActual === "number" && Number.isFinite(item.epsActual) ? item.epsActual : null,
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

/**
 * Cache lifetime derived from the next scheduled report rather than a flat
 * clock: long while nothing is due, short around a report so the actuals and
 * the rolled-forward next date refresh promptly. Moved verbatim from the cron.
 */
export function computeEarningsTtlSeconds(rows: EarningsRow[], nowMs: number): number {
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

  return Math.min(secondsUntil - EARNINGS_TTL_DAY, EARNINGS_TTL_MAX_SECONDS);
}

/** Rows for one symbol, or null when the store has never held it. */
export async function readEarningsRows(symbol: string): Promise<EarningsRow[] | null> {
  if (!redis) return null;
  const clean = cleanEarningsSymbol(symbol);
  if (!clean) return null;

  try {
    const rows = await redis.get<EarningsRow[]>(`${EARNINGS_REDIS_KEY_PREFIX}${clean}`);
    return Array.isArray(rows) ? rows : null;
  } catch {
    // A read failure must not blank the page -- the caller falls back to FMP.
    return null;
  }
}

/**
 * Write rows for one symbol under the cron's own key and TTL rule.
 *
 * EMPTY IS NOT WRITTEN, matching the cron. A symbol with no earnings rows is
 * indistinguishable here from one whose fetch failed, and caching the second as
 * though it were the first would hold a blank page for up to a quarter.
 */
export async function writeEarningsRows(symbol: string, rows: EarningsRow[], nowMs = Date.now()) {
  if (!redis || !rows.length) return;
  const clean = cleanEarningsSymbol(symbol);
  if (!clean) return;

  try {
    await redis.set(`${EARNINGS_REDIS_KEY_PREFIX}${clean}`, rows, {
      ex: computeEarningsTtlSeconds(rows, nowMs),
    });
  } catch {
    // Best effort: a failed write costs the next render a refetch, not content.
  }
}
