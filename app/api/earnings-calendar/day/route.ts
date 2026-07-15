import { NextResponse } from "next/server";
import { getDayEarningsPage } from "@/lib/server/earningsCalendar";

export const runtime = "nodejs";

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = (searchParams.get("date") || "").trim();
  const batchParam = Number(searchParams.get("batch") || "0");
  const batch = Number.isFinite(batchParam) && batchParam >= 0 ? Math.floor(batchParam) : 0;

  if (!isValidDate(date)) {
    return NextResponse.json({ error: "Invalid date. Use YYYY-MM-DD." }, { status: 400 });
  }

  const page = await getDayEarningsPage(date, batch);
  return NextResponse.json(page);
}
