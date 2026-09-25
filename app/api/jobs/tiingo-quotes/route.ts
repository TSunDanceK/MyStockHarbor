import { NextRequest, NextResponse } from "next/server";
import { runTiingoQuotes, runSummary } from "../../../../lib/server/marketData/jobs";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { guardJob } from "../../../../lib/server/jobGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// TIINGO (#553 COWORK #55 §2, #56, #57). Hourly IEX quotes into msh:tiingo:quotes:v1 (one HSET), then revalidateTag('prices'). Acts only inside the buffered market window.
//
// One of the only two routes that may import lib/server/marketData/jobs.ts,
// the only importer of the adapter (scripts/check-tiingo-callers.mjs). No page
// or visitor-facing route reaches Tiingo.

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
    const result = await runTiingoQuotes();
    console.log("[tiingo-quotes]", JSON.stringify(result));
    await recordJobRun("tiingo-quotes", result.ok !== false, runSummary(result));
    return NextResponse.json(result, { status: result.ok === false ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "tiingo-quotes failed";
    await recordJobRun("tiingo-quotes", false, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// RUNAWAY-COST GUARD: kill switch, daily circuit breaker, per-run command
// budget, stop on Redis errors. See lib/server/jobGuard.ts.
export const GET = guardJob("tiingo-quotes", handleGET);
