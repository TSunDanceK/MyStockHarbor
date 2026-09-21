import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import {
  IPO_COLD_START_DAYS,
  IPO_MAX_DAYS_PER_RUN,
  coldStartFrom,
  ingestIpoWindow,
} from "@/lib/server/ipoIngest";
import {
  IPO_REFRESH_COMMANDS_PER_RUN,
  readStoredIpoFilingsMeta,
  writeStoredIpoFilings,
} from "@/lib/server/ipoSecStore";
import { IPO_WINDOW_DAYS, windowStartFor } from "@/lib/server/ipoRecordMerge";
import { addDays, latestProcessableDate } from "@/lib/server/secDailyIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// THE WRITE THE SEED COULD NOT DO.
//
// scripts/ipo-seed.mjs builds `msh:ipo:filings:v1` correctly and stops one step
// short, because relay.yml's Upstash secret is the READ-ONLY token by
// deliberate choice -- a security posture, not a credential to debug. The write
// token lives in the Vercel environment, so the app is the only thing that can
// write, which is why the daily ingest is a route rather than a second runner
// task. (claude/HANDOFF-ipo-2026-09-17.md, "THE OPEN DECISION — answered".)
//
// ── THE BUDGET ─────────────────────────────────────────────────────────────
// REDIS: exactly TWO commands against the IPO key -- one GET, one SET -- plus
// the one SET recordJobRun spends on the shared job-run record, as every other
// warm job does. Not per-filer keys: ~700 filers written individually would be
// ~700 commands a day against a $50 cap, which is the shape of the outage on
// 2026-08-28 rather than a smaller version of this design.
//
// SEC: one daily-index request per date walked, plus three requests for each
// filer that filed an offering form that day -- submissions, the filing's
// index.json, and the cover itself. About eight filers a day, from the seed's
// 722 filers over 90 days. All of it paced to SEC's published 10/second.
//
// ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
// Classify. buildSecIpoTables runs at render, from the stored records, and this
// route never calls it -- so the exclusion rules have exactly one home and a
// change to them takes effect without a re-ingest. The ticker map is not read
// here either, for the same reason: it is an input to classification, not to
// what a filing IS.

/** SEC's fair-access policy requires a declared agent carrying a contact. */
const SEC_UA = process.env.SEC_USER_AGENT || "";

