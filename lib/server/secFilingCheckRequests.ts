// A FILING-JOB CHECK REQUEST, COMMITTED RATHER THAN CALLED (audit r6).
//
// The filing job (app/api/jobs/sec-filings) picks a filer with no recorded
// lag only when the daily index shows a filing newer than its last check.
// A filer the job last checked before a fix to the job itself is therefore
// not looked at again until its next periodic filing, which can be months.
// This is how a code change asks for one more look, the same shape as the
// sec-facts re-read requests (secRereadRequests.ts).
//
// ONE-SHOT BY CONSTRUCTION. A request applies only while the filer's state
// `c` (last check, ms) is older than `requestedAt`. Every check stamps `c`,
// whatever its outcome, so the request retires itself after one check; a
// stale entry left in the file does nothing. A request puts the symbol on
// this run's due set (rank 1 in pickCandidates): it is checked on the next
// non-idle run, behind recorded lags, inside the job's usual fill cap and
// time budget. The due list kept in Redis is not touched.
//
// PURE: the route passes in the list, the filing state and the clock.
// Redis cost: none -- the filing state is already read once per run.
import requestsFile from "@/data/sec/filing-check-requests.json";
import type { FilingState } from "./secFilingJob";

export type FilingCheckRequest = { symbol: string; requestedAt: string; reason: string };

export const SEC_FILING_CHECK_REQUESTS = requestsFile.requests as FilingCheckRequest[];

/** The requested symbols this run should check: requested, and not checked since. */
export function requestedFilingChecks(
  requests: FilingCheckRequest[],
  state: Map<string, FilingState>,
  nowMs: number,
): string[] {
  const out = new Set<string>();
  for (const r of requests) {
    const at = Date.parse(r.requestedAt);
    const symbol = String(r.symbol).toUpperCase();
    if (!Number.isFinite(at) || at > nowMs) continue;
    if ((state.get(symbol)?.c ?? 0) >= at) continue;
    out.add(symbol);
  }
  return [...out];
}
