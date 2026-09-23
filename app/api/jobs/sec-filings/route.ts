// THE FILING JOB — see lib/server/secFilingJob.ts for the schedule and rules.
//
// Fires hourly at :40 (after sec-facts' :20 runs have finished, so the two
// never share SEC's rate). runMode decides whether this firing acts: always
// during the one-off catch-up, at 04:40 and 16:40 every day, and every 2 hours
// in reporting season.
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { readManifest } from "@/lib/server/secManifest";
import { readFactSet, writeFactSet } from "@/lib/server/secFactStore";
import { canWriteSecState, noteSecWriteBlocked } from "@/lib/server/secWriteGate";
import type { Submissions } from "@/lib/server/secReportDates";
import type { CompanyFacts } from "@/lib/server/secExtract";
import type { FilingRef } from "@/lib/server/secFactCodec";
import type { FxSeries } from "@/lib/server/fxRates";
import { FILING_INSTANCE_MAX_BYTES, pickInstanceName } from "@/lib/server/secFilingFill";
import { FETCH_TIMEOUT_MS } from "@/lib/server/jobBudget";
import {
  FILING_JOB_BUDGET_MS,
  FILING_JOB_FILLS_PER_RUN,
  FILING_JOB_PACE_MS,
  catchUpDone,
  checkAndFill,
  markCatchUpDone,
  pickCandidates,
  readDueList,
  readFilingState,
  runMode,
  writeDueList,
  writeFilingState,
  type FilingState,
} from "@/lib/server/secFilingJob";
import { buildDueList } from "@/lib/server/secFilingDue";
import { recordSicChanges, type SicChange } from "@/lib/server/secSicChange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SEC_UA = process.env.SEC_USER_AGENT || "";

async function authorize(req: NextRequest): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth === `Bearer ${secret}`) return null;
  return guardDebugRequest(req);
}

