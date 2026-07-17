import { NextResponse } from "next/server";
import { populateNextMissingDate } from "@/lib/server/earningsCalendar";

export const runtime = "nodejs";

// Manually-triggered catch-up pass: populates the next few incomplete
// earnings-calendar dates (starting today, walking forward), bypassing the
// normal 50/hour quote cap entirely for this call. Gated behind a secret
// key so only the site owner can drain the FMP quote budget this way --
// set EARNINGS_BACKFILL_KEY in Vercel's project env vars, then hit e.g.:
//
//   /api/earnings-calendar/backfill?key=<the-secret>&maxDates=8
//
// Repeat (or raise maxDates, capped at 10 per call to keep the function's
// execution time bounded) to walk further into the future. Once the
// upcoming months are seeded, this route doesn't need to be used again --
// normal traffic keeps dates topped up automatically from there (see the
// `after()` background call in app/earnings-calendar/page.tsx). Loading
// /earnings-calendar itself with ?backfillKey=<the-secret> does the same
// bypass for manual clicking, if that's preferred over calling this route
// directly.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = (searchParams.get("key") || "").trim();
  const expected = process.env.EARNINGS_BACKFILL_KEY;

  if (!expected || key !== expected) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const maxParam = Number(searchParams.get("maxDates") || "5");
  const maxDates = Number.isFinite(maxParam) && maxParam > 0 ? Math.min(Math.floor(maxParam), 10) : 5;

  const result = await populateNextMissingDate({ bypassCap: true, maxDates });
  return NextResponse.json(result);
}
