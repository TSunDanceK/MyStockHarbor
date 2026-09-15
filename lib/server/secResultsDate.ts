// The results date: the spine of both halves of /earnings-calendar.
//
// The grid inverts this by date; the due strip asks which periods have no entry.
// ONE SOURCE OF TRUTH FOR ONE QUESTION -- it goes in the manifest rather than a
// parallel store, because two stores answering "when did this company report"
// is claude/traps/two-validators-for-one-value.md with extra steps.
//
// ── THE RULE, AND WHY IT IS NOT "THE LATEST 8-K" ───────────────────────────
// A results filing is the FIRST 8-K carrying item 2.02 after period end P.
// Foreign private issuers file no 8-K at all -- ARM has never filed one -- so
// they use 6-K, deduplicated on accession and preferring the one whose
// reportDate is a period end, because ARM files them in SAME-DAY PAIRS. That is
// measured, not hypothetical.
//
// ── STRICT, WITH A FALLBACK THAT FIRES ONLY ON ZERO ────────────────────────
// Results releases attach the financial statements as an exhibit under item
// 9.01, so a filing carrying BOTH 2.02 and 9.01 is the better candidate.
// Measured over 1,274 ambiguous periods:
//
//   resolves to exactly one under strict   157  (12.3%)
//   still ambiguous                      1,107  (86.9%)
//   resolves to ZERO                        10  (0.8%)
//   lag-outlier rate                     51.5% -> 44.7%
//
// So strict is a real improvement and a weak discriminator: nearly 87% of
// ambiguous periods still carry more than one filing with both items. It is
// adopted because it is free and strictly better, NOT because it resolves the
// ambiguity -- and the attribution error it leaves is why the page's accuracy
// is an upper bound rather than a measurement.
//
// THE FALLBACK FIRES ONLY WHEN STRICT RESOLVES TO ZERO. Falling back when
// strict resolves to ONE would silently reinstate the loose rule everywhere and
// discard the 6.8-point improvement while still looking like it applied.
//
// ITEM NUMBERS ARE NOT IN THE DAILY INDEX -- it carries the form type only.
// They come from data.sec.gov/submissions/CIK##########.json, ~25 KB a symbol.

/** A filing row, flattened from submissions' column store. */
export type FilingRow = {
  accn: string;
  form: string;
  /** YYYY-MM-DD */
  filingDate: string;
  /** YYYY-MM-DD. For a periodic report this is the FISCAL PERIOD END. */
  reportDate: string;
  /** Comma-separated 8-K item numbers. Empty for forms that carry none. */
  items: string;
};

export type ResultsAttribution = {
  /** Fiscal period end the filing reports on, YYYY-MM-DD. */
  periodEnd: string;
  /** Filing date of the results release, YYYY-MM-DD. */
  filed: string;
  accn: string;
  /** Which arm chose it. "loose" means strict resolved to zero for this period. */
  rule: "strict" | "loose";
  /** Candidates that were in scope for this period, before the rule was applied. */
  candidates: number;
};

const DAY = 86_400_000;

/**
 * How far after a period end a filing can still be that period's results.
 *
 * Bounded so a company that simply never released for P does not adopt the NEXT
 * period's release as P's -- which would silently clear a symbol off the due
 * strip using a filing about a different quarter.
 */
export const MAX_ATTRIBUTION_DAYS = 120;

/** Item 2.02 -- Results of Operations and Financial Condition. */
const ITEM_RESULTS = /\b2\.02\b/;
/** Item 9.01 -- Financial Statements and Exhibits. */
const ITEM_EXHIBITS = /\b9\.01\b/;

const parse = (d: string): number => Date.parse(`${d}T00:00:00.000Z`);
const valid = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(parse(d));

/**
 * Is this filer a foreign private issuer?
 *
 * DERIVED FROM THE FORM SET, never from the ticker or the country. A filer with
 * 20-F or 40-F and no 10-Q reports through 6-K; one with a 10-Q does not,
 * whatever else it files.
 */
export function isForeignPrivateIssuer(rows: FilingRow[]): boolean {
  let annualForeign = false;
  let quarterlyDomestic = false;
  for (const r of rows) {
    if (r.form === "20-F" || r.form === "40-F") annualForeign = true;
    if (r.form === "10-Q") quarterlyDomestic = true;
  }
  return annualForeign && !quarterlyDomestic;
}

/**
 * Fiscal period ends for a domestic filer, ascending.
 *
 * NOTHING HERE ASSUMES A CALENDAR QUARTER. The period end is read off the
 * periodic report's own reportDate, and measured fiscal year ends across five
 * symbols were 31 Mar, 26 Sep, 3 Sep, 31 Oct and 31 Dec. MU's quarter ends on
 * 28 May. A 52/53-week filer's period end moves by a day or two every year, so
 * any arithmetic that derives one date from another is wrong by construction.
 */
export function domesticPeriodEnds(rows: FilingRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (!/^10-[QK]/.test(r.form)) continue;
    if (valid(r.reportDate)) set.add(r.reportDate);
  }
  return [...set].sort();
}

/**
 * The 6-K filings that carry a period, for an FPI.
 *
 * DEDUPLICATED ON ACCESSION, then one per filing day, preferring the latest
 * reportDate -- the closest preceding period end. ARM files 6-Ks in same-day
 * pairs and taking either arbitrarily attributes the quarter to the wrong one.
 *
 * A 6-K filed the same day as its own reportDate is an event notice, not a
 * period report, so a minimum gap is required.
 */
const FPI_MIN_REPORTING_GAP_DAYS = 20;
/** Consecutive period ends must be a reporting period apart. FPIs are not all
 *  quarterly -- several report half-yearly -- so the window spans both. */
