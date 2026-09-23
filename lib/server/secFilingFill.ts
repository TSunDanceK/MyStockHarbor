// WHEN SEC'S DATA FEED LAGS A FILING, READ THE FILING ITSELF — PURE, NO I/O.
//
// ── WHY (#535 COWORK #6, option C) ────────────────────────────────────────
// 92 of 862 filers showed an older period than their newest 10-Q/10-K/20-F
// because companyfacts had not published the filed period, seven weeks and
// more after filing (CODE #5). The figures are in the filing's own XBRL: SEC
// extracts the inline document's facts into an instance (`*_htm.xml`) in the
// filing folder. Measured on KO, DUK, V and F (relay 35855287074): the merged
// read matches each company's press release.
//
// ── THE SAME RULES, BY CONSTRUCTION, NOT BY COPY ──────────────────────────
// The instance is reshaped into companyfacts rows and merged FILL-ONLY into
// the companyfacts payload; the caller then runs the shipped
// extractCompanyFacts. So the chains, the preferred-tag logic and the
// YTD -> quarter derivation are the ones every other period goes through. A
// concept the instance does not carry stays absent — nothing is invented.
//
// ── CURRENCY-LOCKED ───────────────────────────────────────────────────────
// Rows are admitted only in the currency companyfacts already reports this
// filer in. TSM's companyfacts carries USD convenience rows to FY2024 and its
// 20-F instance is TWD only: unlocked, TWD wins the currency vote, TWD has no
// rate series, and toStoredSet stores NO periods — the page would go blank.
// Locked, the filing adds nothing and the notice (StoredFactSet.lg) says why.
//
// The fetches live in the cron (app/api/jobs/sec-facts), behind its rate gate.
import type { CompanyFacts, FactRow } from "./secExtract";
import type { FilingRef, StoredFactSet } from "./secFactCodec";
import type { Submissions } from "./secReportDates";

/** The forms that carry a period's financial statements. Originals only. */
export const FILL_FORMS = new Set(["10-Q", "10-K", "20-F", "40-F"]);

/** How many lagging filers one cron run may read a filing for. */
export const FILING_FILLS_PER_RUN = 15;
/** How many symbols one cron run may CHECK for a lag (one submissions read each). */
export const FILING_CHECKS_PER_RUN = 40;
/** The most wall time the filing phase takes out of one cron run. */
export const FILING_PHASE_MS = 60_000;
/** An instance larger than this is not read (the largest measured was 11.5 MB). */
export const FILING_INSTANCE_MAX_BYTES = 25 * 1024 * 1024;

/** The newest original 10-Q/10-K/20-F/40-F in a submissions payload. */
export function newestPeriodicFiling(subs: Submissions | null | undefined): FilingRef | null {
  const r = subs?.filings?.recent;
  if (!r) return null;
  const n = Array.isArray(r.accessionNumber) ? r.accessionNumber.length : 0;
  let best: FilingRef | null = null;
  for (let i = 0; i < n; i++) {
    const form = String(r.form?.[i] ?? "");
    if (!FILL_FORMS.has(form)) continue;
    const filed = String(r.filingDate?.[i] ?? "");
    const reportDate = String(r.reportDate?.[i] ?? "");
    const accn = String(r.accessionNumber?.[i] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filed) || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !accn) continue;
    if (!best || filed > best.filed || (filed === best.filed && reportDate > best.reportDate)) {
      best = { form, accn, filed, reportDate };
    }
  }
  return best;
}

/** The newest period end a stored set holds, quarter or year. */
export function newestStoredEnd(set: Pick<StoredFactSet, "quarters" | "years">): string | null {
  const ends = [...set.quarters, ...set.years].map((p) => p.e).filter(Boolean).sort();
  return ends.at(-1) ?? null;
}

/** Does the filer have a filed period the set does not? The CODE #5 census test. */
export function isLagging(set: Pick<StoredFactSet, "quarters" | "years">, filing: FilingRef | null): boolean {
  if (!filing) return false;
  const newest = newestStoredEnd(set);
  return newest === null || filing.reportDate > newest;
}

/** The instance SEC extracts from an inline filing, from the folder listing. */
export function pickInstanceName(names: string[]): string | null {
  return (
    names.find((n) => /_htm\.xml$/i.test(n)) ??
    names.find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre)\.xml$/i.test(n)) ??
    null
  );
}

