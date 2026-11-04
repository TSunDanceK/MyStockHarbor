// THE STRIP'S ROWS PER DAY, shared by the page and the figures job.
//
// One row per filer, under its most-traded class, with the record its
// announcement is under (`source`) -- the rule the page has rendered since
// #552 COWORK #174. It lives here so the hourly job (app/api/jobs/
// earnings-week-figures) fills exactly the rows the page shows, keyed by the
// same shown ticker.
import { getDayCandidates } from "./earningsCalendar";
import { readPricePoolBulk } from "./pricePool";
import { baseTicker, hasClassSuffix, primaryPerFiler } from "./earningsWeek";
import { registrantFor } from "./stockProfile";
import { gridAdmits, gridCompanyName } from "./secTickerNames";

type Candidate = Awaited<ReturnType<typeof getDayCandidates>>[number];
export type StripRow = Candidate & { source: string; symbol: string; company: string };

/** A class ticker's base on the same CIK (MKC-V → MKC), offered so the row can show the class readers know. */
export function siblingsOf(s: string): string[] {
  if (!hasClassSuffix(s)) return [];
  const base = baseTicker(s);
  const cik = registrantFor(s)?.cik;
  return cik && registrantFor(base)?.cik === cik && gridAdmits(base) ? [base] : [];
}

/** Every ticker the strip may show, with the class bases: the price-pool read. */
export function stripSymbols(raw: readonly (readonly Candidate[])[]): string[] {
  return [...new Set(raw.flat().flatMap((c) => [c.symbol, ...siblingsOf(c.symbol)]))];
}

/** Per day, one row per filer under its most-traded class. */
export function stripLists(raw: readonly (readonly Candidate[])[], volumeOf: (s: string) => number | null): StripRow[][] {
  return raw.map((cands) =>
    primaryPerFiler([...cands], { cikOf: (s) => registrantFor(s)?.cik ?? null, siblingsOf, volumeOf })
      .map(({ row, symbol }) => ({ ...row, source: row.symbol, symbol, company: symbol === row.symbol ? row.company : gridCompanyName(symbol) || row.company })));
}

/** The job's read: the days' candidates, the pool's volumes, and the rows. */
export async function stripDaySymbols(days: readonly string[]): Promise<Map<string, { symbol: string; source: string }[]>> {
  const raw = await Promise.all(days.map((d) => getDayCandidates(d)));
  const symbols = stripSymbols(raw);
  const pool = symbols.length ? await readPricePoolBulk(symbols).catch(() => new Map()) : new Map();
  const lists = stripLists(raw, (s) => pool.get(s)?.volume ?? null);
  return new Map(days.map((d, i) => [d, lists[i].map((c) => ({ symbol: c.symbol, source: c.source }))]));
}
