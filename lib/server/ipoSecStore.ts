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
// changed that day. See app/api/jobs/ipo-refresh and lib/server/ipoIngest.ts.
//
// ── A CORRECTION, LEFT IN PLACE RATHER THAN DELETED ────────────────────────
// This paragraph used to end: "The 90-day cold start is seeded once from
// form.idx on a runner, never backfilled a day at a time from a function."
// That was written while the runner was still expected to do the writing. IT
// CANNOT: relay.yml holds the read-only Upstash token by deliberate choice, so
// the seed can build the document and not store it. The cold start is therefore
// the same day-at-a-time walk as the standing path, bounded per run and
// reporting how far it has reached. scripts/ipo-seed.mjs remains the
// form.idx-based measurement instrument it always was; it is no longer the
// thing that fills this key.
import { Redis } from "@upstash/redis";

import { PAGE_READ_CACHE } from "./redisCacheMode";
import type { IpoFilerRecord } from "./ipoSecSource";
import {
  mergeIpoRecords,
  validateStored,
  windowStartFor,
  type StoredIpoFilings,
} from "./ipoRecordMerge";

// v1, and versioned from the start: the record shape carries parsed cover terms,
// and the parser is a heuristic that has already been rebuilt once. A shape
// change must not be read back through an old reader.
export const IPO_FILINGS_REDIS_KEY = "msh:ipo:filings:v1";

// ── THE COMMAND BUDGET IS THE DESIGN CONSTRAINT ────────────────────────────
// Upstash bills COMMANDS, and this project has already been taken down once by
// cache usage (claude/outage-upstash-suspended-2026-08-28.md). So the whole
// window lives under ONE key and a refresh is exactly:
//
//     1x GET   the current document
//     1x SET   the merged-and-pruned document
//
// TWO COMMANDS A DAY. Not per-CIK keys, not per-row writes: ~700 filers written
// individually would be ~700 commands daily against a $50 cap, which is the
// shape of the outage rather than a smaller version of this design.
//
// The cost of one key is that a write is a read-modify-write and two concurrent
// writers would clobber each other. That is acceptable HERE and would not be
// elsewhere: there is exactly one writer, it runs once a day, and losing a day
// of appends self-heals on the next run because the window is re-derived from
// EDGAR rather than accumulated blindly.
export const IPO_REFRESH_COMMANDS_PER_RUN = 2;


// PAGE_READ_CACHE, BECAUSE /upcoming-ipos IS A PRERENDERED ROUTE AND THIS
// CLIENT IS IN ITS MODULE GRAPH. readStoredIpoFilings is called by
// fetchSecIpoRows, which the page reaches through getIpoTables. @upstash/redis
// defaults every REST call to `cache: "no-store"`, and under the App Router
// that one hint opts the route out of static rendering -- silently, because
// readFeed swallows the DynamicServerError and the only symptom is an `f` in
// the build's route table.
//
// THIS WAS A BARE CLIENT AND scripts/check-page-read-cache.mjs CAUGHT IT --
// which is the point of that check deriving reachability from the import graph
// rather than trusting a list. The page declares `revalidate = 86400`; a
// no-store hint here would have quietly made that number describe a cadence the
// page does not have, exactly as claude/traps/fetch-revalidate-caps-the-page.md
// records happening to this same route once already.
//
// It introduces no staleness: Upstash's REST API is POST and Next's fetch cache
// only caches GET, so no read here becomes cacheable. See redisCacheMode.ts.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
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

/**
 * Merge a refresh into the stored window. TWO COMMANDS: one GET, one SET.
 *
 * Returns what happened, never throws on a refused write -- the caller decides
 * whether a failure is fatal, and a read-only token refusing a SET is a correct
 * refusal rather than a bug to retry around.
 */
