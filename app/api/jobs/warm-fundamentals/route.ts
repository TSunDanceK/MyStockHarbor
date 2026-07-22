import { NextRequest, NextResponse } from "next/server";
import { getPickersData } from "../../../../lib/server/pickersBuilder";
import { warmFundamentals } from "../../../../lib/server/fundamentalsCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Daily cron (see vercel.json) that refreshes the Redis-cached fundamentals
// (market cap, PE ratio, industry) for the current picker universe, so the
// screener list view can show those columns with zero FMP calls per page
// render. Reads the universe from the already-cached pickers payload rather
// than recomputing it, then hands the symbol list to warmFundamentals(),
// which does the FMP work under the shared 300/min budget guard.

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.FMP_API_KEY) {
    return NextResponse.json(
      { error: "Missing FMP_API_KEY environment variable." },
      { status: 500 }
    );
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mystockharbor.com";

  try {
    const payload = await getPickersData(base);
    const symbols = Array.from(
      new Set((payload.signalRecords ?? []).map((r) => r.symbol).filter(Boolean))
    );

    const result = await warmFundamentals(symbols);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "warm-fundamentals failed" },
      { status: 500 }
    );
  }
}
