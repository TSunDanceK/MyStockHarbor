// Symbol -> last and next earnings date. The one index, built once.
//
// WHY IT DID NOT EXIST. The earnings calendar is DATE-KEYED throughout --
// earningsCalendar.ts asks "who reports on this day", which is the question the
// /earnings-calendar page needs. Nothing asked "when did THIS symbol last
// report", which is the question a fundamentals refresh needs, so three
// partial answers had grown up instead:
//
//   computeEarningsTtlSeconds   earningsStore.ts -- scans for the soonest
//                               future date and returns a TTL, not a date
//   readCachedFmpEarningsBulk   pickersBuilder.ts -- chunked MGET, private to
//                               that 117KB module
//   nextEarningsRow             lib/latest-earnings-data.ts -- inline, over one
//                               symbol's own rows
//
// Writing a fourth would be claude/traps/two-validators-for-one-value.md, which
// #395 had to fix an instance of. This is the one, and it takes its comparison
// rule from the most carefully-reasoned of the three.
//
// THE COMPARISON IS AGAINST START-OF-DAY UTC, NOT Date.now(), and that is not a
// rounding preference. latest-earnings-data.ts records why: a report scheduled
// for TODAY carries a midnight-UTC timestamp that is already behind
// `Date.now()`, so a `<= Date.now()` test drops the day-of report -- the single
// most interesting row there is -- and reports the next date as blank. The same
// bug here would mark a symbol as "already refreshed for this quarter" on the
// morning of its actual release.
//
// WHY IT IS CACHED AS ITS OWN KEY. Building it means reading several months of
// calendar rows, and a month is ~697 KB. warm-stock-data runs 144 times a day;
// re-deriving per run would be ~600 MB/day of Redis reads to answer a question
// whose answer changes daily -- the same shape of spend that suspended the
// database on 2026-08-28 and that warmTargets.ts was rebuilt to avoid.

// ── RETIRED 2026-10-12 (#552 COWORK #213 item 4) ──────────────────────────
// readEarningsSchedule built this index from FMP's earnings calendar (via
// earningsCalendar.fetchMonthRows) and cached it here. Its one reader,
// warm-stock-data, was retired with FMP (#853, #553 COWORK #212), and a fresh
// search found no other caller, so the reader and the helpers only it used
// (buildSchedule, monthsAround, startOfTodayUtcMs) are deleted. What stays:
// the key, which B's debug sizing route (api/debug/redis-write-sizes) still
// lists until its entry is retired there, and the entry type.

export const SCHEDULE_KEY = "msh:earnings-schedule:v1";

export type EarningsScheduleEntry = {
  /** Most recent report on or before today, ISO date. */
  last: string | null;
  /** Soonest report strictly after today, ISO date. */
  next: string | null;
};

export type EarningsSchedule = Map<string, EarningsScheduleEntry>;
