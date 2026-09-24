import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import {
  CAPEX_RECEIVERS_COMMANDS_PER_RUN,
  CAPEX_RECEIVERS_MAX_PARSE_PER_RUN,
  readStoredReceivers,
  refreshReceivers,
  writeStoredReceivers,
} from "@/lib/server/capexReceivers";
import { receiverEntries } from "@/lib/server/capexReceiverList";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// DAILY: bring each curated "who is receiving" line up to its newest annual
// filing (#563 COWORK #2). See lib/server/capexReceivers.ts.
//
// REDIS: one GET and one SET on msh:capex:receivers:v1, plus the one SET
// recordJobRun spends on the shared job-run record. The page reads the key
// with one GET per render.
//
// SEC: one submissions request per company (~44, paced under 10/second), and
// three more (index.json, instance, label linkbase) only for a company whose
// newest annual filing is one the store has not read. That is ~45 a year.

const SEC_UA = process.env.SEC_USER_AGENT || "";

async function authorize(req: NextRequest): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth === `Bearer ${secret}`) return null;
  return guardDebugRequest(req);
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const started = Date.now();
  const url = new URL(req.url);

  if (!SEC_UA) {
    const summary = { ok: false, error: "SEC_USER_AGENT is not set" };
    await recordJobRun("capex-receivers", false, summary);
    return NextResponse.json(summary, { status: 503 });
  }

  // A debug-looking parameter must not mutate live state: dryRun reads and
  // reports, and writes nothing.
  const dryRun = url.searchParams.get("dryRun") === "1";
  const maxParse = Math.max(
    0,
    Math.min(45, Number(url.searchParams.get("maxParse") ?? CAPEX_RECEIVERS_MAX_PARSE_PER_RUN))
  );

  const entries = receiverEntries();
  const stored = await readStoredReceivers();
  const result = await refreshReceivers(entries, stored, SEC_UA, new Date(), maxParse);
  const write = dryRun ? { ok: true, reason: "dryRun=1 — nothing written" } : await writeStoredReceivers(result.doc);

  const ok = write.ok && result.failed === 0;
  const summary = {
    ok,
    dryRun,
    lines: result.doc.lines.length,
    newerFilings: result.newer,
    parsed: result.parsed,
    // Newer filings left for the next run because this one hit maxParse.
    deferred: result.deferred,
    // Lines holding their last good reading because the newer filing dropped
    // or relabelled the curated member. Review these; never auto-substitute.
    flagged: result.doc.lines
      .filter((l) => l.flags.some((f) => f !== "fetch-failed"))
      .map((l) => `${l.ticker} ${l.element}: ${l.flags.join(",")}`)
      .join("; "),
    fetchFailed: result.failed,
    storeWasEmpty: stored === null,
    write: write.reason ?? "ok",
    redisCommands: dryRun ? 1 : CAPEX_RECEIVERS_COMMANDS_PER_RUN,
    ms: Date.now() - started,
  };
  await recordJobRun("capex-receivers", ok, summary);
  console.log("[capex-receivers]", JSON.stringify(summary));
  return NextResponse.json(summary, { status: ok ? 200 : 500 });
}
