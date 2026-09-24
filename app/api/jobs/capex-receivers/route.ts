import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import {
  RECEIVER_ENTRIES,
  readReceiversRecord,
  secFetchers,
  writeReceiversRecord,
} from "@/lib/server/capexReceivers";
import { refreshReceivers } from "@/lib/server/capexReceiversCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "Who is receiving" refresh (Relay C, #563 COWORK #2). Daily at 05:50 UTC,
// clear of the other SEC jobs (04:00 / 04:20 / 04:40 / 05:10, and sec-filings
// at :40) because SEC's rate limit is per requester, not per job.
//
// A full filing (instance ~4.5 MB) is read only when a company's latest annual
// accession changed -- ~44 times a year across the list -- and at most
// MAX_FILINGS per run, so a first run or a burst of 10-Ks drains over days
// instead of timing out. Redis: 1 GET, at most 1 SET (only on change), plus
// the job-run stamp.
const MAX_FILINGS = 12;
const BUDGET_MS = 200_000;

async function authorize(req: NextRequest): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth === `Bearer ${secret}`) return null;
  return guardDebugRequest(req);
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const force = url.searchParams.get("force") === "1";
  const maxFilings = Math.max(1, Math.min(45, Number(url.searchParams.get("max") ?? MAX_FILINGS)));

  try {
    const prev = await readReceiversRecord();
    const { record, changed, stats } = await refreshReceivers(RECEIVER_ENTRIES, prev, secFetchers, {
      now: Date.now(),
      maxFilings,
      budgetMs: BUDGET_MS,
      force,
    });
    const wrote = changed && !dryRun ? await writeReceiversRecord(record) : false;
    const summary = {
      rows: Object.keys(record.rows).length,
      flags: record.flags.length,
      ...stats,
      changed,
      wrote,
      dryRun,
    };
    // Healthy means every line has figures; flags alone (a renamed label) are
    // for a human to read on /cache-health, not a failed run.
    const ok = Object.keys(record.rows).length > 0 && (!changed || dryRun || wrote);
    await recordJobRun("capex-receivers", ok, summary);
    console.log("[capex-receivers]", JSON.stringify(summary));
    return NextResponse.json({ ok, ...summary, flagList: record.flags });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await recordJobRun("capex-receivers", false, { error });
    console.log("[capex-receivers]", JSON.stringify({ ok: false, error }));
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
