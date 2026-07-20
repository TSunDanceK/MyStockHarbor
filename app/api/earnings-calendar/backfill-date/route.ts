import { NextResponse } from "next/server";
import { getFullDayEarnings, isDateInWindow } from "@/lib/server/earningsCalendar";
import {
  getClientIp,
  checkBackfillLockout,
  recordBackfillFailure,
  clearBackfillFailures,
  checkBackfillKey,
} from "@/lib/server/backfillAuth";
import { isUnwantedBot } from "@/lib/botid-guard";

export const runtime = "nodejs";
// Owner-only and infrequent; a heavy earnings day can be a few hundred quote
// calls, and the site-wide FMP budget (~300/min) paces them, so give this room
// to fill a whole day in one call. Pro allows up to 300s.
export const maxDuration = 300;

// Owner-only, single-date backfill -- triggered by the "Backfill" button on
// app/earnings-calendar/page.tsx. POST { date, key }. Populates every US-listed
// candidate for the one date (getFullDayEarnings, no 100-cap), bypassing this
// feature's own hourly quote cap but never the site-wide FMP account budget
// (reserveFmpCallSlot, still enforced inside quoteOne). Only dates inside the
// active window can be backfilled.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const ip = getClientIp(request);

  const lockout = await checkBackfillLockout(ip);
  if (lockout.locked) {
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ${lockout.retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(lockout.retryAfterSeconds) } }
    );
  }

  let body: { date?: string; key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : "";
  const key = typeof body.key === "string" ? body.key : "";

  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  if (!checkBackfillKey(key)) {
    await recordBackfillFailure(ip);
    return NextResponse.json({ error: "Incorrect code." }, { status: 403 });
  }

  await clearBackfillFailures(ip);

  if (!isDateInWindow(date)) {
    return NextResponse.json({ error: "Date is outside the active earnings window." }, { status: 400 });
  }

  const result = await getFullDayEarnings(date, { bypassCap: true, forceRefresh: true });

  return NextResponse.json({
    date: result.date,
    totalCandidates: result.totalCandidates,
    usListedCount: result.usListedCount,
    fetchedCount: result.totalCandidates,
    complete: result.complete,
  });
}
