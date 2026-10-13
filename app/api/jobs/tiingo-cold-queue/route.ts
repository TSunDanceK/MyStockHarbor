import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { drainColdQueue } from "../../../../lib/server/marketData/coldFill";
import { eodSymbolTag } from "../../../../lib/server/marketData/keys";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { guardJob } from "../../../../lib/server/jobGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// TIINGO (#553 COWORK #121/#122/#123). Every 10 minutes: fill the stock-page
// cold fill's queue (crawlers, visitors over their cap, timeouts), and drop
// requested symbols unviewed for 30 days. Production only (the "job" path).
//
// One of the only two importers of lib/server/marketData/coldFill.ts, with the
// stock page's server action (scripts/check-tiingo-callers.mjs).

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function handleGET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await drainColdQueue(Date.now(), (sym) => {
      revalidateTag(eodSymbolTag(sym), "max");
      revalidatePath(`/stock/${sym}`);
    });
    console.log("[tiingo-cold-queue]", JSON.stringify(result));
    await recordJobRun("tiingo-cold-queue", result.ok, {
      queued: result.queued,
      filled: result.filled,
      noData: result.noData,
      failed: result.failed,
      refused: result.refused,
      idleDropped: result.idleDropped,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "tiingo-cold-queue failed";
    await recordJobRun("tiingo-cold-queue", false, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// RUNAWAY-COST GUARD: kill switch, daily circuit breaker, per-run command
// budget, stop on Redis errors. See lib/server/jobGuard.ts.
export const GET = guardJob("tiingo-cold-queue", handleGET);
