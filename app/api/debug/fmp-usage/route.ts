import { NextRequest, NextResponse } from "next/server";

import {
  checkBackfillKey,
  checkBackfillLockout,
  clearBackfillFailures,
  getClientIp,
  recordBackfillFailure,
} from "@/lib/server/backfillAuth";
import { readFmpUsage } from "@/lib/server/fmpUsage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the 20 GB / 30-day FMP bandwidth cap is actually being spent on, per
// endpoint, newest first.
//
// The per-minute guard in historyCache.ts counts CALLS. Bytes and calls are not
// proportional -- ~0.3 KB for /stable/quote against ~66 KB for
// /stable/news/stock -- so the guard cannot see the limit that is close (14.72
// of 20 GB on 2026-08-22). This route reads the counters lib/server/fmpUsage.ts
// records on every FMP response.
//
// READ `daysMissing` BEFORE READING THE TOTAL. The counters start the day this
// ships, so the first 30 days report a window that is mostly empty. A small
// total with daysMissing 29 is not "we barely use FMP", it is "the meter has
// been running for one day" -- the distinction
// claude/traps/absence-needs-the-producer-to-have-run.md exists to force.
// It is stated in the response body rather than left to be inferred.
//
// Owner-only and read-only: it makes NO FMP calls of its own -- unlike
// /api/debug/fmp-endpoints, which spends ~12 -- so it cannot itself move the
// number it reports. Same EARNINGS_BACKFILL_KEY + IP lockout as the other debug
// routes; checkBackfillKey fails CLOSED.

function fmtBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const lockout = await checkBackfillLockout(ip);
  if (lockout.locked) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts" },
      { status: 429, headers: { "retry-after": String(lockout.retryAfterSeconds) } }
    );
  }

  const submitted = new URL(req.url).searchParams.get("key") ?? "";
  if (!checkBackfillKey(submitted)) {
    await recordBackfillFailure(ip);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await clearBackfillFailures(ip);

  const days = Number(new URL(req.url).searchParams.get("days"));
  const report = await readFmpUsage(Number.isFinite(days) && days > 0 ? days : 30);

  return NextResponse.json({
    ...report,
    human: {
      totalWire: fmtBytes(report.totalWireBytes),
      totalDecoded: fmtBytes(report.totalDecodedBytes),
      cap: fmtBytes(report.capBytes),
      pctOfCap: report.pctOfCap === null ? "unknown" : `${report.pctOfCap}%`,
      // Spelled out rather than left as a field the reader has to interpret.
      coverageWarning:
        report.daysMissing > 0
          ? `${report.daysMissing} of ${report.days} days have no data — the meter was not running for those. Treat the total as a FLOOR, not a measurement.`
          : null,
      endpoints: report.endpoints.map((e) => ({
        endpoint: e.endpoint,
        calls: e.calls,
        wire: fmtBytes(e.wireBytes),
        perCall: fmtBytes(e.bytesPerCall),
        // How much of this row's wire figure came from a real Content-Length
        // header rather than falling back to the decoded length.
        wireExact: e.calls > 0 ? `${Math.round((e.wireExactCalls / e.calls) * 100)}%` : "n/a",
      })),
    },
  });
}
