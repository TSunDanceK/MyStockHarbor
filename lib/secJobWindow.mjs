// WHEN THE SITE'S SCHEDULED SEC JOBS ARE READING SEC (UTC), as one predicate.
//
// Two readers keep out of these windows so they never stack on the jobs' own
// pacing past SEC's 10 requests/s fair-access limit:
//   - the daily archive job (lib/secArchiveIncremental.mjs), which refuses to
//     start inside one and stops if it reaches one mid-run;
//   - a page's cold SEC fill (lib/server/secColdFetch.ts, #552 COWORK #132),
//     which queues for the next sec-facts run instead of fetching.
// Moved here from secArchiveIncremental (which re-exports both) so the page's
// action can import it without the archive's modules.
//
// The windows, with margin around each job:
//   03:55–06:50  sec-daily-index 04:00, sec-facts 04:20, sec-filings 04:40,
//                report-dates 05:10, capex 05:50–06:30
//   16:15–16:50  sec-facts 16:20, sec-filings 16:40
//   in reporting season, every even hour :38–:48  (sec-filings)

/** Mirrors lib/server/secFilingJob.ts REPORTING_SEASONS (check-sec-archive asserts they match). */
export const REPORTING_SEASONS = [["01-20", "02-28"], ["04-15", "05-15"], ["07-15", "08-14"], ["10-15", "11-14"]];

export function inSecJobWindow(ms) {
  const d = new Date(ms);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (mins >= 3 * 60 + 55 && mins < 6 * 60 + 50) return true;
  if (mins >= 16 * 60 + 15 && mins < 16 * 60 + 50) return true;
  const md = d.toISOString().slice(5, 10);
  const season = REPORTING_SEASONS.some(([a, b]) => md >= a && md <= b);
  return season && d.getUTCHours() % 2 === 0 && d.getUTCMinutes() >= 38 && d.getUTCMinutes() < 48;
}
