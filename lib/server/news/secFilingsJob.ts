// The job half of the news feed's SEC leg: see secFilingsStore.ts.
//
// Run by sec-daily-index after it has read the day's EDGAR index. Two queues,
// newest need first:
//   1. every tracked symbol that filed ANYTHING in the index dates just
//      processed (8-Ks, 10-Qs, Form 4s — all of it is feed material);
//   2. a bounded backfill of tracked symbols with no stored items yet, so the
//      leg is populated across the manifest within a week of this shipping,
//      rather than only for symbols that happen to file.
// Paced well under SEC's 10 req/s, and time-boxed so it cannot crowd out the
// rest of the job.
import { fetchSubmissionsItems } from "./secProvider";
import { missingSecFilingItems, writeSecFilingItems } from "./secFilingsStore";

export const SEC_NEWS_BACKFILL_PER_RUN = 150;
export const SEC_NEWS_PHASE_MS = 90_000;
/** 150 ms between requests: under 7 req/s, half of SEC's fair-access ceiling. */
export const SEC_NEWS_PACE_MS = 150;

export type SecNewsRun = {
  filed: number;
  backfill: number;
  requests: number;
  written: number;
  failed: number;
  deferred: number;
};

export async function refreshSecFilingNews(filedSymbols: string[], tracked: string[]): Promise<SecNewsRun> {
  const deadline = Date.now() + SEC_NEWS_PHASE_MS;
  const trackedSet = new Set(tracked);
  const filed = [...new Set(filedSymbols)].filter((s) => trackedSet.has(s));
  const filedSet = new Set(filed);
  const missing = (await missingSecFilingItems(tracked.filter((s) => !filedSet.has(s))))
    .slice(0, SEC_NEWS_BACKFILL_PER_RUN);
  const queue = [...filed, ...missing];
  const run: SecNewsRun = { filed: filed.length, backfill: missing.length, requests: 0, written: 0, failed: 0, deferred: 0 };
  let last = 0;
  for (let i = 0; i < queue.length; i++) {
    if (Date.now() > deadline) { run.deferred = queue.length - i; break; }
    const wait = last + SEC_NEWS_PACE_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    run.requests++;
    const items = await fetchSubmissionsItems(queue[i]);
    if (items === null) { run.failed++; continue; }
    if (await writeSecFilingItems(queue[i], items)) run.written++;
  }
  return run;
}