export async function writeStoredIpoFilings(
  incoming: IpoFilerRecord[],
  options: {
    now?: Date;
    /**
     * The watermark to store. OMITTED MEANS "KEEP THE ONE ALREADY THERE" --
     * which is why it is resolved here rather than in mergeIpoRecords: this is
     * the only place that holds the prior document. A run that walked no dates
     * (every one failed) must not reset the watermark to null and send the next
     * run back 90 days.
     */
    lastIndexDate?: string | null;
  } = {}
): Promise<{
  ok: boolean;
  reason: string | null;
  commands: number;
  before: number;
  after: number;
  pruned: number;
  lastIndexDate: string | null;
}> {
  const now = options.now ?? new Date();
  if (!redis) {
    return { ok: false, reason: "no Upstash credentials in this environment", commands: 0, before: 0, after: 0, pruned: 0, lastIndexDate: null };
  }

  let existing: IpoFilerRecord[] = [];
  let priorWatermark: string | null = null;
  let commands = 0;
  try {
    const stored = await redis.get<StoredIpoFilings>(IPO_FILINGS_REDIS_KEY); // COMMAND 1
    commands += 1;
    if (stored && Array.isArray(stored.records)) existing = stored.records;
    priorWatermark = stored?.lastIndexDate ?? null;
  } catch (err) {
    return { ok: false, reason: `read failed: ${String(err)}`, commands, before: 0, after: 0, pruned: 0, lastIndexDate: null };
  }

  // NEVER GOES BACKWARDS. A caller replaying an older date range (the `from`
  // override exists exactly for that) would otherwise rewind the watermark and
  // make the next scheduled run re-walk days already covered -- the defect
  // sec-daily-index had to fix after a from/to run moved its watermark
  // 20260912 -> 20260911.
  const lastIndexDate =
    options.lastIndexDate && (!priorWatermark || options.lastIndexDate > priorWatermark)
      ? options.lastIndexDate
      : priorWatermark;

  const doc = mergeIpoRecords(existing, incoming, windowStartFor(now), now.getTime(), { lastIndexDate });

  // VALIDATE BEFORE WRITING. A document that has outgrown the ceiling cannot be
  // fixed by writing it and noticing later -- at that point the stored value is
  // already the problem.
  const check = validateStored(doc);
  if (!check.ok) {
    return { ok: false, reason: check.reason, commands, before: existing.length, after: doc.records.length, pruned: 0, lastIndexDate };
  }

  try {
    await redis.set(IPO_FILINGS_REDIS_KEY, doc); // COMMAND 2
    commands += 1;
  } catch (err) {
    // A READ-ONLY TOKEN REFUSING THIS IS CORRECT, not a credential to debug.
    // relay.yml records that the repo's Actions secret is read-only by
    // deliberate choice; changing that reverses a posture and is the owner's
    // call, not something to route around here.
    return { ok: false, reason: `write refused: ${String(err)}`, commands, before: existing.length, after: doc.records.length, pruned: 0, lastIndexDate };
  }

  const incomingCiks = new Set(incoming.map((r) => r.cik));
  const pruned = existing.filter(
    (r) => !doc.records.some((d) => d.cik === r.cik) && !incomingCiks.has(r.cik)
  ).length;

  return { ok: true, reason: null, commands, before: existing.length, after: doc.records.length, pruned, lastIndexDate };
}

/** Metadata without the payload, for /cache-health and the debug route. */
export async function readStoredIpoFilingsMeta(): Promise<{
  fetchedAt: number;
  windowDays: number;
  windowStart: string;
  lastIndexDate: string | null;
  count: number;
} | null> {
  if (!redis) return null;
  try {
    const stored = await redis.get<StoredIpoFilings>(IPO_FILINGS_REDIS_KEY);
    if (!stored || !Array.isArray(stored.records)) return null;
    return {
      fetchedAt: stored.fetchedAt,
      windowDays: stored.windowDays,
      windowStart: stored.windowStart,
      // NULL IS A REAL ANSWER HERE -- "the walk has never run" -- and reads
      // differently from a missing key, which is "could not answer".
      lastIndexDate: stored.lastIndexDate ?? null,
      count: stored.records.length,
    };
  } catch {
    return null;
  }
}