/**
 * TWO WAYS IN, AND BOTH ARE NEEDED.
 *
 * Identical to sec-daily-index's, deliberately -- same secret, same lockout,
 * same 401/429 bodies. Vercel's cron sends `Authorization: Bearer $CRON_SECRET`
 * and is checked first and cheapest; a valid Bearer must never record a key
 * failure against Vercel's own IP and eventually lock the scheduler out of its
 * own job.
 *
 * `?key=` exists because a header cannot be typed into an address bar, and
 * without it THE FIRST RUN OF THIS ROUTE COULD ONLY HAPPEN AFTER A MERGE TO
 * MAIN -- testing the thing after shipping it, which is the order this whole
 * build has been arranged to avoid. It matters more here than anywhere: this is
 * the route that has to be driven by hand through a 90-day cold start before
 * IPO_PROVIDER can be flipped at all.
 */
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
  const url = new URL(req.url);

  if (!SEC_UA) {
    // Named as its own failure. Without a declared agent SEC answers 403 with
    // "Request Rate Threshold Exceeded", which READS AS A RATE LIMIT AND IS
    // NOT ONE -- adding backoff to that is debugging the wrong thing, and any
    // looser rule would count it as a missing index instead.
    const summary = { ok: false, error: "SEC_USER_AGENT is not set" };
    await recordJobRun("ipo-refresh", false, summary);
    console.log("[ipo-refresh]", JSON.stringify(summary));
    return NextResponse.json(
      {
        ok: false,
        error:
          "SEC_USER_AGENT is not set; every request would be blocked as an undeclared agent",
      },
      { status: 503 }
    );
  }

  // ── COMMAND 0: the meta read, and why it is NOT a third command on the key
  //
  // It is. readStoredIpoFilingsMeta is one GET, so a run costs three commands
  // against the IPO key rather than two. That is a deliberate exception to the
  // budget in ipoSecStore.ts and it buys the watermark BEFORE the walk: without
  // it the route cannot know which dates to ask EDGAR for, and would have to
  // either re-walk 90 days every run (90 index fetches a day, forever) or keep
  // the watermark in a second key (also a GET, plus a SET). One extra GET is
  // the cheapest of the three, and it is a GET rather than a write -- writes
  // are 76% of the command count on this account and the meter that bills.
  const meta = await readStoredIpoFilingsMeta();

  // ── Which dates ───────────────────────────────────────────────────────────
  const latest = latestProcessableDate(now);
  const fromOverride = url.searchParams.get("from");
  const coldStart = !meta?.lastIndexDate;
  const from =
    fromOverride ||
    (meta?.lastIndexDate ? addDays(meta.lastIndexDate, 1) : coldStartFrom(now, IPO_COLD_START_DAYS));
  const maxDays = Math.max(
    1,
    Math.min(90, Number(url.searchParams.get("maxDays") ?? IPO_MAX_DAYS_PER_RUN))
  );
  // A DEBUG-LOOKING PARAMETER MUST NOT MUTATE LIVE STATE AS A SIDE EFFECT --
  // sec-daily-index learned this when a from/to run rewound its watermark by a
  // day. Here the watermark is additionally monotonic in writeStoredIpoFilings,
  // so a replay cannot move it backwards even when it does persist.
  const dryRun = url.searchParams.get("dryRun") === "1";

  if (from > latest) {
    // Already current. Not a failure, and not silent: a run that legitimately
    // has nothing to do must read differently from one that failed to do it.
    const summary = {
      ok: true,
      upToDate: true,
      watermark: meta?.lastIndexDate ?? null,
      latestProcessable: latest,
      storedRecords: meta?.count ?? 0,
      redisCommands: 1,
      ms: Date.now() - started,
    };
    await recordJobRun("ipo-refresh", true, summary);
    console.log("[ipo-refresh]", JSON.stringify(summary));
    return NextResponse.json(summary);
  }

  // ── The walk ──────────────────────────────────────────────────────────────
  const windowStart = windowStartFor(now, IPO_WINDOW_DAYS);
  const ingest = await ingestIpoWindow({
    ua: SEC_UA,
    windowStart,
    from,
    to: latest,
    maxDays,
    now,
  });

  // ── The write: one GET, one SET ───────────────────────────────────────────
  const write = dryRun
    ? {
        ok: true,
        reason: "dryRun=1 — nothing written",
        commands: 0,
        before: meta?.count ?? 0,
        after: meta?.count ?? 0,
        pruned: 0,
        lastIndexDate: meta?.lastIndexDate ?? null,
      }
    : await writeStoredIpoFilings(ingest.records, {
        now,
        // Only what was actually walked. A run whose every date FAILED returns
        // null here, and writeStoredIpoFilings then keeps the watermark it
        // found -- so a bad day does not send the next run back to the cold
        // start.
        lastIndexDate: ingest.lastIndexDate,
      });

  const failedDays = ingest.days.filter((d) => d.outcome === "failed").length;

  // ── HOW MUCH OF THE COLD START IS LEFT, AND WHY IT IS THE WATERMARK ──────
  //
  // THE WALK GOES FORWARD, SO THE RECENT DAYS ARE COVERED LAST. A cold start
  // begins 90 days back and moves toward today, which means that after the
  // first run the store holds days -90..-75 -- filings far too old for either
  // table -- and the page would render two empty tables while every count in
  // this response looked healthy. That is the single most plausible way to flip
  // IPO_PROVIDER on a store that cannot serve, so it is reported as a number
  // rather than left to be inferred from `storedAfter`.
  //
  // The distance from the watermark to the latest processable date IS the
  // answer: zero means the walk has reached today and the store holds
  // everything both tables can draw on. Counted in calendar days, which
  // overstates slightly (weekends have no index and are walked instantly), and
  // overstating what is left is the safe direction for a readiness signal.
  const asDate = (yyyymmdd: string) =>
    Date.parse(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00Z`);
  const walkedTo = write.lastIndexDate ?? ingest.lastIndexDate;
  const daysRemaining = walkedTo
    ? Math.max(0, Math.round((asDate(latest) - asDate(walkedTo)) / 86400000))
    : IPO_COLD_START_DAYS;
  // NOT "close enough". The walk either reached the latest date EDGAR has
  // published an index for, or it did not.
  const caughtUp = Boolean(walkedTo && walkedTo >= latest);

  const ok =
    failedDays === 0 &&
    (dryRun || write.ok) &&
    // A run that read no submissions at all while claiming to have touched
    // filers is a failed run wearing a success's clothes.
    !(ingest.filersTouched > 0 && ingest.submissionsRead === 0);

  const summary = {
    ok,
    coldStart,
    from,
    latestProcessable: latest,
    datesWalked: ingest.days.length,
    parsed: ingest.days.filter((d) => d.outcome === "parsed").length,
    absent: ingest.days.filter((d) => d.outcome === "absent").length,
    failed: failedDays,
    stoppedOnDeadline: ingest.stoppedOnDeadline,
    watermark: write.lastIndexDate,
    // Days between the watermark and the latest index EDGAR has published.
    // 0 AND caughtUp:true is the only state in which the store can serve both
    // tables -- see the note above the calculation.
    daysRemaining,
    caughtUp,
    filersTouched: ingest.filersTouched,
    submissionsRead: ingest.submissionsRead,
    submissionsFailed: ingest.submissionsFailed,
    coversFetched: ingest.coversFetched,
    coversParsed: ingest.coversParsed,
    // A CATEGORY THAT SHOULD BE SMALL BEING LARGE IS THE SIGNAL. EFFECT notices
    // are what made Wellchange look like it had filed a 424B4 it never filed;
    // printing the count is what makes the next one of those visible instead of
    // plausible.
    edgarNoticesSkipped: ingest.noticesSkipped,
    // Should be empty. submissions.recent holds at least a year, so a filer
    // whose history does not reach windowStart means the assumption moved --
    // and an 8-A12B just outside a truncated history reads as a follow-on,
    // silently deleting a real IPO from the page.
    historyTruncated: ingest.historyTruncated.length,
    recordsIn: ingest.records.length,
    storedBefore: write.before,
    storedAfter: write.after,
    prunedFilers: write.pruned,
    writeOk: write.ok,
    writeReason: write.reason,
    secRequests: ingest.requests,
    // One meta GET, then the write's own GET + SET.
    redisCommands: dryRun ? 1 : 1 + IPO_REFRESH_COMMANDS_PER_RUN,
    dryRun,
    ms: Date.now() - started,
  };

  await recordJobRun("ipo-refresh", ok, summary);
  // THE SUMMARY GOES TO THE PLATFORM LOG, matching every other job here.
  // sec-daily-index's first automated run returned 200 and printed NOTHING,
  // and a daily job returning 200 while doing nothing is indistinguishable from
  // one that works.
  console.log("[ipo-refresh]", JSON.stringify(summary));

  return NextResponse.json({
    ...summary,
    days: ingest.days,
    truncatedCiks: ingest.historyTruncated.slice(0, 25),
    note: ok
      ? caughtUp
        ? "the walk has reached the latest published index; the store holds everything both tables can draw on"
        : `${daysRemaining} day(s) still unwalked, and a forward walk covers the RECENT days LAST — run again before flipping IPO_PROVIDER`
      : "this run did NOT complete cleanly; the watermark only advanced over the dates that did",
  });
}
