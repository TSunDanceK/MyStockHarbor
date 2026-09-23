import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { readFactSet } from "@/lib/server/secFactStore";
import { cikForSymbol } from "@/lib/server/secColdFetch";
import { SEC_REPORT_DATES_PREFIX, pairingRewriteDone, readReportDates } from "@/lib/server/secReportDatesStore";
import { RESULTS_DAYS_BACKFILL_BELOW, backfillResultsDays, resultsDaysCount } from "@/lib/server/secResultsDays";
import { buildAndWriteReportDates, rewriteQueue } from "@/lib/server/secReportDatesWrite";
import type { Submissions } from "@/lib/server/secReportDates";
import reportDatesRewrite from "@/data/sec/report-dates-rewrite.json";
import dueStripCut from "@/data/due-strip.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// THE PAIRING REWRITE: records the earliest-2.02 rule got wrong, rewritten once
// under the paired rule.
//
// ── WHY THIS IS ITS OWN JOB AND NOT A QUEUE INSIDE sec-facts ─────────────
// The list (data/sec/report-dates-rewrite.json, 209 filers, measured by
// scripts/early-202-census.mjs) was first queued inside the sec-facts cron.
// That cron has been timing out: production, 2026-09-22 04:20 UTC, "Task timed
// out after 300 seconds", and the last run it recorded is 2026-09-20. Its report-
// dates block runs AFTER the fact-set loop, so a backfill queued there never
// reaches its turn, and TSLA's record would still read "2 days" on Sep 30.
// Here it has its own 300s and needs about a minute.
//
// ── WHAT IT WRITES AND WHY IT FINISHES ───────────────────────────────────
// buildAndWriteReportDates, the same builder sec-facts uses, through the same
// gated writeReportDates. Every write sets `earlyNonResults` (null for a filer
// without the pattern), and pairingRewriteDone() tests the KEY, so every
// listed record drains after one successful write. A symbol with no fact set
// yet is skipped and counted as left, not written.
//
// ORDER: the due strip's cut first, since those records feed the forward
// sections a reader sees; then the list in its committed order.
//
// SEC PACING: 05:10 UTC, after sec-daily-index (04:00), sec-facts (04:20, capped
// at 300s) and ipo-refresh (04:40). SEC's limit is per requester, so the jobs
// must not overlap; this one paces its own calls at 8/s as they do.

/** A run's allowance. 209 listed; two runs drain it. */
const REWRITE_PER_RUN = 120;

const MIN_GAP_MS = 125;
const SEC_UA = process.env.SEC_USER_AGENT || "";
let lastAt = 0;

async function authorize(req: NextRequest): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth === `Bearer ${secret}`) return null;
  return guardDebugRequest(req);
}

async function fetchSubmissions(cik: string): Promise<Submissions> {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(
    `https://data.sec.gov/submissions/CIK${cik}.json`,
    { headers: { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new Error(`expected JSON, got ${ct}`);
  return (await res.json()) as Submissions;
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  if (!SEC_UA) {
    const summary = { ok: false, error: "SEC_USER_AGENT is unset" };
    await recordJobRun("sec-report-dates-rewrite", false, summary);
    return NextResponse.json(summary, { status: 503 });
  }

  const listed = reportDatesRewrite.symbols as string[];
  const records = await Promise.all(listed.map((s) => readReportDates(s)));
  const done = new Set(listed.filter((_, i) => pairingRewriteDone(records[i])));
  const queue = rewriteQueue(listed, done, new Set<string>(dueStripCut.symbols));

  const todayIso = new Date().toISOString().slice(0, 10);
  const tally = { written: 0, failed: 0, noFactSet: 0, noCik: 0 };
  const failures: string[] = [];
  const skipped: string[] = [];
  const written = new Set<string>();
  for (const symbol of queue.slice(0, REWRITE_PER_RUN)) {
    // THE RECORD'S OWN CIK, else the committed ticker file. Not the manifest:
    // it is ~417 KB and check-sec-daily-index allows exactly two readers of it.
    const cik = records[listed.indexOf(symbol)]?.cik || cikForSymbol(symbol);
    if (!cik) { tally.noCik++; skipped.push(symbol); continue; }
    try {
      const set = await readFactSet(symbol);
      if (!set) { tally.noFactSet++; skipped.push(symbol); continue; }
      const subs = await fetchSubmissions(cik);
      const { ok } = await buildAndWriteReportDates(symbol, cik, set, subs, todayIso);
      if (ok) { tally.written++; written.add(symbol); }
      else { tally.failed++; failures.push(symbol); }
    } catch (err) {
      tally.failed++;
      failures.push(`${symbol}: ${String((err as Error)?.message ?? err)}`);
    }
  }

  // THE GRID'S DAY INDEX, BACKFILLED ONCE from the records written before it
  // existed (lib/server/secResultsDays.ts). Every later record write keeps it.
  const indexed = await resultsDaysCount();
  const indexBackfill = indexed !== null && indexed < RESULTS_DAYS_BACKFILL_BELOW
    ? await backfillResultsDays(SEC_REPORT_DATES_PREFIX)
    : null;

  const summary = {
    ok: tally.failed === 0,
    resultsDaysIndexed: indexed ?? -1,
    resultsDaysBackfilled: indexBackfill?.written ?? 0,
    listed: listed.length,
    doneBefore: done.size,
    queued: queue.length,
    ...tally,
    left: queue.length - tally.written,
    // Joined: the job-run record holds scalars only.
    cutLeft: queue.filter((x) => dueStripCut.symbols.includes(x) && !written.has(x)).join(" "),
    failures: failures.slice(0, 20).join(" | "),
    skipped: skipped.slice(0, 20).join(" "),
  };
  await recordJobRun("sec-report-dates-rewrite", summary.ok, summary);
  console.log("[sec-report-dates-rewrite]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
