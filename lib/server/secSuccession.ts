// A LISTED COMPANY THAT MOVED TO A NEW CIK (#552 COWORK #28, XOM).
//
// On 2026-07-01 Exxon Mobil became a subsidiary of a new holding company,
// ExxonMobil Holdings Corp, and the XOM ticker moved to the holding
// company's CIK. companyfacts is per CIK, so the new one starts at the
// reorganization: one 10-Q, two quarters, no fiscal year. Everything before
// sits under the predecessor's CIK. The page showed XOM with no P/E and no
// fiscal labels, and nothing in the payload says a predecessor exists.
//
// A CITED LIST, NOT A DETECTOR. Each pair in data/sec/successor-ciks.json is
// reviewed from EDGAR's own filing lists (8-K12B on the successor, the
// predecessor's delisting). A detector keyed on "new CIK with no history"
// would also fire on every IPO, and splicing an unrelated filer's history
// under a ticker is the worst failure available here.
//
// FILL-ONLY. The successor's own rows always win; the predecessor supplies
// only (tag, unit, start, end) the successor has not published -- the same
// rule as a filing fill (mergeFillOnly), which this reuses.
//
// ONE SHARE, ONE SHARE. A holding-company reorganization exchanges shares
// 1:1, so per-share history carries over. That is CHECKED, not assumed: the
// newest cover-page share counts of the two must agree within
// SUCCESSION_SHARE_TOLERANCE, or the merge is refused and the successor
// stands alone (no history, as before), with a note saying why.
import successorsFile from "@/data/sec/successor-ciks.json";
import type { CompanyFacts } from "./secExtract";
import { mergeFillOnly } from "./secFilingFill";

type Succession = { symbol: string; cik: number; predecessorCik: number; evidence: string[] };
const BY_CIK = new Map<number, Succession>(
  (successorsFile.successors as Succession[]).map((s) => [Number(s.cik), s])
);

/** The cited predecessor CIK for this successor CIK, zero-padded, or null. */
export function predecessorCikFor(cik: number | string | null | undefined): string | null {
  if (cik == null) return null;
  const s = BY_CIK.get(Number(cik));
  return s ? String(s.predecessorCik).padStart(10, "0") : null;
}

/** Cover-page counts more than this far apart are not a 1:1 exchange. */
export const SUCCESSION_SHARE_TOLERANCE = 0.1;

const newestCover = (facts: CompanyFacts): number | null => {
  const rows = facts.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? [];
  let best: { end: string; val: number } | null = null;
  for (const r of rows) {
    if (typeof r.val !== "number" || !r.end) continue;
    if (!best || r.end > best.end) best = { end: r.end, val: r.val };
  }
  return best?.val ?? null;
};

/**
 * PURE. The successor's payload with the predecessor's history filled in, or
 * the successor's unchanged with the reason the merge was refused.
 */
export function mergeSuccession(
  successor: CompanyFacts,
  predecessor: CompanyFacts,
): { facts: CompanyFacts; merged: boolean; note: string } {
  const a = newestCover(successor);
  const b = newestCover(predecessor);
  if (a === null || b === null || Math.abs(a / b - 1) > SUCCESSION_SHARE_TOLERANCE) {
    return {
      facts: successor, merged: false,
      note: `succession: predecessor history NOT merged — cover shares ${a ?? "none"} vs ${b ?? "none"} are not a 1:1 exchange`,
    };
  }
  const { merged, added } = mergeFillOnly(successor, predecessor.facts ?? {}, "USD");
  return {
    facts: { ...merged, cik: successor.cik, entityName: successor.entityName },
    merged: true,
    note: `succession: ${added} rows filled from predecessor CIK ${predecessor.cik}`,
  };
}

/**
 * The one call every companyfacts reader makes before extracting. A CIK with
 * no cited predecessor returns its own payload and costs nothing; a cited
 * successor costs ONE more companyfacts fetch, through the caller's own
 * fetcher (and so its own rate gate).
 */
export async function withPredecessorFacts(
  cik: number | string,
  facts: CompanyFacts,
  fetchFacts: (cik: string) => Promise<CompanyFacts>,
): Promise<CompanyFacts> {
  const pred = predecessorCikFor(cik);
  if (!pred) return facts;
  const out = mergeSuccession(facts, await fetchFacts(pred));
  if (!out.merged) console.warn(`[sec-succession] CIK ${cik}: ${out.note}`);
  return out.facts;
}
