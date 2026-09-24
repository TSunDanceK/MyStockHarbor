// "WHO IS SPENDING" (Relay C, #563 COWORK #1 D1) — pure aggregation, shared by
// the job, the relay seed and the check. No Redis, no network.
//
// WHAT IT BUILDS. For each sector, five calendar years of capital expenditure,
// revenue and R&D, summed over the companies in that sector, from each
// company's own annual cash-flow and income statements as A's SEC fact sets
// store them (already in USD; one capex concept per filer).
//
// ── THE RULES, EACH ONE A WAY THE CHART COULD MISLEAD ─────────────────────
// 1. CALENDAR YEARS, NOT FISCAL YEARS. A fiscal year is placed in the calendar
//    year holding most of it (its midpoint), so Microsoft's July–June year and
//    NVIDIA's February–January year both land where most of their spending
//    happened. Summing "FY2025" across companies would add up years that end
//    as much as eleven months apart.
// 2. A FIXED COHORT PER SECTOR. A sector's bars sum only the companies that
//    report capex in EVERY one of the five years. Otherwise a bar can grow
//    because more companies started reporting, not because anyone spent more.
//    The same rule, separately, for capex-to-revenue and for R&D.
// 3. NOTHING IS GUESSED. A company with no sector from the resolver is counted
//    as unclassified, not placed. A company whose figures could not be
//    converted to US dollars has no stored years (A's FX rule) and is counted
//    as "reporting in another currency", not dropped silently.
// 4. SECTOR TOTALS ONLY. There is no grand total and nothing flows between
//    sectors or between this panel and the others.

export const SPENDING_YEARS = 5;

export type SpendingYearInput = {
  /** Fiscal-year start (YYYY-MM-DD) or null. */
  s: string | null;
  /** Fiscal-year end (YYYY-MM-DD). */
  e: string;
  capex: number | null;
  revenue: number | null;
  rnd: number | null;
};

export type SpendingInput = {
  symbol: string;
  sector: string | null;
  /** Reporting currency; absent or "USD" for USD filers. */
  currency: string | null;
  years: SpendingYearInput[];
};

export type SectorSpending = {
  sector: string;
  /** Companies reporting capex in every year (the bars' cohort). */
  cohort: number;
  capex: number[];
  /** Companies in the capex cohort that also report revenue every year. */
  ratioCohort: number;
  /** Capex divided by revenue for the ratio cohort, per year. */
  capexToRevenue: (number | null)[];
  /** Companies reporting R&D in every year, and their R&D per year. */
  rndCohort: number;
  rnd: number[];
  /** The three largest spenders in the latest year (tickers), largest first. */
  top: string[];
};

export type SpendingRecord = {
  v: 1;
  builtAt: number;
  /** The calendar years, oldest first. */
  years: number[];
  companiesRead: number;
  /** Companies with no usable annual figures in USD (another reporting currency). */
  otherCurrency: number;
  /** Companies the sector resolver could not place. */
  unclassified: number;
  /** Companies with some capex but not in all five years (outside every cohort). */
  partial: number;
  sectors: SectorSpending[];
};

/**
 * The calendar year holding most of a fiscal year: the year of its midpoint.
 * With no start date, a year of 365 days before the end is assumed.
 */
export function calendarYearOf(s: string | null, e: string): number {
  const end = Date.parse(`${e}T00:00:00Z`);
  const start = s ? Date.parse(`${s}T00:00:00Z`) : end - 364 * 864e5;
  return new Date((start + end) / 2).getUTCFullYear();
}

/** The last SPENDING_YEARS complete calendar years before `nowMs`. */
export function spendingYears(nowMs: number): number[] {
  const last = new Date(nowMs).getUTCFullYear() - 1;
  return Array.from({ length: SPENDING_YEARS }, (_, i) => last - SPENDING_YEARS + 1 + i);
}

const usable = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function aggregateSpending(inputs: SpendingInput[], years: number[], nowMs: number): SpendingRecord {
  type Row = { symbol: string; capex: (number | null)[]; revenue: (number | null)[]; rnd: (number | null)[] };
  const bySector = new Map<string, Row[]>();
  let otherCurrency = 0, unclassified = 0, partial = 0;
  for (const input of inputs) {
    if (!input.years.length) {
      if (input.currency && input.currency !== "USD") otherCurrency++;
      continue;
    }
    // One fiscal year per calendar year: when two land on the same one (a
    // changed year-end), the one ending later is kept.
    const byYear = new Map<number, SpendingYearInput>();
    for (const y of [...input.years].sort((a, b) => a.e.localeCompare(b.e))) byYear.set(calendarYearOf(y.s, y.e), y);
    const pick = (k: "capex" | "revenue" | "rnd") => years.map((cy) => {
      const v = byYear.get(cy)?.[k];
      return usable(v) ? v : null;
    });
    const row: Row = { symbol: input.symbol, capex: pick("capex"), revenue: pick("revenue"), rnd: pick("rnd") };
    if (!input.sector) {
      if (row.capex.some((v) => v !== null)) unclassified++;
      continue;
    }
    if (row.capex.some((v) => v !== null) && row.capex.some((v) => v === null)) partial++;
    const list = bySector.get(input.sector) ?? [];
    list.push(row);
    bySector.set(input.sector, list);
  }
  const complete = (a: (number | null)[]): a is number[] => a.every((v) => v !== null);
  const sectors: SectorSpending[] = [];
  for (const [sector, rows] of bySector) {
    const cohort = rows.filter((r) => complete(r.capex));
    if (!cohort.length) continue;
    const ratio = cohort.filter((r) => complete(r.revenue));
    const rndRows = rows.filter((r) => complete(r.rnd));
    const sum = (rs: Row[], k: "capex" | "revenue" | "rnd", i: number) => rs.reduce((a, r) => a + (r[k][i] as number), 0);
    const last = years.length - 1;
    sectors.push({
      sector,
      cohort: cohort.length,
      capex: years.map((_, i) => sum(cohort, "capex", i)),
      ratioCohort: ratio.length,
      capexToRevenue: years.map((_, i) => {
        const rev = sum(ratio, "revenue", i);
        return ratio.length && rev > 0 ? sum(ratio, "capex", i) / rev : null;
      }),
      rndCohort: rndRows.length,
      rnd: years.map((_, i) => sum(rndRows, "rnd", i)),
      top: [...cohort].sort((a, b) => (b.capex[last] as number) - (a.capex[last] as number)).slice(0, 3).map((r) => r.symbol),
    });
  }
  sectors.sort((a, b) => b.capex[b.capex.length - 1] - a.capex[a.capex.length - 1]);
  return { v: 1, builtAt: nowMs, years, companiesRead: inputs.length, otherCurrency, unclassified, partial, sectors };
}
