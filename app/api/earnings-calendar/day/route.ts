import { NextResponse } from "next/server";
import { getCachedDayItems } from "@/lib/server/earningsCalendar";
import { isUnwantedBot } from "@/lib/botid-guard";

export const runtime = "nodejs";

// Read-only pagination for the earnings-calendar "Show more" button. Returns
// the next slice of a date's ALREADY-materialised rows straight from Redis --
// it never quotes, so this stays a cheap cache read no matter how big the day.
// Population happens elsewhere (the page's background job + owner Backfill).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = (searchParams.get("date") || "").trim();
  const offsetRaw = Number(searchParams.get("offset") || "0");
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "Invalid date. Use YYYY-MM-DD." }, { status: 400 });
  }

  const all = await getCachedDayItems(date);
  const items = all.slice(offset, offset + PAGE_SIZE);

  return NextResponse.json({
    items,
    total: all.length,
    hasMore: all.length > offset + PAGE_SIZE,
  });
}
