// THE QQQ PAGE'S WEEKLY FIGURES (#553 COWORK #217): researched once a week and
// kept in content/markets/qqq-weekly.json, read at render time by
// app/markets/qqq/page.tsx through parseQqqWeekly. A Friday-evening scheduled
// task edits only that file; a file that fails the check shows no weekly
// figures rather than wrong ones.
//
// THE SAME SCHEMA AND LIMITS AS THE SPX FILE, BY CONSTRUCTION: this module
// re-exports lib/spxWeekly.ts's limits and validates with its parser, so the
// two pages' weekly files can never drift apart in shape, caps, wording rules
// or staleness. Only the meaning of the index fields differs:
//
//   indexClose, ath   the Nasdaq-100 index (NDX), not QQQ; quoted as text only
//   breadth.pct200    % of Nasdaq-100 members above their 200-day average
//
// Everything LIVE on the page comes from QQQ's Tiingo bars instead (a
// licensable security); index levels appear only as text in this file, the
// same pattern as SPX / SPY.
//
// The scheduled task depends on these names: content/markets/qqq-weekly.json,
// lib/qqqWeekly.ts, scripts/check-qqq-weekly.mjs.
import { parseSpxWeekly, type SpxWeekly, type SpxWeeklyRead } from "./spxWeekly";

export {
  STALE_DAYS,
  ONE_LINER_MAX,
  POINT_MAX,
  WATCH_MAX,
  INTRO_MIN,
  INTRO_MAX,
  SECTION_MIN,
  SECTION_MAX,
  SECTION_HEADING_MAX,
  MARKET_READ_MIN,
  MARKET_READ_MAX,
  PARAGRAPH_MIN,
  WATCH_MIN,
  SECTION_KEYS,
  FORBIDDEN,
  THIRD_PARTY_INDEX,
  isIsoDate,
  isStale,
  weeklyDate,
  indexWords,
  type SectionKey,
} from "./spxWeekly";

/** The QQQ page's weekly file: the SPX file's shape, describing the Nasdaq-100 (NDX). */
export type QqqWeekly = SpxWeekly;
export type QqqWeeklyRead = SpxWeeklyRead;

/** The file, checked by the SPX file's own rules: shape and types, valid dates, length caps, no advice words. */
export function parseQqqWeekly(raw: unknown): QqqWeeklyRead {
  return parseSpxWeekly(raw);
}
