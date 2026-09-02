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

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { fetchMonthRows, type RawEarningsRow } from "./earningsCalendar";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const SCHEDULE_KEY = "msh:earnings-schedule:v1";
// A day. The calendar itself is on REFERENCE_TTL_DAILY_SECONDS, so a shorter
// TTL here would rebuild from the same rows.
const SCHEDULE_TTL_SECONDS = 24 * 60 * 60;

// How far either side of today to look. Earnings are quarterly, so one quarter
// back is enough to find the last report and one forward to find the next --
// two months of slack each way covers a delayed filing and a calendar that
// lists a date early.
const MONTHS_BACK = 4;
const MONTHS_FORWARD = 3;

export type EarningsScheduleEntry = {
  /** Most recent report on or before today, ISO date. */
  last: string | null;
  /** Soonest report strictly after today, ISO date. */
  next: string | null;
};

export type EarningsSchedule = Map<string, EarningsScheduleEntry>;

/**
 * Midnight UTC of today, as ms.
 *
 * The single place this codebase's "has it reported yet" boundary is defined.
 */
export function startOfTodayUtcMs(nowMs = Date.now()): number {
  return Date.parse(`${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Fold calendar rows into the index. Exported and PURE so the invariant check
 * can run it rather than pattern-match it -- the boundary condition above is
 * exactly the kind a regex cannot see.
 */
export function buildSchedule(rows: RawEarningsRow[], nowMs = Date.now()): EarningsSchedule {
  const boundary = startOfTodayUtcMs(nowMs);
  const out: EarningsSchedule = new Map();

  for (const row of rows) {
    const symbol = String(row?.symbol ?? "").trim().toUpperCase();
    const date = typeof row?.date === "string" ? row.date.slice(0, 10) : "";
    if (!symbol || !date) continue;
    const t = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(t)) continue;

    const entry = out.get(symbol) ?? { last: null, next: null };
    if (t <= boundary) {
      // ON or before today counts as reported. A date equal to the boundary is
      // today's report: it belongs to `last`, so a refresh triggered by it
      // fires on the day rather than a quarter later.
      if (!entry.last || date > entry.last) entry.last = date;
    } else if (!entry.next || date < entry.next) {
      entry.next = date;
    }
    out.set(symbol, entry);
  }

  return out;
}

function monthsAround(nowMs: number): Array<{ year: number; month: number }> {
  const now = new Date(nowMs);
  const out: Array<{ year: number; month: number }> = [];
  for (let offset = -MONTHS_BACK; offset <= MONTHS_FORWARD; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  return out;
}

export async function readEarningsSchedule(nowMs = Date.now()): Promise<EarningsSchedule> {
  if (redis) {
    try {
      const cached = await redis.get<Record<string, EarningsScheduleEntry>>(SCHEDULE_KEY);
      if (cached && typeof cached === "object" && Object.keys(cached).length) {
        return new Map(Object.entries(cached));
      }
    } catch {
      // fail open -- rebuild below
    }
  }

  const months = monthsAround(nowMs);
  const rows: RawEarningsRow[] = [];
  for (const { year, month } of months) {
    try {
      rows.push(...(await fetchMonthRows(year, month)));
    } catch {
      // One unreadable month is a smaller index, not no index. A missing month
      // makes some symbols look un-reported, and the floor in stockDataCache is
      // what stops that becoming a permanent exclusion.
    }
  }

  const schedule = buildSchedule(rows, nowMs);

  // NEVER CACHE AN EMPTY INDEX. An empty result means every month read failed,
  // and pinning it for a day would put the whole universe on the floor -- every
  // symbol refreshing at the 120-day cadence and the trigger silently inert,
  // with every run still reporting success.
  if (redis && schedule.size) {
    try {
      await redis.set(SCHEDULE_KEY, Object.fromEntries(schedule), {
        ex: SCHEDULE_TTL_SECONDS,
      });
    } catch {
      // fail open
    }
  }

  return schedule;
}
