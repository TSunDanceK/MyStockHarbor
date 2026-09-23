// A WALL-CLOCK BUDGET FOR A CRON THAT MUST FINISH, and the order it is spent in.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────
// sec-facts ran out of its 300s Vercel budget on 2026-09-21 and 2026-09-22
// (production log: "Task timed out after 300 seconds"; last recorded run
// 2026-09-20). A timeout is not a slow run, it is a LOST run: the manifest is
// written once at the end, so every stamp the run earned is thrown away and the
// next day rebuilds the same queue and times out on it again.
//
// So the job spends against an explicit budget and stops CLEANLY: it stops
// taking new work, then always reaches the manifest write and the job-run
// record. A slow SEC day shrinks a run instead of killing it. The "cursor" is
// the manifest itself: every symbol finished this run carries current stamps,
// so the queues built tomorrow start where today stopped.
//
// ── TWO PHASES, AND THE SECOND HAS A RESERVED SHARE ──────────────────────
// Report dates run after the fact-set loop (they need the sets it just wrote).
// A single budget would let a long fact-set loop starve them every day, which
// is exactly how the pairing rewrite queued there never reached its turn. So
// the fact-set phase closes early, at total - reserve, and report dates get
// the reserve.
//
// `now` is injected so the check can drive a fake clock.

/** Stop taking new work at this much of the 300s maxDuration. */
export const JOB_BUDGET_MS = 240_000;
/** Of which reserved for the report-dates phase. */
export const REPORT_DATES_RESERVE_MS = 60_000;
/**
 * No single fetch may run longer than this. Without a per-request timeout a
 * hung socket (SEC, FRED or the ECB) outlives any budget check between
 * symbols, and the run dies the old way.
 */
export const FETCH_TIMEOUT_MS = 20_000;

export type JobBudget = {
  /** May the fact-set phase start another symbol? */
  factsOpen: () => boolean;
  /** May the report-dates phase start another symbol? */
  datesOpen: () => boolean;
  elapsedMs: () => number;
};

export function makeJobBudget(
  totalMs = JOB_BUDGET_MS,
  reserveMs = REPORT_DATES_RESERVE_MS,
  now: () => number = Date.now,
): JobBudget {
  const start = now();
  return {
    factsOpen: () => now() - start < totalMs - reserveMs,
    datesOpen: () => now() - start < totalMs,
    elapsedMs: () => now() - start,
  };
}
