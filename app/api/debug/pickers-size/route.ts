import { NextResponse } from "next/server";
import { getPickersData } from "@/lib/server/pickersBuilder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Debug-only route (same shape as the other app/api/debug/* routes) to size the
// cached pickers payload.
//
// Why it exists: pickersBuilder keeps chartPoints only for symbols that land in
// a section's top 20, so every other universe symbol renders "Chart preview
// unavailable" in the screener's chart view -- and which symbols those are
// changes on each rebuild, so it looks arbitrary to a visitor. Shipping points
// for the whole universe is the obvious fix, but writePickersCache fails OPEN:
// an oversized value simply isn't cached, and then every request rebuilds from
// live FMP. That is a bad failure to trigger on a guess.
//
// So rather than pick a budget blind, extrapolate the real cost from the
// records that DO carry points: projectedFullPayloadChars is what the payload
// would weigh if every symbol shipped a chart series of average size.
//
// Reads through getPickersData, so it costs no more than a normal page view.

export async function GET() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mystockharbor.com";

  try {
    const payload = await getPickersData(base);
    const records = payload.signalRecords ?? [];

    let withCharts = 0;
    let chartChars = 0;
    let pointTotal = 0;

    for (const record of records) {
      const points = Array.isArray(record.chartPoints) ? record.chartPoints : null;
      if (!points || !points.length) continue;
      withCharts += 1;
      pointTotal += points.length;
      chartChars += JSON.stringify(points).length;
    }

    const withoutCharts = records.length - withCharts;
    const avgChartChars = withCharts ? Math.round(chartChars / withCharts) : 0;
    const payloadChars = JSON.stringify(payload).length;

    return NextResponse.json({
      records: records.length,
      withCharts,
      withoutCharts,
      avgPointsPerChart: withCharts ? Math.round(pointTotal / withCharts) : 0,
      avgChartChars,
      signalRecordChars: JSON.stringify(records).length,
      payloadChars,
      projectedFullPayloadChars: payloadChars + withoutCharts * avgChartChars,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "pickers-size failed" },
      { status: 500 }
    );
  }
}
