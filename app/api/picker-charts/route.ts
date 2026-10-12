import { NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";
import { readPickerChartsBulk } from "@/lib/server/pickerChartsCache";
import { flushRedisReadMeter } from "@/lib/server/redisBandwidth";

// THE CANDLES FOR THE ROWS A PICKER VIEW DRAWS (#553 COWORK #214, cut 1).
//
// Picker pages ship each row's chart summary (lib/pickerChartLite.ts), not its
// bars. The chart view's visible cards and an expanded phone row ask here for
// just those symbols: one HMGET of at most MAX_SYMBOLS fields of
// msh:picker-charts:v1 (~11 KB each), never the hash's other ~690. Metered as
// "picker-charts" with the caller "picker-charts-api", and flushed here.
//
// The bars change once a night (the pickers build after tiingo-eod), so the
// CDN holds an answer for an hour like /api/pickers does.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** usePickerBars' batch: a chart-view page is 21 cards. */
const MAX_SYMBOLS = 30;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600",
};

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9.-]{1,12}$/.test(s))
    )
  );
  if (!symbols.length || symbols.length > MAX_SYMBOLS) {
    return NextResponse.json({ error: `1 to ${MAX_SYMBOLS} symbols` }, { status: 400 });
  }

  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const series = await readPickerChartsBulk(symbols, "picker-charts-api");
  await flushRedisReadMeter();
  return NextResponse.json({ bars: Object.fromEntries(series) }, { headers: CACHE_HEADERS });
}
