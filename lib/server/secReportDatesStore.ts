// WHEN THE COMPANY TOLD THE MARKET, STORED ONCE AND READ ON EVERY RENDER.
//
// ── WHY THIS IS A SEPARATE KEY FROM THE FACT SET ─────────────────────────
// The fact set comes from companyfacts and is positionally encoded against
// SEC_FIELD_KEYS — a fieldsHash mismatch discards the whole blob, deliberately,
// because a shifted array means every number means something else. Report dates
// come from a DIFFERENT endpoint (submissions), have no field order, and would
// be thrown away for free every time a financial field is added. They also
// change on a different schedule: an 8-K lands the day results are announced,
// companyfacts days later.
//
// So: its own key, its own write, its own absence. A symbol with facts and no
// dates renders its financials and says nothing about timing, which is the
// honest pairing — not a page that loses both because one endpoint moved.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import type { NextReportEstimate, ReportEvent } from "./secReportDates";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/** Registered in symbolEviction.PER_SYMBOL_KEYS — see the note there. */
export const SEC_REPORT_DATES_PREFIX = "msh:sec:reportdates:v1";
export const reportDatesKey = (symbol: string) =>
  `${SEC_REPORT_DATES_PREFIX}:${symbol.toUpperCase()}`;

/**
 * HOW MANY EVENTS ARE KEPT.
 *
 * The page charts eight quarters and the estimator reads four lags plus the
 * same quarter a year ago, so twelve would do. Twenty is kept because the
 * BACKTEST is the thing that will want more of them, and because twenty events
 * is under a kilobyte — the read cost is the round trip, not the payload.
 */
export const STORED_EVENT_LIMIT = 20;

export type StoredReportDates = {
  symbol: string;
  cik: string;
  /** When the submissions feed was last read. ISO, for the freshness line. */
  at: string;
  /** Newest first. Only events whose period was MATCHED are stored. */
  events: ReportEvent[];
  /**
   * The period end the estimate is FOR — derived from the stored fact set's
   * own cadence, never from an announcement date. Null means no estimate.
   */
  nextPeriodEnd: string | null;
  next: NextReportEstimate;
};

export async function readReportDates(symbol: string): Promise<StoredReportDates | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get<StoredReportDates>(reportDatesKey(symbol));
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.events)) return null;
    return raw;
  } catch (err) {
    console.error("[sec-report-dates] read failed", symbol, err);
    return null;
  }
}

export async function writeReportDates(rec: StoredReportDates): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.set(reportDatesKey(rec.symbol), rec);
    return true;
  } catch (err) {
    console.error("[sec-report-dates] write failed", rec.symbol, err);
    return false;
  }
}
