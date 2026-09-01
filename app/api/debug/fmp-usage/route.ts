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

// What the 30-day rolling FMP bandwidth cap is actually being spent on, per
// endpoint, newest first.
//
// The per-minute guard in historyCache.ts counts CALLS. Bytes and calls are not
// proportional -- ~0.3 KB for /stable/quote against ~66 KB for
// /stable/news/stock -- so the guard cannot see the limit that is close (14.72
// GB on 2026-08-22, against the 20 GB the plan carried before the data boost;
// the cap is FMP_BANDWIDTH_CAP_BYTES, which the response reports as `cap`).
// This route reads the counters lib/server/fmpUsage.ts
// records on every FMP response.
//
// READ `daysMissing` BEFORE READING THE TOTAL. The counters start the day this
// ships, so the first 30 days report a window that is mostly empty. A small
// total with daysMissing 29 is not "we barely use FMP", it is "the meter has
// been running for one day" -- the distinction
// claude/traps/absence-needs-the-producer-to-have-run.md exists to force.
// It is stated in the response body rather than left to be inferred.
//
// RECONCILIATION AGAINST THE DASHBOARD (?dashboardGb=). Pass the figure FMP's
// own dashboard shows for the same window and this route reports the ratio
// between them, both ways, plus which of `wire` and `decoded` lands closer.
// Until that comparison is done, this meter is an unvalidated instrument: it
// says 14.72 GB and nothing has ever checked that against the only number that
// bills. Two known reasons the figures will NOT match exactly, both stated in
// the response rather than left for the reader to rediscover:
//
//   * COVERAGE. The meter started recording on 2026-08-22. A 30-day dashboard
//     figure against 2 days of counters is not a discrepancy, it is two
//     different windows -- so the comparison is normalised to the days that
//     actually have data, and refuses outright below 3 of them.
//   * THE DATA CACHE. fmpFetch records a sample whenever a call site is
//     reached, including when Next serves the response from its cache with no
//     network request. The meter is therefore an UPPER bound: a meter total
//     ABOVE the dashboard is expected, and only a meter total BELOW it is
//     genuinely surprising.
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

const GB = 1024 ** 3;

/**
 * Meter vs dashboard, normalised to the days the meter actually covered.
 *
 * WHY NORMALISE RATHER THAN COMPARE THE RAW TOTALS. The counters started on
 * 2026-08-22, so for the first month a 30-day dashboard figure is being held up
 * against a two-day meter reading. Comparing those directly produces a ratio of
 * ~0.07 and the conclusion "the meter is catastrophically undercounting", which
 * is false and is the sort of wrong answer that gets acted on. Per-day is the
 * only like-for-like figure available until the window fills.
 *
 * Refuses below 3 covered days rather than reporting a ratio built on one busy
 * afternoon.
 */
function buildReconciliation(
  report: Awaited<ReturnType<typeof readFmpUsage>>,
  dashboardGb: number
) {
  if (!Number.isFinite(dashboardGb) || dashboardGb <= 0) {
    return {
      done: false,
      note:
        "Pass ?dashboardGb=<figure> with the number FMP's dashboard shows for the same window " +
        "to reconcile. Until then this meter is unvalidated: nothing has ever checked it against " +
        "the number that actually bills.",
    };
  }

  if (report.daysWithData < 3) {
    return {
      done: false,
      note:
        `Only ${report.daysWithData} day(s) of counters exist. A ${report.days}-day dashboard figure ` +
        "against that is two different windows, not a discrepancy — the ratio would be meaningless. " +
        "Re-run once the meter has at least 3 full days.",
    };
  }

  const dashboardBytes = dashboardGb * GB;
  const dashboardPerDay = dashboardBytes / report.days;
  const wirePerDay = report.totalWireBytes / report.daysWithData;
  const decodedPerDay = report.totalDecodedBytes / report.daysWithData;

  const wireRatio = dashboardPerDay > 0 ? wirePerDay / dashboardPerDay : null;
  const decodedRatio = dashboardPerDay > 0 ? decodedPerDay / dashboardPerDay : null;

  // Which layer FMP appears to bill. Both are recorded precisely because the
  // codebase cannot observe their methodology, so this names the closer one
  // rather than asserting either (claude/traps/measuring-the-wrong-layer.md).
  const closer =
    wireRatio === null || decodedRatio === null
      ? null
      : Math.abs(Math.log(wireRatio)) <= Math.abs(Math.log(decodedRatio))
        ? "wire"
        : "decoded";

  const best = closer === "decoded" ? decodedRatio : wireRatio;

  let verdict: string;
  if (best === null) {
    verdict = "no comparable figure";
  } else if (best >= 0.85 && best <= 1.35) {
    verdict =
      `The meter's ${closer} figure tracks the dashboard within ${Math.round(Math.abs(1 - best) * 100)}%. ` +
      "Running slightly high is expected — see the Data Cache note in this file.";
  } else if (best > 1.35) {
    verdict =
      `The meter reads ${best.toFixed(2)}x the dashboard. Over-counting is the EXPECTED direction ` +
      "(cached responses record a sample with no network request), but this much of it suggests " +
      "a call site being reached far more often than it fetches — worth finding which endpoint.";
  } else {
    verdict =
      `The meter reads ${best.toFixed(2)}x the dashboard, i.e. UNDER it. That is the surprising ` +
      "direction: the meter should be an upper bound. Something is making FMP calls without going " +
      "through fmpFetch — a plain fetch() somewhere, or a job whose flush never lands.";
  }

  return {
    done: true,
    dashboardGb,
    daysCompared: report.daysWithData,
    windowDays: report.days,
    perDay: {
      dashboard: `${(dashboardPerDay / GB).toFixed(3)} GB/day`,
      wire: `${(wirePerDay / GB).toFixed(3)} GB/day`,
      decoded: `${(decodedPerDay / GB).toFixed(3)} GB/day`,
    },
    wireRatio: wireRatio === null ? null : Number(wireRatio.toFixed(3)),
    decodedRatio: decodedRatio === null ? null : Number(decodedRatio.toFixed(3)),
    closerLayer: closer,
    verdict,
  };
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

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days"));
  const report = await readFmpUsage(Number.isFinite(days) && days > 0 ? days : 30);

  const dashboardGb = Number(url.searchParams.get("dashboardGb"));
  const reconciliation = buildReconciliation(report, dashboardGb);

  return NextResponse.json({
    ...report,
    reconciliation,
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
