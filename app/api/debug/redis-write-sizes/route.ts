import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { PAGE_READ_CACHE } from "@/lib/server/redisCacheMode";
import {
  projectBodyBytes,
  pctOfRequestLimit,
  MEASURED_ESCAPING_AT,
  MEASURED_ESCAPING_INFLATION,
  MEASURED_ESCAPING_SOURCE,
  REQUEST_BYTE_BUDGET,
  UPSTASH_MAX_REQUEST_BYTES,
} from "@/lib/server/chunkByBytes";
import { SEC_MANIFEST_KEY } from "@/lib/server/secManifest";
import { TICKER_REDIS_KEY } from "@/lib/server/secTickerMap";
import { SCHEDULE_KEY } from "@/lib/server/earningsSchedule";
import { PRICE_POOL_KEY } from "@/lib/server/pricePool";
import { SECTOR_INDEX_KEY } from "@/lib/server/sectorUniverse";
import { TIER1_KEY } from "@/lib/server/priceTiers";
import { IPO_FILINGS_REDIS_KEY } from "@/lib/server/ipoSecStore";
import { PICKER_CHARTS_KEY } from "@/lib/server/pickerChartsCache";
import {
  PICKERS_MANIFEST_KEY,
  PICKERS_SYMBOLS_KEY,
} from "@/lib/server/pickersBuilder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// WHICH KEY IS NEAR THE 10MB WALL, ANSWERABLE IN ONE REQUEST.
//
// ── THE PROBLEM THIS EXISTS FOR ──────────────────────────────────────────
// Upstash's "Your Max Request Size Limit is Reached" email names a database and
// a fifteen-minute window. It does not name a key, a route or a command. An
// over-limit operation returns an error rather than truncating, and every write
// path in this codebase is (correctly) fail-open, so the rejection is swallowed
// and nothing reaches Vercel's logs. claude/upstash-request-size-2026-09-11.md
// had to diagnose the 2026-09 breaches BY ELIMINATION, one hand-typed STRLEN at
// a time, and got a probable answer rather than a certain one.
//
// This is that elimination as a route. It reports every key this codebase
// writes as ONE WHOLE-COLLECTION VALUE -- the shape that can breach with no
// chunking anywhere in its path -- ranked by projected request body, so the
// next email is attributable before anyone opens a file.
//
// ── IT COSTS ALMOST NOTHING, DELIBERATELY ────────────────────────────────
// STRLEN and HLEN are O(1) and return an integer. This route never GETs a
// value, because a route built to investigate 10MB requests must not issue one:
// pulling every candidate back to measure it exactly would move tens of
// megabytes per call and could trip the very limit it is reporting on. The
// stored length is exact; only the escaping is projected, from the figure
// #428's instrumentation measures on every build rather than from the 15%
// §4 of the brief guessed at.
//
// ── WHAT IT CANNOT SEE, STATED RATHER THAN IMPLIED ───────────────────────
// A hash's ENTRY is what gets written, never the whole hash, so `storedBytes`
// is null for one and the row reports field count plus the module's own write
// chunk size instead. That is a count-bounded chunk -- the exact proxy-for-bytes
// defect chunkByBytes.ts exists to replace -- so the sampled per-field size is
// what makes those rows mean anything, and it is sampled, not summed.
//
// A key at 0 bytes is ABSENT, not empty: `exists` says which, because "the
// write never landed" and "the write landed small" are different failures and
// the first is the one this route was built to catch.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

type Candidate = {
  key: string;
  /** The module that owns the write, so a hot row leads straight to a file. */
  owner: string;
  /** Which job writes it and roughly when, in UTC -- the email gives a window. */
  writtenBy: string;
  /**
   * `string` = one SET of the whole collection, the shape that can breach on
   * its own. `hash` = HSET in chunks; the row reports the chunk, not the hash.
   */
  shape: "string" | "hash";
  /** For a hash: how many fields the owning module puts in one HSET. */
  writeChunkFields?: number;
  note?: string;
};

