import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { writeContractsRecord } from "@/lib/server/capexContracts";
import { buildContractsRecord } from "@/lib/server/capexContractsJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "Federal contracts" refresh (Relay C, #563 COWORK #1 D5). WEEKLY, Mondays
// 06:10 UTC: USAspending's 12-month window moves a month at a time, so a daily
// run would re-read the same totals. 10 recipient pages (3 at a time) plus one
// total, ~1-2 minutes against USAspending's 15-28 s cold responses.
//
// Redis: 1 SET a week (+ the job-run stamp). A failed recipient page writes
// nothing -- a partial list would silently under-state companies -- so the
// previous week's record keeps serving and the run reports itself unhealthy.
async function authorize(req: NextRequest): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth === `Bearer ${secret}`) return null;
  return guardDebugRequest(req);
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const started = Date.now();
  try {
    const { record, pagesFailed } = await buildContractsRecord(started);
    const wrote = record && !dryRun ? await writeContractsRecord(record) : false;
    const summary = {
      ok: Boolean(record) && (dryRun || wrote),
      pagesFailed,
      recipientsRead: record?.recipientsRead ?? 0,
      rows: record?.rows.length ?? 0,
      mappedBn: record ? Math.round(record.mappedAmount / 1e8) / 10 : null,
      window: record ? `${record.window.start}..${record.window.end}` : null,
      wrote,
      dryRun,
      seconds: Math.round((Date.now() - started) / 1000),
    };
    await recordJobRun("capex-contracts", summary.ok, summary);
    console.log("[capex-contracts]", JSON.stringify(summary));
    return NextResponse.json({ ...summary, top: record?.rows.slice(0, 10).map((r) => [r.ticker, Math.round(r.amount / 1e6)]) ?? [] }, { status: summary.ok ? 200 : 502 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await recordJobRun("capex-contracts", false, { error });
    console.log("[capex-contracts]", JSON.stringify({ ok: false, error }));
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