// ONE RATE GATE FOR EVERY SEC HOST: the limit is per requester.
let lastAt = 0;
async function secGet(url: string): Promise<Response> {
  const wait = Math.max(0, lastAt + FILING_JOB_PACE_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, {
    headers: { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}
async function secJson<T>(url: string): Promise<T> {
  const res = await secGet(url);
  // A 200 CARRYING HTML IS NOT DATA.
  if (!(res.headers.get("content-type") ?? "").includes("json")) throw new Error("expected JSON");
  return (await res.json()) as T;
}
const fetchers = {
  submissions: (cik: string) => secJson<Submissions>(`https://data.sec.gov/submissions/CIK${cik}.json`),
  companyFacts: (cik: string) => secJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`),
  instance: async (cik: string, f: FilingRef): Promise<string | null> => {
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replace(/-/g, "")}`;
    const idx = (await (await secGet(`${base}/index.json`)).json()) as {
      directory?: { item?: { name?: string; size?: string | number }[] };
    };
    const items = idx.directory?.item ?? [];
    const name = pickInstanceName(items.map((i) => String(i.name ?? "")));
    if (!name) return null;
    if (Number(items.find((i) => i.name === name)?.size ?? 0) > FILING_INSTANCE_MAX_BYTES) return null;
    const res = await secGet(`${base}/${name}`);
    if ((res.headers.get("content-type") ?? "").includes("html")) throw new Error("expected XML");
    const xml = await res.text();
    return xml.length > FILING_INSTANCE_MAX_BYTES ? null : xml;
  },
};

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const started = Date.now();
  const now = new Date();
  const mode = runMode(now, await catchUpDone());
  if (mode === "idle" || !SEC_UA) {
    const summary = { mode, acted: false, reason: SEC_UA ? "not a scheduled hour" : "SEC_USER_AGENT unset" };
    await recordJobRun("sec-filings", Boolean(SEC_UA), summary);
    return NextResponse.json({ ok: Boolean(SEC_UA), ...summary });
  }

  const manifest = await readManifest();
  if (!manifest) {
    await recordJobRun("sec-filings", false, { mode, error: "manifest unreadable" });
    return NextResponse.json({ ok: false, error: "manifest unreadable" }, { status: 503 });
  }
  const entries = Object.entries(manifest.symbols);
  const today = now.toISOString().slice(0, 10);

  // THE DUE LIST IS REBUILT BY THE NIGHTLY (AND CATCH-UP) RUN, read otherwise.
  let due: string[];
  if (mode === "nightly" || mode === "catch-up") {
    due = await buildDueList(entries.filter(([, e]) => e.cik && !e.delisted).map(([s]) => s), today);
    await writeDueList(due);
  } else {
    due = await readDueList();
  }

  const state = await readFilingState();
  const candidates = pickCandidates(mode, entries, state, new Set(due), started);
  const updates = new Map<string, FilingState>();
  const fxSeries = new Map<string, FxSeries | null>();
  const tally = { checked: 0, current: 0, lagging: 0, filled: 0, notice: 0, caughtUp: 0, failed: 0, noSet: 0 };
  const sicChanges: SicChange[] = [];
  const failures: string[] = [];
  let stoppedBy: "done" | "fill-cap" | "budget" = "done";

  for (const { symbol, cik } of candidates) {
    if (Date.now() - started > FILING_JOB_BUDGET_MS) { stoppedBy = "budget"; break; }
    if (tally.filled + tally.notice >= FILING_JOB_FILLS_PER_RUN) { stoppedBy = "fill-cap"; break; }
    const stored = await readFactSet(symbol);
    // No stored set yet: sec-facts populates it; nothing to fill against.
    if (!stored) { tally.noSet++; updates.set(symbol, { c: Date.now(), lag: null }); continue; }
    tally.checked++;
    try {
      const out = await checkAndFill(symbol, cik, stored, state.get(symbol), fetchers, fxSeries);
      updates.set(symbol, { c: Date.now(), lag: out.lag ?? null });
      if (out.sicChange) sicChanges.push(out.sicChange);
      if (out.kind === "current") { tally.current++; continue; }
      tally.lagging++;
      if (out.kind === "noted") continue;
      if (out.kind === "filled") tally.filled++;
      else if (out.kind === "notice") tally.notice++;
      else tally.caughtUp++;
      if (!(await writeFactSet(out.set))) throw new Error("fact-set write failed");
      if (canWriteSecState()) {
        revalidatePath(`/stock/${symbol}/earnings`);
        revalidatePath(`/stock/${symbol}`);
      } else noteSecWriteBlocked("revalidatePath");
    } catch (err) {
      tally.failed++;
      failures.push(`${symbol}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
      // Checked, and it failed: stamped so the next run does not spin on it,
      // with any recorded lag kept.
      updates.set(symbol, { c: Date.now(), lag: state.get(symbol)?.lag ?? null });
    }
  }

  const stateWritten = await writeFilingState(updates);
  // ONE HSET FOR THE WHOLE RUN, and only when a code moved (#552 COWORK #3).
  const sicChanged = await recordSicChanges(sicChanges, today);
  // THE CATCH-UP ENDS ITSELF: the first catch-up run that got through every
  // candidate hands over to the normal schedule.
  if (mode === "catch-up" && stoppedBy === "done") await markCatchUpDone();

  const summary = {
    mode,
    acted: true,
    candidates: candidates.length,
    dueList: due.length,
    ...tally,
    stoppedBy,
    backlog: candidates.length - tally.checked - tally.noSet,
    stateWritten,
    sicChanged,
    failures: failures.slice(0, 10).join(" | ") || null,
    ms: Date.now() - started,
  };
  await recordJobRun("sec-filings", tally.failed < Math.max(3, tally.checked / 4), summary);
  console.log("[sec-filings]", JSON.stringify(summary));
  return NextResponse.json({ ok: true, ...summary });
}