// EVERY WHOLE-COLLECTION WRITE IN THE CODEBASE, and the list is the point.
// A key missing from here is a key nobody is watching, which is how
// secManifest.ts sat outside scripts/check-request-size.mjs for two releases.
const CANDIDATES: Candidate[] = [
  {
    key: SEC_MANIFEST_KEY,
    owner: "lib/server/secManifest.ts writeManifest()",
    writtenBy: "sec-daily-index 04:00 UTC, sec-facts 04:20 UTC",
    shape: "string",
    note:
      "Unchunked by design (ONE KEY, ONE GET, ONE SET). Entry count is a " +
      "high-water mark: nothing deletes a symbol, so it only ever grows.",
  },
  {
    key: TICKER_REDIS_KEY,
    owner: "lib/server/secTickerMap.ts refreshTickerMap()",
    writtenBy: "sec-daily-index 04:00 UTC, at most weekly",
    shape: "string",
    note: "Every ticker SEC publishes (~10.4k), not the analysis universe.",
  },
  {
    key: SCHEDULE_KEY,
    owner: "lib/server/earningsSchedule.ts readEarningsSchedule()",
    writtenBy: "warm-stock-data (every 10 min), rebuilt once a day on TTL lapse",
    shape: "string",
    note:
      "Written from a read path on a cache miss, and its catch is bare -- an " +
      "Upstash rejection here logs NOTHING at all.",
  },
  {
    key: SECTOR_INDEX_KEY,
    owner: "lib/server/sectorUniverse.ts",
    writtenBy: "sector pages / warm paths",
    shape: "string",
  },
  {
    key: TIER1_KEY,
    owner: "lib/server/priceTiers.ts",
    writtenBy: "price tier rotation, hourly",
    shape: "string",
  },
  {
    key: IPO_FILINGS_REDIS_KEY,
    owner: "lib/server/ipoSecStore.ts",
    writtenBy: "ipo-refresh 04:40 UTC",
    shape: "string",
    note: "One document covering every tracked filing.",
  },
  {
    key: PICKERS_MANIFEST_KEY,
    owner: "lib/server/pickersBuilder.ts writePickersChunked()",
    writtenBy: "warm-picker-universe 07:02 UTC",
    shape: "string",
    note:
      "The payload HEAD -- every field except signalRecords. It is the one " +
      "request whose size does NOT fall with the chunk budget.",
  },
  {
    key: PICKERS_SYMBOLS_KEY,
    owner: "lib/server/pickersBuilder.ts writePickersChunked()",
    writtenBy: "warm-picker-universe 07:02 UTC",
    shape: "string",
  },
  {
    key: PRICE_POOL_KEY,
    owner: "lib/server/pricePool.ts",
    writtenBy: "warm-price-pool, every 5 min",
    shape: "hash",
    note:
      "ONE UNCHUNKED HSET of every refreshed row -- a hash, but not a chunked " +
      "one, so writeChunkFields is the whole field count rather than a cap.",
  },
  {
    key: PICKER_CHARTS_KEY,
    owner: "lib/server/pickerChartsCache.ts writePickerChartsBulk()",
    writtenBy: "warm-picker-universe 07:02 UTC",
    shape: "hash",
    writeChunkFields: 40,
    note: "Chunked by COUNT (40), not by bytes -- safe while a series stays ~11KB.",
  },
];

