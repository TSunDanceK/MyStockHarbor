// app/api/jobs/warm-picker-universe/route.ts
//
// Thin re-export — all build logic lives in lib/server/pickersBuilder.ts,
// shared with /api/pickers so the two entry points can never drift out of
// sync again. This route exists as a distinct URL so the scheduled warm has a
// clearly-named target to hit and so Vercel logs/Observability can distinguish
// warm-up hits from organic traffic — the underlying handler is identical to
// /api/pickers.
//
// THE SCHEDULE IS vercel.json's `2 7 * * *`, not GitHub's. This comment used to
// name "the daily GitHub Actions warm-up workflow" as the caller; that
// workflow's schedule was removed on 2026-09-03 after it was measured never
// firing within half an hour of its cron and eventually not at all. It still
// exists as a MANUAL lever (workflow_dispatch), which is why it still appears
// in PICKERS_EARNINGS_WARM_AUTOMATION.md — but it is no longer what wakes this
// route on an ordinary day.
// Neither pickers entry point set maxDuration, so the full universe build ran
// on Vercel's default limit -- a timeout cliff at ANY universe size, and one
// that would bite silently as UNIVERSE_CAP grows. Set explicitly.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

import {
  HISTORY_MAX_BAR_AGE_WEEKDAYS,
  readHistoryBarAgeCounts,
  readHistoryDropCounts,
} from "@/lib/server/historyCache";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { PICKER_ROUTES } from "@/lib/pickerRoutes";
import { GET_WARM as buildPickerUniverse } from "../../../../lib/server/pickersBuilder";
import { readLastBuildStats } from "../../../../lib/server/pickersBuilder";
import { recordJobRun } from "../../../../lib/server/jobRuns";

