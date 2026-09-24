import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { readContractsRecord, writeContractsRecord } from "@/lib/server/capexContracts";
import { buildContractsRecord } from "@/lib/server/capexContractsJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The record is rebuilt when it is at least this old: weekly data. */
const CONTRACTS_FRESH_DAYS = 6.5;

// "Federal contracts" refresh (Relay C, #563 COWORK #1 D5). WEEKLY DATA FROM A
// DAILY CRON (06:10 UTC): USAspending's 12-month window moves a month at a
// time, so the record is rebuilt only when it is CONTRACTS_FRESH_DAYS old.
//
// WHY THE CRON IS DAILY. /cache-health judges a job's silence from its cron's
// minute and hour fields only (cronIntervalSeconds), so a Mondays-only cron
// reads as a daily job that has gone quiet six days in seven. Firing daily and
// recording "up to date" keeps that signal honest.
//
// Each rebuild reads 10 recipient pages (3 at a time) plus one total, inside
// CONTRACTS_DEADLINE_MS.
//
// Redis: 1 GET a day for the record's age; 1 SET a week (+ the job-run
// stamp). A failed recipient page, or a read too small to be real, writes
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
  const params = new URL(req.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  const force = params.get("force") === "1";
  const started = Date.now();
  try {
    const held = await readContractsRecord();
    const ageDays = held ? (started - held.builtAt) / 864e5 : Infinity;
    if (!force && !dryRun && ageDays < CONTRACTS_FRESH_DAYS) {
      const summary = { ok: true, upToDate: true, ageDays: Math.round(ageDays * 10) / 10, redisCommands: 1 };
      await recordJobRun("capex-contracts", true, summary);
      return NextResponse.json(summary);
    }
    const built = await buildContractsRecord(started);
    const { pagesFailed } = built;
    // A read too small to be real is a failed read, not a quiet week: 10 pages
    // of 100 recipients and a top list of at least 10 companies, or nothing.
    const plausible = Boolean(built.record && built.record.recipientsRead >= 500 && built.record.rows.length >= 10);
    const record = plausible ? built.record : null;
    const wrote = record && !dryRun ? await writeContractsRecord(record) : false;
    const summary = {
      ok: Boolean(record) && (dryRun || wrote),
      implausible: Boolean(built.record) && !plausible,
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
