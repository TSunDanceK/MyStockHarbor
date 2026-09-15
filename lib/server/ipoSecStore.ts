// Where the SEC filing records live between refreshes.
//
// THE RENDER MUST NOT TOUCH EDGAR. `form.idx` is 39.3 MB a quarter (measured:
// 39,283,913 bytes, 423 ms on a runner) and even the per-filer work -- a
// submissions read and a cover fetch each -- is tens of requests. A page render
// gets none of that. It reads what is stored and nothing else, exactly the shape
// claude/news-as-stored-dataset-spec-2026-08-22.md settled for news:
//
//   "Page renders read Redis and make no upstream call."
//
// The refresh path that populates this is the daily-index job -- ONE request a
// day (lib/server/secDailyIndex.ts, ~3,600-4,100 rows, measured reachable from
// iad1) plus per-filer work only for the handful of CIKs whose filings actually
// changed that day. The 90-day cold start is seeded once from form.idx on a
// runner, never backfilled a day at a time from a function.
import { Redis } from "@upstash/redis";

import type { IpoFilerRecord } from "./ipoSecSource";

// v1, and versioned from the start: the record shape carries parsed cover terms,
// and the parser is a heuristic that has already been rebuilt once. A shape
// change must not be read back through an old reader.
export const IPO_FILINGS_REDIS_KEY = "msh:ipo:filings:v1";

type StoredIpoFilings = {
  /** When the refresh that wrote this ran. */
  fetchedAt: number;
  /** The window it covers, so a reader can tell a 90-day set from a 7-day one. */
  windowDays: number;
  records: IpoFilerRecord[];
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

/**
 * The stored records, or `null` when there is no store to read.
 *
 * NULL AND [] ARE DIFFERENT ANSWERS AND THE CALLER DEPENDS ON IT.
 *   null  the refresh has never run, Redis is unreachable, or the key is wrong
 *         -- "could not answer". fetchIpoRows() turns this into a THROW, so
 *         readFeed serves the last good copy instead of publishing an empty page.
 *   []    the refresh ran and found nothing -- "genuinely none".
 *
 * Collapsing them is how a broken pipeline renders as "No confirmed IPOs listed",
 * which is the exact failure `warnIfImplausiblyEmpty` was added to catch on the
 * FMP path and the reason `fetchIpoRows` throws on a missing key rather than
 * returning [].
 */
export async function readStoredIpoFilings(): Promise<IpoFilerRecord[] | null> {
  if (!redis) return null;
  try {
    const stored = await redis.get<StoredIpoFilings>(IPO_FILINGS_REDIS_KEY);
    if (!stored || !Array.isArray(stored.records)) return null;
    return stored.records;
  } catch (err) {
    // A read failure is "could not answer", not "none" -- return null, and say
    // so loudly, because the difference decides what the page publishes.
    console.error(`[ipo:filings] redis read failed:`, err);
    return null;
  }
}

/** Metadata without the payload, for /cache-health and the debug route. */
export async function readStoredIpoFilingsMeta(): Promise<{
  fetchedAt: number;
  windowDays: number;
  count: number;
} | null> {
  if (!redis) return null;
  try {
    const stored = await redis.get<StoredIpoFilings>(IPO_FILINGS_REDIS_KEY);
    if (!stored || !Array.isArray(stored.records)) return null;
    return {
      fetchedAt: stored.fetchedAt,
      windowDays: stored.windowDays,
      count: stored.records.length,
    };
  } catch {
    return null;
  }
}