/** Never throws: one unreadable key must not cost the other twelve. */
async function probe(client: Redis, candidate: Candidate) {
  const base = {
    key: candidate.key,
    owner: candidate.owner,
    writtenBy: candidate.writtenBy,
    shape: candidate.shape,
    note: candidate.note ?? null,
  };

  try {
    const exists = (await client.exists(candidate.key)) === 1;
    if (!exists) {
      return { ...base, exists: false, error: null };
    }

    const ttlSeconds = await client.ttl(candidate.key);

    if (candidate.shape === "string") {
      const storedBytes = await client.strlen(candidate.key);
      const bodyBytes = projectBodyBytes(storedBytes);
      return {
        ...base,
        exists: true,
        ttlSeconds,
        storedBytes,
        projectedBodyBytes: bodyBytes,
        pctOfRequestLimit: pctOfRequestLimit(bodyBytes),
        overBudget: bodyBytes > REQUEST_BYTE_BUDGET,
        error: null,
      };
    }

    const fields = await client.hlen(candidate.key);

    // SAMPLED, AND SAID SO. Three fields is enough to separate "11KB a row"
    // from "110KB a row", which is the only distinction that changes an answer
    // here, and it keeps this route's own reads in the kilobytes.
    const names = ((await client.hkeys(candidate.key)) ?? []).slice(0, 3);
    let sampledBytes = 0;
    let sampled = 0;
    for (const name of names) {
      const value = await client.hget(candidate.key, name);
      if (value === null || value === undefined) continue;
      sampledBytes += Buffer.byteLength(
        typeof value === "string" ? value : JSON.stringify(value),
        "utf8"
      );
      sampled++;
    }

    const avgFieldBytes = sampled ? Math.round(sampledBytes / sampled) : null;
    const chunkFields = candidate.writeChunkFields ?? fields;
    const projected =
      avgFieldBytes === null ? null : projectBodyBytes(avgFieldBytes * chunkFields);

    return {
      ...base,
      exists: true,
      ttlSeconds,
      fields,
      sampledFields: sampled,
      avgFieldBytes,
      writeChunkFields: chunkFields,
      projectedBodyBytes: projected,
      pctOfRequestLimit: projected === null ? null : pctOfRequestLimit(projected),
      overBudget: projected === null ? null : projected > REQUEST_BYTE_BUDGET,
      error: null,
    };
  } catch (error) {
    // Reported as a row rather than dropped: a key that cannot be probed is a
    // finding, and a silently shorter list would read as a clean bill of health.
    return {
      ...base,
      exists: null,
      error: error instanceof Error ? error.message : "probe failed",
    };
  }
}

export async function GET(request: Request) {
  const denied = await guardDebugRequest(request);
  if (denied) return denied;

  if (!redis) {
    return NextResponse.json(
      { ok: false, error: "Redis is not configured in this environment" },
      { status: 503 }
    );
  }

  // SEQUENTIAL, NOT Promise.all, and for the reason this whole route is about:
  // enableAutoPipelining defaults to TRUE in @upstash/redis (verified in the
  // installed 1.38.2: `opts?.enableAutoPipelining ?? true`), so concurrent
  // commands collapse into ONE request body. Awaiting each keeps every probe
  // its own small request.
  const rows: Awaited<ReturnType<typeof probe>>[] = [];
  for (const candidate of CANDIDATES) rows.push(await probe(redis, candidate));

  // BIGGEST FIRST. A row with no projection (absent, or a probe that threw)
  // sorts to the bottom as 0 rather than being dropped -- it is still a
  // finding, just not a size one.
  const projectedOf = (row: (typeof rows)[number]): number => {
    const value = (row as { projectedBodyBytes?: number | null }).projectedBodyBytes;
    return typeof value === "number" ? value : 0;
  };
  rows.sort((a, b) => projectedOf(b) - projectedOf(a));

  return NextResponse.json({
    ok: true,
    requestLimitBytes: UPSTASH_MAX_REQUEST_BYTES,
    budgetBytes: REQUEST_BYTE_BUDGET,
    escaping: {
      factor: MEASURED_ESCAPING_INFLATION,
      measuredAt: MEASURED_ESCAPING_AT,
      source: MEASURED_ESCAPING_SOURCE,
    },
    // What this route CANNOT answer, so nobody reads a clean list as a
    // clean bill of health: the pickers signalRecord chunks are written under
    // a build-scoped prefix nothing here can enumerate, and the builder logs
    // their sizes itself on every build.
    notCovered:
      "msh:pickers:v10:chunk:<buildId>:<i> -- build-scoped, and already " +
      "measured by writePickersChunked's own log line.",
    keys: rows,
  });
}
