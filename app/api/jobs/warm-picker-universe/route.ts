// app/api/jobs/warm-picker-universe/route.ts
//
// Thin re-export — all build logic lives in lib/server/pickersBuilder.ts,
// shared with /api/pickers so the two entry points can never drift out of
// sync again. This route exists as a distinct URL purely so the daily
// GitHub Actions warm-up workflow (see PICKERS_EARNINGS_WARM_AUTOMATION.md,
// project doc) has a clearly-named target to hit and so Vercel logs/
// Observability can distinguish scheduled warm-up hits from organic
// traffic — the underlying handler is identical to /api/pickers.
// Neither pickers entry point set maxDuration, so the full universe build ran
// on Vercel's default limit -- a timeout cliff at ANY universe size, and one
// that would bite silently as UNIVERSE_CAP grows. Set explicitly.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

import { readHistoryDropCounts } from "@/lib/server/historyCache";
import type { NextRequest } from "next/server";
import { GET as buildPickerUniverse } from "../../../../lib/server/pickersBuilder";
import { recordJobRun } from "../../../../lib/server/jobRuns";

// WRAPPED, NOT REWRITTEN. This stays the identical handler -- the whole point of
// the re-export is that this route and /api/pickers can never drift -- with one
// run record added around it.
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
    recorded = true;
    await recordJobRun("warm-picker-universe", res.ok, {
      status: res.status,
      historyRowsParsed: drops.rowsParsed,
      historyRowsDroppedNoClose: drops.rowsDroppedNoClose,
      historyDropSymbols: drops.symbols.join(",") || null,
    });
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "warm-picker-universe failed";
    // Discarded, not reported: a partial run's drop count would be attributed to
    // the next successful run and inflate it.
    if (!recorded) readHistoryDropCounts();
    await recordJobRun("warm-picker-universe", false, { error: message });
    throw error;
  }
}
