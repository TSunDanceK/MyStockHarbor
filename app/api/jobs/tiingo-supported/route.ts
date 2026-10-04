import { NextRequest, NextResponse } from "next/server";
import { runTiingoSupported } from "../../../../lib/server/marketData/jobs";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { guardJob } from "../../../../lib/server/jobGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// TIINGO (#553 COWORK #121 §2). Daily: Tiingo's supported-ticker list into
// msh:tiingo:supported:v1, the stock-page cold fill's admission set. A missing
// list makes the cold fill refuse (fails closed).
//
// One of the routes that may import lib/server/marketData/jobs.ts
// (scripts/check-tiingo-callers.mjs).

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
    const result = await runTiingoSupported();
    console.log("[tiingo-supported]", JSON.stringify(result));
    await recordJobRun("tiingo-supported", result.ok !== false, {
      symbols: "symbols" in result ? (result.symbols ?? null) : null,
      rows: "rows" in result ? (result.rows ?? null) : null,
      skipped: "skipped" in result ? String(result.skipped) : null,
      error: "error" in result ? String(result.error) : null,
    });
    return NextResponse.json(result, { status: result.ok === false ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "tiingo-supported failed";
    await recordJobRun("tiingo-supported", false, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// RUNAWAY-COST GUARD: kill switch, daily circuit breaker, per-run command
// budget, stop on Redis errors. See lib/server/jobGuard.ts.
export const GET = guardJob("tiingo-supported", handleGET);