// WRAPPED, NOT REWRITTEN. This stays the identical handler -- the whole point of
// the re-export is that this route and /api/pickers can never drift -- with one
// run record added around it.
//
// GET_WARM vs GET is NOT a second copy. Both are one-line calls into the same
// handlePickersRequest; the only difference is that this one asks for a forced
// history refetch. That ask is authorised inside the handler (cron secret or
// owner key), so importing GET_WARM here grants this route nothing it could not
// already prove.
//
// WHY THE FORCE IS NEEDED AT ALL. getDailyHistoryBulk is miss-only, and the
// Redis history TTL is now 50h. Without a force this job would find every symbol
// present, fetch nothing, and record a successful run that refreshed zero bars
// -- a green job doing no work, which is worse than a red one.
//
// Only the status is recorded. Reading the body to build a richer summary would
// mean cloning a payload that carries the entire picker universe, on a route
// whose own comment records a timeout cliff; the question this answers is "did
// the daily build run, and did it succeed".
export async function GET(req: NextRequest) {
  // READ-AND-DISCARD IN THE CATCH, not a finally.
  //
  // The counters are module state and a warm Lambda is reused across
  // invocations, so a throw between the parse and the read leaves them sitting
  // there to be attributed to whichever invocation reads next. A failed run
  // silently donating its drops to the next good one is the wrong direction to
  // be wrong in, because the flush decision rests on that number being an
  // undercount at worst rather than an overcount.
  //
  // A `finally` would have been tidier and is wrong here: on the success path it
  // would run AFTER the read, and on the failure path the counts have to be
  // discarded rather than recorded -- a failed run's partial drops are not a
  // measurement of anything. `recorded` distinguishes the two.
  let recorded = false;
  try {
    const res = await buildPickerUniverse(req);
    // Read from module state, NOT from the response body -- the note above about
    // not cloning this route's payload still holds. This run fetches and parses
    // history for the whole universe, so it is the only place the figure is
    // large enough to mean anything.
    //
    // rowsParsed is reported with it deliberately: 0 drops out of 0 rows says
    // nothing at all, while 0 drops out of ~900k rows is real evidence the
    // zero-bar bug was latent rather than active. A non-zero count says it was
    // NOT latent, names up to 12 affected symbols, and makes flushing the
    // history namespace urgent rather than tidy.
    const drops = readHistoryDropCounts();
    const barAge = readHistoryBarAgeCounts();
    recorded = true;

    // "The warm ran" and "the warm refreshed anything" are different facts, and
    // only the first one is visible by default. The header is set by the handler
    // from the value it actually used, not from what this route asked for, so a
    // force that was refused (CRON_SECRET unset, say) shows as false here rather
    // than being assumed true.
    const historyForced = res.headers.get("X-Pickers-History-Forced") === "true";

    // NAMED FOR WHAT IT MEANS, NOT FOR HOW IT IS TRIGGERED. `historyForced true`
    // reads as "a human forced this run" -- which is how the owner read it on
    // first sight, on a page whose entire job is being unambiguous at a glance.
    // What it actually distinguishes is whether this run REFETCHED EVERY SYMBOL
    // or only filled cache misses, and with a 50h TTL the miss-only case
    // refreshes essentially nothing.
    //
    // The old key is written alongside for one cycle. Nothing in this repo reads
    // it -- /cache-health renders whatever keys the summary carries -- but a
    // run record is the kind of thing someone greps for, and one cycle of
    // overlap costs nothing.
    const refreshMode = historyForced ? "forced" : "miss-only";

    if (!historyForced) {
      console.warn(
        "[warm-picker-universe] refreshMode=miss-only. With a 50h TTL the miss-only bulk read refreshes nothing, so this run almost certainly fetched no bars. Check CRON_SECRET is set in the Vercel project."
      );
    }

    // THE DATA CAN BE STALE WHILE EVERY OTHER COUNTER READS ZERO. A fetch that
    // succeeds and parses cleanly can still return bars days old; row drops
    // measure the parser, this measures the data, and they fail independently.
    if (barAge.stale > 0) {
      console.warn(
        `[warm-picker-universe] ${barAge.stale} of ${barAge.stale + barAge.fresh} refetched symbols have a newest bar more than ${HISTORY_MAX_BAR_AGE_WEEKDAYS} trading days old (newest seen anywhere: ${barAge.newestBarSeen ?? "none"}). Sample: ${barAge.symbols.join(", ")}`
      );
    }

    if (barAge.forcedRefetchFailures > 0) {
      console.warn(
        `[warm-picker-universe] ${barAge.forcedRefetchFailures} forced refetches threw and fell back to their cached entry. Reasons: ${barAge.forcedRefetchFailureReasons.join(", ") || "unclassified"}. Sample: ${barAge.forcedRefetchFailureSymbols.join(", ")}`
      );
    }

    if (!res.ok) {
      console.error(
        `[warm-picker-universe] Run FAILED with status ${res.status}. The 50h history TTL is the margin this run just spent -- a second consecutive failure leaves the picker universe rebuilding against expiring bars.`
      );
    }

    // Read from module state for the same reason the drop counters are: this
    // route must not clone a payload carrying the whole universe. `null` when
    // the request never reached a build (served from memo or cache), which is
    // itself the answer to "did the forced warm actually build".
    const build = readLastBuildStats();

    // THE INVARIANT, CHECKED WHERE IT CAN BE SEEN. A forced run must never yield
    // a thinner universe than an unforced one; that is the property the
    // per-symbol fallback in getDailyHistoryBulk exists to guarantee. If it ever
    // does, the run record and the log both say so rather than leaving it to be
    // noticed on a picker page.
    if (build && build.degradedFallbackUsed) {
      console.warn(
        `[warm-picker-universe] Degraded build REFUSED (${build.degradedSymbolPct}% symbol failure) -- the previous payload is still serving. The cache was NOT overwritten.`
      );
    }

    await recordJobRun("warm-picker-universe", res.ok, {
      status: res.status,
      refreshMode,
      historyForced, // deprecated 2026-08-24, remove after one cycle

      universeSize: build?.universeSize ?? null,
      degradedSymbolPct: build?.degradedSymbolPct ?? null,
      degradedFallbackUsed: build?.degradedFallbackUsed ?? null,
      payloadWritten: build?.wrote ?? null,
      historyRowsParsed: drops.rowsParsed,
      historyRowsDroppedNoClose: drops.rowsDroppedNoClose,
      historyDropSymbols: drops.symbols.join(",") || null,
      historyNewestBarSeen: barAge.newestBarSeen,
      historyStaleNewestCount: barAge.stale,
      historyFreshNewestCount: barAge.fresh,
      historyStaleNewestSymbols: barAge.symbols.join(",") || null,
      historyForcedRefetchFailures: barAge.forcedRefetchFailures,
      // RECORDED, NOT JUST WARNED. The count alone cannot answer the question
      // that matters -- is it the same symbols every morning, or a different
      // twenty each time? The first is a class of symbol and wants a name; the
      // second is capacity contention and wants a different fix.
      historyForcedRefetchFailureSymbols: barAge.forcedRefetchFailureSymbols.join(",") || null,
      // THE FIELD THAT ANSWERS IT OUTRIGHT rather than narrowing it. A count
      // plus a symbol list can only distinguish symbol-specific from not, and
      // transient network failure produces a different set every morning too --
      // so "different twenty" confirms nothing on its own. The reason histogram
      // is uncapped, so "capacity-timeout:20" and "http-429:18,network:2" are
      // both readable in one glance, and they want opposite fixes.
      historyForcedRefetchFailureReasons: barAge.forcedRefetchFailureReasons.join(",") || null,
    });

    // REGENERATE WHEN THE DATA MOVES, not when a timer expires.
    //
    // The picker pages sat at revalidate=300, so any request landing after the
    // window rebuilt the page -- and at ~46K requests/day against a few hundred
    // real weekly visitors, that is overwhelmingly scrapers cycling the cluster
    // and paying for a rebuild each time. 6.42M ISR writes a month against
    // 1.39M reads is the shape of pages regenerating for nobody.
    //
    // This run is what actually changes their content, so this is the honest
    // moment to invalidate them. The page constants stay as a backstop, raised
    // to 1800, for the case where a cron run is missed entirely.
    //
    // DERIVED, NOT TYPED. PICKER_ROUTES is checked against the filesystem by
    // scripts/check-picker-routes.mjs, so a page added without being listed
    // fails a check rather than quietly never revalidating -- which is the
    // failure mode a hand-typed list here would have had.
    let revalidated = 0;
    for (const route of PICKER_ROUTES) {
      try {
        revalidatePath(route);
        revalidated += 1;
      } catch {
        // One bad path must not cost the rest of the sweep, and it must not
        // fail a warm that has already done its real work.
      }
    }
    console.log(`[warm-picker-universe] revalidated ${revalidated}/${PICKER_ROUTES.length} picker routes`);

    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "warm-picker-universe failed";
    console.error(`[warm-picker-universe] Run THREW: ${message}`);
    // Discarded, not reported: a partial run's drop count would be attributed to
    // the next successful run and inflate it. Same for the bar-age counters --
    // a half-finished sweep's staleness ratio is not a measurement of anything.
    if (!recorded) {
      readHistoryDropCounts();
      readHistoryBarAgeCounts();
      readLastBuildStats();
    }
    await recordJobRun("warm-picker-universe", false, { error: message });
    throw error;
  }
}