const FPI_MIN_PERIOD_GAP_DAYS = 55;
const FPI_MAX_PERIOD_GAP_DAYS = 200;

export function fpiPeriodFilings(rows: FilingRow[]): Array<{ periodEnd: string; filed: string; accn: string }> {
  // ── GROUPED BY PERIOD, NOT BY FILING DAY ─────────────────────────────────
  //
  // The first cut kept one 6-K per filing DAY and broke same-day ties on the
  // later reportDate. That is wrong for the case it was written for: ARM's pair
  // is a quarter-end report and an event notice filed together, and the event
  // carries the LATER date, so the tiebreak picked the event over the quarter.
  //
  // The period end is chosen by CADENCE instead -- a reportDate a reporting
  // period away from the last accepted one -- which is the rule measured across
  // the universe. Ascending order matters: the true period end is considered
  // before the event that trails it, so the event then fails the minimum gap.
  const seen = new Set<string>();
  const byPeriod = new Map<string, FilingRow>();
  for (const r of rows) {
    if (r.form !== "6-K") continue;
    if (seen.has(r.accn)) continue;
    seen.add(r.accn);
    if (!valid(r.reportDate) || !valid(r.filingDate)) continue;
    if ((parse(r.filingDate) - parse(r.reportDate)) / DAY < FPI_MIN_REPORTING_GAP_DAYS) continue;
    // The FIRST filing to carry a period is the one that reports it.
    const cur = byPeriod.get(r.reportDate);
    if (!cur || parse(r.filingDate) < parse(cur.filingDate)) byPeriod.set(r.reportDate, r);
  }

  // A GAP TOO LARGE RE-ANCHORS, IT DOES NOT REJECT. Treating it as a rejection
  // made one hole in a filer's history reject everything after it: INFY went
  // from 121 raw 6-Ks to 2 usable, and every FPI fell below the bar, which read
  // as "foreign issuers are unpredictable" when it was this filter.
  const ordered = [...byPeriod.values()].sort((a, b) => parse(a.reportDate) - parse(b.reportDate));
  const out: Array<{ periodEnd: string; filed: string; accn: string }> = [];
  let last: number | null = null;
  for (const r of ordered) {
    const p = parse(r.reportDate);
    if (last !== null) {
      const gap = (p - last) / DAY;
      if (gap < FPI_MIN_PERIOD_GAP_DAYS) continue;
      if (gap > FPI_MAX_PERIOD_GAP_DAYS) { last = p; continue; }
    }
    last = p;
    out.push({ periodEnd: r.reportDate, filed: r.filingDate, accn: r.accn });
  }
  return out;
}

/**
 * Attribute a results release to every fiscal period the filings cover.
 *
 * Ascending by period end. The manifest keeps only the last, but the whole
 * series is returned because the due strip needs to know which periods have NO
 * entry, and that question cannot be answered from a single latest value.
 */
export function attributeResults(rows: FilingRow[]): ResultsAttribution[] {
  if (isForeignPrivateIssuer(rows)) {
    return fpiPeriodFilings(rows).map((f) => ({
      periodEnd: f.periodEnd,
      filed: f.filed,
      accn: f.accn,
      // 6-K carries no items field at all, so the 2.02/9.01 distinction cannot
      // apply. Reported as "loose" rather than inventing a third label: the
      // strict rule did not choose this, and saying it did would be a claim the
      // data cannot support.
      rule: "loose" as const,
      candidates: 1,
    }));
  }

  const ends = domesticPeriodEnds(rows);
  const seen = new Set<string>();
  const results = rows
    .filter((r) => r.form === "8-K" && ITEM_RESULTS.test(r.items) && valid(r.filingDate))
    .filter((r) => !seen.has(r.accn) && seen.add(r.accn))
    .sort((a, b) => parse(a.filingDate) - parse(b.filingDate));

  const out: ResultsAttribution[] = [];
  for (let i = 0; i < ends.length; i++) {
    const P = parse(ends[i]);
    const nextP = i + 1 < ends.length ? parse(ends[i + 1]) : Infinity;
    const ceiling = Math.min(nextP, P + MAX_ATTRIBUTION_DAYS * DAY);
    const candidates = results.filter((r) => {
      const t = parse(r.filingDate);
      return t > P && t <= ceiling;
    });
    if (!candidates.length) continue;

    const strict = candidates.filter((r) => ITEM_EXHIBITS.test(r.items));
    // ONLY ON ZERO. See the header: falling back when strict resolves to one
    // reinstates the loose rule while appearing to apply the strict one.
    const chosen = strict.length > 0 ? strict[0] : candidates[0];
    out.push({
      periodEnd: ends[i],
      filed: chosen.filingDate,
      accn: chosen.accn,
      rule: strict.length > 0 ? "strict" : "loose",
      candidates: candidates.length,
    });
  }
  return out;
}

/** The most recent attributed release, or null when nothing is attributable. */
export function latestResults(rows: FilingRow[]): ResultsAttribution | null {
  const all = attributeResults(rows);
  return all.length ? all[all.length - 1] : null;
}

/** Flatten submissions' column store into rows. Tolerates missing columns. */
export function flattenFilings(block: Record<string, unknown> | null | undefined): FilingRow[] {
  const col = (name: string): unknown[] => {
    const v = (block ?? {})[name];
    return Array.isArray(v) ? v : [];
  };
  const accn = col("accessionNumber");
  const out: FilingRow[] = [];
  for (let i = 0; i < accn.length; i++) {
    out.push({
      accn: String(accn[i] ?? ""),
      form: String(col("form")[i] ?? ""),
      filingDate: String(col("filingDate")[i] ?? ""),
      reportDate: String(col("reportDate")[i] ?? ""),
      items: String(col("items")[i] ?? ""),
    });
  }
  return out;
}
