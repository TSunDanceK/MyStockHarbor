import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import tickersFile from "@/data/sec/company-tickers.json";
import aliasFile from "@/data/capex/federal-aliases.json";
import {
  CAPEX_FEDERAL_COMMANDS_PER_RUN,
  CAPEX_FEDERAL_FRESH_DAYS,
  CAPEX_FEDERAL_PAGES,
  buildMatcher,
  fetchFederal,
  readStoredFederal,
  rollUp,
  writeStoredFederal,
  type FederalAlias,
  type FederalExclusion,
  type StoredFederal,
  type TickerRow,
} from "@/lib/server/capexFederal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// WEEKLY REFRESH, DAILY CRON: the listed companies that received the most
// federal contract money over the last 12 complete months (#563 D5). See
// lib/server/capexFederal.ts.
//
// WHY THE CRON IS DAILY. /cache-health judges a job's silence by its cron's
// hour field (cronIntervalSeconds reads minute and hour only), so a weekly
// cron would read as a daily job that has gone quiet six days in seven. The
// job fires daily and refreshes only when the stored record is FRESH_DAYS old,
// so the data is weekly and the health signal stays honest.
//
// REDIS: one GET a day to read the record's age; one SET when it refreshes
// (weekly); plus recordJobRun's SET. The page reads the key with one GET per
// render.
//
// USASPENDING: one monthly total and ten pages of 100 recipients. The search
// endpoints answered in 15–28 s cold and ~0.4 s warm when measured (CODE-C #1
// §5), so the run carries its own deadline and, on any failure, writes
// NOTHING: the last complete week stays on the page rather than a partial one.

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
  const now = new Date();
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  // Leave room inside maxDuration for the write and the run record.
  const deadline = started + 270_000;
  const force = new URL(req.url).searchParams.get("force") === "1";

  const stored = await readStoredFederal();
  const ageDays = stored ? (now.getTime() - Date.parse(stored.updatedAt)) / 864e5 : Infinity;
  if (!force && ageDays < CAPEX_FEDERAL_FRESH_DAYS) {
    const summary = { ok: true, upToDate: true, ageDays: Math.round(ageDays * 10) / 10, redisCommands: 1, ms: Date.now() - started };
    await recordJobRun("capex-federal", true, summary);
    return NextResponse.json(summary);
  }

  let fetched;
  try {
    fetched = await fetchFederal(now, deadline, CAPEX_FEDERAL_PAGES);
  } catch (err) {
    const summary = { ok: false, error: `USAspending read failed: ${String(err)}`, written: false, ms: Date.now() - started };
    await recordJobRun("capex-federal", false, summary);
    console.log("[capex-federal]", JSON.stringify(summary));
    return NextResponse.json(summary, { status: 502 });
  }

  const match = buildMatcher(
    (tickersFile as { data: TickerRow[] }).data,
    (aliasFile as { aliases: FederalAlias[] }).aliases,
    (aliasFile as { exclusions: FederalExclusion[] }).exclusions
  );
  const rolled = rollUp(fetched.rows, match);
  const topRecipientsObligations = fetched.rows.reduce((a, r) => a + Math.max(0, r.amount), 0);
  const doc: StoredFederal = {
    version: 1,
    updatedAt: now.toISOString(),
    window: fetched.window,
    totalObligations: fetched.total,
    topRecipientsObligations,
    recipientsRead: fetched.rows.length,
    matchedObligations: rolled.matched,
    companies: rolled.companies,
    unmatchedLargest: rolled.unmatchedLargest,
  };
  // A read that came back implausibly small is a failed read, not a quiet week.
  const plausible = doc.recipientsRead >= 500 && doc.totalObligations > 1e11 && doc.companies.length >= 20;
  const write = dryRun || !plausible ? { ok: plausible, reason: dryRun ? "dryRun=1 — nothing written" : "implausible read — nothing written" } : await writeStoredFederal(doc);

  const summary = {
    ok: write.ok && plausible,
    dryRun,
    window: `${doc.window.start}..${doc.window.end}`,
    recipientsRead: doc.recipientsRead,
    totalObligationsBn: Math.round(doc.totalObligations / 1e8) / 10,
    matchedShareOfTotal: doc.totalObligations ? Math.round((doc.matchedObligations / doc.totalObligations) * 1000) / 10 : null,
    companies: doc.companies.length,
    // The alias list's review queue: the biggest recipients that matched nothing.
    unmatchedLargest: doc.unmatchedLargest.slice(0, 10).map((u) => `${u.name} ${Math.round(u.amount / 1e6)}m`).join("; "),
    write: write.reason ?? "ok",
    redisCommands: 1 + (dryRun || !plausible ? 0 : CAPEX_FEDERAL_COMMANDS_PER_RUN),
    ms: Date.now() - started,
  };
  await recordJobRun("capex-federal", summary.ok, summary);
  console.log("[capex-federal]", JSON.stringify(summary));
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}