// Namespaces by URI, never by prefix (a prefix is the filer's choice). Only the
// four companyfacts publishes: extension concepts are not in companyfacts
// either, and admitting them here would be a second rule.
const NS_BY_URI: [RegExp, string][] = [
  [/fasb\.org\/us-gaap\//, "us-gaap"],
  [/xbrl\.ifrs\.org\/taxonomy\/.*ifrs-full/, "ifrs-full"],
  [/xbrl\.sec\.gov\/dei\//, "dei"],
  [/fasb\.org\/srt\//, "srt"],
];

type FactsTree = NonNullable<CompanyFacts["facts"]>;

/**
 * An XBRL instance as companyfacts rows.
 *
 * NON-DIMENSIONAL CONTEXTS ONLY — companyfacts publishes only those, and a
 * segment (a business line, a subsidiary) is not the consolidated figure.
 * Every row carries the filing's own accession, form, filed date and DEI
 * fiscal focus, as companyfacts rows do.
 */
export function instanceToFacts(xml: string, filing: FilingRef): { facts: FactsTree; rows: number } {
  const prefixNs = new Map<string, string>();
  for (const m of xml.matchAll(/xmlns:([\w.-]+)="([^"]+)"/g)) {
    const hit = NS_BY_URI.find(([re]) => re.test(m[2]));
    if (hit) prefixNs.set(m[1], hit[1]);
  }
  const ctx = new Map<string, { start?: string; end: string }>();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const body = m[2];
    if (/<(?:[\w-]+:)?(segment|scenario)\b/.test(body)) continue;
    const start = body.match(/<(?:[\w-]+:)?startDate>\s*([\d-]+)/)?.[1];
    const end = body.match(/<(?:[\w-]+:)?endDate>\s*([\d-]+)/)?.[1];
    const instant = body.match(/<(?:[\w-]+:)?instant>\s*([\d-]+)/)?.[1];
    if (instant) ctx.set(m[1], { end: instant });
    else if (start && end) ctx.set(m[1], { start, end });
  }
  const units = new Map<string, string>();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?unit>/g)) {
    const ms = [...m[2].matchAll(/<(?:[\w-]+:)?measure>\s*([^<\s]+)/g)]
      .map((x) => x[1].replace(/^[\w-]+:/, ""));
    const u = /divide>/.test(m[2]) && ms.length === 2 ? `${ms[0]}/${ms[1]}` : ms[0];
    if (u) units.set(m[1], u);
  }
  const dei = (tag: string) => xml.match(new RegExp(`<[\\w-]+:${tag}\\b[^>]*>\\s*([^<]+)<`))?.[1]?.trim();
  const fy = Number(dei("DocumentFiscalYearFocus")) || undefined;
  const fp = dei("DocumentFiscalPeriodFocus") || undefined;

  const facts: FactsTree = {};
  const seen = new Set<string>();
  let rows = 0;
  for (const m of xml.matchAll(/<([\w-]+):(\w+)\b([^>]*?\bcontextRef="([^"]+)"[^>]*)>([^<]*)<\/\1:\2>/g)) {
    const ns = prefixNs.get(m[1]);
    if (!ns) continue;
    const c = ctx.get(m[4]);
    if (!c) continue;
    const unitRef = m[3].match(/\bunitRef="([^"]+)"/)?.[1];
    const unit = unitRef ? units.get(unitRef) : undefined;
    if (!unit) continue;
    const text = m[5].trim();
    if (!text) continue;
    const val = Number(text);
    if (!Number.isFinite(val)) continue;
    const key = `${ns}|${m[2]}|${unit}|${c.start ?? ""}|${c.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row: FactRow = { end: c.end, val, accn: filing.accn, form: filing.form, filed: filing.filed, fy, fp };
    if (c.start) row.start = c.start;
    const byTag = (facts[ns] ??= {});
    const def = (byTag[m[2]] ??= { units: {} });
    const unitsOf = (def.units ??= {});
    (unitsOf[unit] ??= []).push(row);
    rows++;
  }
  return { facts, rows };
}

/** Does this unit carry a currency other than the locked one? */
const foreignCurrencyIn = (unit: string, currency: string) =>
  unit.split("/").some((part) => /^[A-Z]{3}$/.test(part) && part !== currency);

/**
 * FILL-ONLY, CURRENCY-LOCKED. companyfacts wins wherever it already has the
 * same (namespace, tag, unit, start, end); the filing only supplies what the
 * feed has not published. Returns a new payload; the input is not touched.
 */
export function mergeFillOnly(
  companyfacts: CompanyFacts,
  filing: FactsTree,
  currency: string
): { merged: CompanyFacts; added: number } {
  const merged: CompanyFacts = structuredClone(companyfacts);
  const tree = (merged.facts ??= {});
  let added = 0;
  for (const [ns, tags] of Object.entries(filing)) {
    for (const [tag, def] of Object.entries(tags ?? {})) {
      for (const [unit, rows] of Object.entries(def?.units ?? {})) {
        if (foreignCurrencyIn(unit, currency)) continue;
        const byTag = (tree[ns] ??= {});
        const target = ((byTag[tag] ??= { units: {} }).units ??= {});
        const list = (target[unit] ??= []);
        const have = new Set(list.map((r) => `${r.start ?? ""}|${r.end ?? ""}`));
        for (const r of rows ?? []) {
          if (have.has(`${r.start ?? ""}|${r.end ?? ""}`)) continue;
          list.push(r);
          added++;
        }
      }
    }
  }
  return { merged, added };
}
