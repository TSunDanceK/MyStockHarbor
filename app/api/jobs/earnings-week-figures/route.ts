import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { easternDate } from "@/lib/server/calendarDayState";
import { weekDays } from "@/lib/server/earningsWeek";
import { stripDaySymbols } from "@/lib/server/earningsWeekStrip";
import { fillWeekFigures } from "@/lib/server/earningsWeekStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// /earnings-calendar's "Results filed" FIGURES AND CLOSES, HOURLY.
//
// The rows' revenue, EPS and close-before-filing are precomputed into one key
// per day (lib/server/earningsWeekStore). Until this job they filled only from
// the page's own after(): 30 rows a run, at most once per five minutes, and
// only when someone viewed the page. A busy week is several hundred rows, and
// on 2026-11-04 most of 29 Oct (156 of 202) and 2 Nov (94 of 95) had never been
// tried at all, while their stored sets already carried the quarter.
//
// So the fill runs here every hour over the whole strip, newest day first,
// stopping in time to write what it did. A row fills within about an hour of
// its stored set carrying the announced quarter (RETRY_AFTER_MS). Reads stored
// sets, report-dates records and bars only: no SEC or Tiingo request.
const MAX_SYMBOLS = 400;
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
  const started = Date.now();
  try {
    const days = weekDays(easternDate(new Date()));
    const daySymbols = await stripDaySymbols(days);
    const rows = [...daySymbols.values()].reduce((n, l) => n + l.length, 0);
    const result = await fillWeekFigures(daySymbols, { maxSymbols: MAX_SYMBOLS, deadlineMs: started + BUDGET_MS });
    const summary = { rows, filledSymbols: result.symbols, daysWritten: result.days, ms: Date.now() - started };
    console.log("[earnings-week-figures]", JSON.stringify(summary));
    await recordJobRun("earnings-week-figures", true, summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await recordJobRun("earnings-week-figures", false, { error });
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
