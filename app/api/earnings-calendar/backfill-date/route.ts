import { NextResponse } from "next/server";
import { getDayEarningsPage, isDateFullyPopulated } from "@/lib/server/earningsCalendar";
import {
  getClientIp,
  checkBackfillLockout,
  recordBackfillFailure,
  clearBackfillFailures,
  checkBackfillKey,
} from "@/lib/server/backfillAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

// Owner-only, single-date backfill -- triggered by the "Backfill" button on
// app/earnings-calendar/page.tsx rather than a raw URL. POST { date, key }.
// Only ever processes the one date it's given (bounded batch loop below),
// bypassing this feature's own hourly quote cap for that date but never the
// site-wide FMP account budget (reserveFmpCallSlot, still always enforced
// inside getDayEarningsPage -> quoteOne). Keeping this to one date per
// request keeps worst-case execution time bounded, unlike the old
// multi-date GET route this replaces.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BATCHES = 5; // safety ceiling -- BATCH_SIZE (100) * 5 = 500 candidates/date, far more than any real day sees

export async function POST(request: Request) {
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

  let fetchedCount = 0;
  let totalCandidates = 0;
  let hasMore = true;

  for (let batch = 0; batch < MAX_BATCHES && hasMore; batch++) {
    const page = await getDayEarningsPage(date, batch, { bypassCap: true });
    totalCandidates = page.totalCandidates;
    fetchedCount = page.fetchedCount;
    hasMore = page.hasMore;
  }

  const complete = await isDateFullyPopulated(date);

  return NextResponse.json({ date, totalCandidates, fetchedCount, complete });
}
