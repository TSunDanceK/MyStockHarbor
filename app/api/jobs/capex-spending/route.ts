import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { readSpendingRecord, writeSpendingRecord } from "@/lib/server/capexSpending";
import { buildSpendingRecord } from "@/lib/server/capexSpendingJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "Who is spending" refresh (Relay C, #563 COWORK #1 D1). WEEKLY DATA FROM A
// DAILY CRON (06:30 UTC, after sec-facts at 04:20): annual figures change only
// when a 10-K lands, so the record is rebuilt when it is SPENDING_FRESH_DAYS
// old. The cron is daily because /cache-health reads a cron's minute and hour
// only; a weekly cron would read as a stalled daily job.
//
// Redis: 1 GET a day for the record's age. On a rebuild: one MGET per 100
// fact-set keys (~2,700 keys, so ~27), 1 SET (+ the job-run stamp).
const SPENDING_FRESH_DAYS = 6.5;

async function authorize(req: NextRequest): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth === `Bearer ${secret}`) return null;
  return guardDebugRequest(req);
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  const force = params.get("force") === "1";
  const started = Date.now();
  try {
    const held = await readSpendingRecord();
    const ageDays = held ? (started - held.builtAt) / 864e5 : Infinity;
    if (!force && !dryRun && ageDays < SPENDING_FRESH_DAYS) {
      const summary = { ok: true, upToDate: true, ageDays: Math.round(ageDays * 10) / 10, redisCommands: 1 };
      await recordJobRun("capex-spending", true, summary);
      return NextResponse.json(summary);
    }
    const built = await buildSpendingRecord(started);
    // A build that read too little to be real is a failed build: keep last week's.
    const plausible = Boolean(built.record && built.setsRead >= 200 && built.record.sectors.length >= 8);
    const record = plausible ? built.record : null;
    const wrote = record && !dryRun ? await writeSpendingRecord(record) : false;
    const summary = {
      ok: Boolean(record) && (dryRun || wrote),
      implausible: Boolean(built.record) && !plausible,
      error: built.error ?? null,
      symbols: built.symbols,
      setsRead: built.setsRead,
      staleFieldOrder: built.staleFieldOrder,
      sectors: built.record?.sectors.length ?? 0,
      otherCurrency: built.record?.otherCurrency ?? 0,
      unclassified: built.record?.unclassified ?? 0,
      duplicateListings: built.record?.duplicateListings ?? 0,
      years: built.record ? `${built.record.years[0]}..${built.record.years[built.record.years.length - 1]}` : null,
      wrote,
      dryRun,
      redisCommands: 1 + built.commands + (wrote ? 1 : 0),
      seconds: Math.round((Date.now() - started) / 1000),
    };
    await recordJobRun("capex-spending", summary.ok, summary);
    console.log("[capex-spending]", JSON.stringify(summary));
    return NextResponse.json(summary, { status: summary.ok ? 200 : 502 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await recordJobRun("capex-spending", false, { error });
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
