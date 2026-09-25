import { NextRequest, NextResponse } from "next/server";
import { runTiingoEod, runSummary } from "../../../../lib/server/marketData/jobs";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { guardJob } from "../../../../lib/server/jobGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// TIINGO (#553 COWORK #55 §2, #56, #57). Nightly EOD re-pull of every universe symbol into msh:tiingo:eod:v1:<SYM>, gated on the bulk file showing tonight's date, then revalidateTag('eod').
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
    const result = await runTiingoEod();
    console.log("[tiingo-eod]", JSON.stringify(result));
    await recordJobRun("tiingo-eod", result.ok !== false, runSummary(result));
    return NextResponse.json(result, { status: result.ok === false ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "tiingo-eod failed";
    await recordJobRun("tiingo-eod", false, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// RUNAWAY-COST GUARD: kill switch, daily circuit breaker, per-run command
// budget, stop on Redis errors. See lib/server/jobGuard.ts.
export const GET = guardJob("tiingo-eod", handleGET);
