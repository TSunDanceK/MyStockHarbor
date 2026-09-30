// THE REPORT-DATES RECORD FOR A COLD-FILLED SYMBOL (#552 COWORK #78, WDFC).
//
// A cold fill wrote WDFC's figures on first view, but nothing wrote its
// report-dates record: sec-facts only reaches a symbol once the cold CIK has
// been drained into the manifest, so for up to half a day the earnings page had
// no next-report section and the stock page said "We have no SEC filing record
// for it yet" beside a filed quarter. The fill now seeds the record itself,
// through the same builder the crons use (secReportDatesWrite), so the page it
// revalidates carries both.
//
// ONLY WHEN THERE IS NO RECORD: one GET decides, so a warm symbol's "filled"
// reply spends nothing else. Then one SEC request (two for a cited successor)
// and the builder's 2 Redis writes. BOUNDED AND BEST EFFORT: a slow or failed
// submissions fetch leaves the record to the cron, exactly as before, and
// never changes the fill's outcome.
import { readFactSet } from "./secFactStore";
import { readReportDatesChecked } from "./secReportDatesStore";
import { buildAndWriteReportDates, withPredecessorSubmissions } from "./secReportDatesWrite";
import type { Submissions } from "./secReportDates";

/** Well inside the client's 12 s ceiling on top of the fill itself. */
export const COLD_DATES_TIMEOUT_MS = 3_000;

export type SeedOutcome = "written" | "exists" | "no-set" | "failed" | "timeout";

/** The store and builder, injectable so a check can drive every branch without Redis. */
export type SeedDeps = {
  readRecord: typeof readReportDatesChecked;
  readSet: typeof readFactSet;
  build: typeof buildAndWriteReportDates;
};
const REAL: SeedDeps = { readRecord: readReportDatesChecked, readSet: readFactSet, build: buildAndWriteReportDates };

export async function seedColdReportDates(
  symbol: string,
  cik: string,
  fetchSubmissions: (cik: string) => Promise<Submissions>,
  todayIso: string,
  timeoutMs = COLD_DATES_TIMEOUT_MS,
  deps: SeedDeps = REAL,
): Promise<SeedOutcome> {
  const work = async (): Promise<SeedOutcome> => {
    const read = await deps.readRecord(symbol);
    if (!read.ok) return "failed";
    if (read.rec) return "exists";
    const set = await deps.readSet(symbol);
    if (!set) return "no-set";
    const subs = await withPredecessorSubmissions(cik, await fetchSubmissions(cik), fetchSubmissions);
    return (await deps.build(symbol, cik, set, subs, todayIso)).ok ? "written" : "failed";
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work().catch((): SeedOutcome => "failed"),
      new Promise<SeedOutcome>((r) => { timer = setTimeout(() => r("timeout"), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
