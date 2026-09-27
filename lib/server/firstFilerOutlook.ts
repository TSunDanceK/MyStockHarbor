// A FIRST-TIME FILER'S NEXT REPORT, HEDGED (#552 COWORK #37 item 6).
//
// The shared estimator needs three stored quarter ends to see a cadence and a
// run of results announcements to measure a lag, so a company whose first
// periodic report is its latest one got "We can't tell when its current fiscal
// period ends" (SPCX, after its Q2 10-Q). The filing itself says more than
// that: the quarter it covers has a start and an end, and it was filed some
// number of days after that end. One quarter on, filed the same number of days
// later, is an estimate worth stating, as a part of a month and never a day,
// with the one-filing basis said beside it.
//
// DERIVED FROM THE STORED SET ON EVERY RENDER. It applies only while no fiscal
// year is on file (the set's own definition of "no annual report yet"); the
// first 10-K turns it off by itself and the shared estimator takes over.
import type { StoredFactSet, StoredPeriod } from "./secFactCodec";
import type { SymbolOutlook } from "./symbolOutlook";
import { plainDate } from "./secEarningsView";

const DAY = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Half-width of the window around the estimate, in days. */
export const FIRST_FILER_SPREAD_DAYS = 7;

const isIso = (s: string | null | undefined): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The same quarter shape one step on: month-end to month-end where the quarter ends on one. */
export function nextQuarterEnd(q: Pick<StoredPeriod, "s" | "e">): string | null {
  if (!isIso(q.s) || !isIso(q.e)) return null;
  const end = new Date(`${q.e}T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate() === end.getUTCDate();
  if (monthEnd) return iso(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 4, 0));
  return iso(Date.parse(q.e) + days(q.s, q.e) * DAY + DAY);
}

const part = (isoDate: string) => {
  const d = Number(isoDate.slice(8, 10));
  return { part: d <= 10 ? "early" : d <= 20 ? "mid" : "late", month: MONTHS[Number(isoDate.slice(5, 7)) - 1] };
};

/** "early–mid November", "late October–early November", "mid November". */
export function monthPartRange(from: string, to: string): string {
  const a = part(from), b = part(to);
  if (a.month === b.month) return a.part === b.part ? `${a.part} ${a.month}` : `${a.part}–${b.part} ${a.month}`;
  return `${a.part} ${a.month}–${b.part} ${b.month}`;
}

/**
 * The hedged estimate, or null where it does not apply: a fiscal year is on
 * file, the newest quarter is not quarter-shaped or has no filing date, or the
 * estimate has already passed (the due logic owns that).
 */
export function firstFilerNextReport(
  symbol: string,
  set: Pick<StoredFactSet, "quarters" | "years">,
  today: string,
): SymbolOutlook | null {
  if (set.years.length > 0) return null;
  const q = set.quarters[0];
  if (!q || !isIso(q.s) || !isIso(q.f)) return null;
  const span = days(q.s, q.e);
  if (span < 80 || span > 120) return null;
  const lag = days(q.e, q.f);
  if (lag < 1 || lag > 120) return null;
  const nextEnd = nextQuarterEnd(q);
  if (!nextEnd) return null;
  const est = Date.parse(nextEnd) + lag * DAY;
  const from = iso(est - FIRST_FILER_SPREAD_DAYS * DAY);
  const to = iso(est + FIRST_FILER_SPREAD_DAYS * DAY);
  if (to < today) return null;
  const when = monthPartRange(from, to);
  // COUNTED FROM THE STORED QUARTERS' OWN ACCESSIONS (#552 COWORK #42): a
  // mid-quarter IPO (CBRS) has two 10-Qs on file before any 10-K, and "first
  // filing only" understated the basis.
  const filings = new Set(set.quarters.map((p) => p.a).filter(Boolean)).size;
  const hedge = filings > 1
    ? `Estimated from ${symbol}'s ${filings} quarterly filings so far; the latest was filed ${lag} days after its quarter ended, and timing may differ.`
    : `Estimated from ${symbol}'s first quarterly filing only, filed ${lag} days after its quarter ended; timing may differ.`;
  return {
    symbol, kind: "beyond-window",
    headline: `The quarter to ${plainDate(nextEnd)} may be reported around ${when}.`,
    value: `Est. ${when}`,
    hedge,
    evidence: [`Quarter to ${plainDate(q.e)}: filed ${plainDate(q.f)}.`],
  };
}
