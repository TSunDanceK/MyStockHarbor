import { NextResponse } from "next/server";
import {
  readDynamicUniverse,
  readStalestUniverseSlice,
  statDynamicUniverse,
} from "@/lib/server/dynamicUniverseCache";
import { guardDebugRequest } from "@/lib/server/backfillAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Debug-only route (same shape as the other app/api/debug/* routes) for the
// dynamic universe, added alongside the v1-blob -> v2-sorted-set migration.
//
// Why it exists: the v2 change swaps the storage underneath a value that five
// call sites depend on, and the read path has a deliberate fallback to the v1
// blob if v2 comes back empty (see readDynamicUniverse). That fallback means a
// broken v2 looks EXACTLY like a working one from the outside -- pages keep
// rendering, symbols keep appearing -- so without a way to see which path
// served the request, a silent regression could sit unnoticed indefinitely.
//
// `scored` and `seen` are the two sorted sets' cardinalities and should track
// each other closely; `entries` is what callers actually receive. The
// interesting failure signatures:
//   scored = 0, entries > 0  -> v2 is empty and the v1 fallback is serving.
//                               Check logs for the [dynamic-universe] warning.
//   scored > 0, entries = 0  -> v2 has data but the read is dropping it all
//                               (age filter or score/seen mismatch).
//   scored != seen (by much) -> the two sets have drifted out of step; pruning
//                               removes from both, so a gap means one write
//                               path failed partway.
//
// `stalest` is a sample from the rotation primitive the scan wheel will use --
// oldest-seen first. Reads only; costs one page view's worth of Redis.

export async function GET(request: Request) {
  const denied = await guardDebugRequest(request);
  if (denied) return denied;

  try {
    // SEQUENTIAL, deliberately not Promise.all. readDynamicUniverse performs
    // the one-time v1 -> v2 seed on its first call, so reading the cardinalities
    // concurrently races that seed and reports zsetScoredCount 0 /
    // servedFromLegacyFallback true on a request where the seed actually
    // SUCCEEDED. That happened live on the 2026-08-06 migration and read as a
    // failed migration for a few minutes. A diagnostic that cries wolf about
    // the fallback is worse than no diagnostic at all.
    const entries = await readDynamicUniverse();
    const [stat, stalest] = await Promise.all([
      statDynamicUniverse(),
      readStalestUniverseSlice(10),
    ]);

    const now = Date.now();
    const ages = entries
      .map((entry) => now - entry.lastSeen)
      .sort((a, b) => a - b);
    const scores = entries.map((entry) => entry.score);

    return NextResponse.json({
      zsetScoredCount: stat.scored,
      zsetSeenCount: stat.seen,
      setsInStep: stat.scored != null && stat.seen != null ? stat.scored === stat.seen : null,
      entries: entries.length,
      // If this is true while entries > 0, the v1 fallback is serving.
      servedFromLegacyFallback: stat.scored === 0 && entries.length > 0,
      scoreMax: scores.length ? Math.max(...scores) : null,
      scoreMin: scores.length ? Math.min(...scores) : null,
      oldestEntryAgeHours: ages.length ? Number((ages[ages.length - 1] / 3600000).toFixed(1)) : null,
      newestEntryAgeHours: ages.length ? Number((ages[0] / 3600000).toFixed(1)) : null,
      topByScore: entries.slice(0, 10).map((entry) => ({
        symbol: entry.symbol,
        score: entry.score,
      })),
      stalestSample: stalest,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "universe-size failed" },
      { status: 500 }
    );
  }
}
