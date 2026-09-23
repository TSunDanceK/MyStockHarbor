// THE DUE LIST: which tracked filers the 2-hourly in-season runs poll.
//
// Built nightly from each filer's own report-date record through the SAME
// outlook the pages print (symbolOutlook.outlookFrom), so "due" here means
// what the site already tells readers:
//   - "due": a period has ended and its filing is outstanding by the filer's
//     own habit;
//   - "expected" in the 0-7 day band;
//   - no estimate because the estimate is already in the past (overdue).
// Everything else waits for the nightly daily-index sweep. One MGET per 100
// records, ~2 MB a night.
import { Redis } from "@upstash/redis";
import { reportDatesKey, type StoredReportDates } from "./secReportDatesStore";
import { outlookFrom } from "./symbolOutlook";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

/** PURE: is this outlook "poll every 2 hours"? */
export function isDueNow(o: { kind: string; band?: string; reason?: string }): boolean {
  return o.kind === "due" || (o.kind === "expected" && o.band === "d0_7") ||
    (o.kind === "no-estimate" && o.reason === "estimate-in-past");
}

export async function buildDueList(symbols: string[], today: string): Promise<string[]> {
  if (!redis) return [];
  const due: string[] = [];
  for (let i = 0; i < symbols.length; i += 100) {
    const batch = symbols.slice(i, i + 100);
    const recs = await redis.mget<(StoredReportDates | null)[]>(...batch.map((s) => reportDatesKey(s)));
    batch.forEach((s, k) => {
      const rec = recs[k] && Array.isArray(recs[k]!.events) ? recs[k] : null;
      if (isDueNow(outlookFrom(s, rec, today))) due.push(s);
    });
  }
  return due;
}
