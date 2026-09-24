// Which universe symbols the FUNDAMENTALS presets must leave out (Relay B, #553
// COWORK #14): exchange-traded notes and preferreds.
//
// THE BUG: CCZ and TBB appeared on /cash-rich-value-stocks. They are notes of
// Comcast and AT&T; SEC files the issuer's statements under the same CIK, so
// the preset paired a note's price with its parent's cash flow.
//
// NOT A NEW CLASSIFIER. lib/server/securityKind.ts (A's SEC guard) already
// answers exactly this question -- "do the issuer's statements describe this
// security's economics?" -- measured against the real population so that LP
// units (ET, MPLX), registry shares (ASML) and ADRs stay in. This module only
// feeds it a CIK group from the committed ticker map and a name from the
// committed snapshot, the same two inputs its own entry point uses. No network,
// no Redis: a gate that depends on a fetch opens when the fetch is slow.
//
// CCZ ("Comcast Holdings ZONES") is caught by the guard's own debt-acronym
// rule since #575; the interim B-side ZONES line is gone.
import { admitForExtraction } from "./securityKind";
import { loadTickerMap } from "./secTickerMap";
import { snapshotCompanyName } from "./companyNameSnapshot";
import { lookupBySpelling } from "../symbolSpellings.mjs";

export type FundamentalsExclusion = "debt-or-preferred" | "unverifiable" | null;

export type EquityInputs = {
  symbol: string;
  cik: string | null;
  /** Every symbol on that CIK, this one included. */
  cikGroup: string[];
  securityName: string | null;
};

/** Pure: why this symbol leaves the fundamentals presets, or null to keep it. */
export function fundamentalsExclusion(inputs: EquityInputs): FundamentalsExclusion {
  const verdict = admitForExtraction(inputs);
  if (verdict.admit) return null;
  return verdict.reason === "derivative-of-issuer" ? "debt-or-preferred" : "unverifiable";
}

let groups: Map<string, string[]> | null = null;

function cikGroupsFrom(map: Map<string, { cik?: string | null }>): Map<string, string[]> {
  const built = new Map<string, string[]>();
  for (const [symbol, entry] of map) {
    if (!entry?.cik) continue;
    const list = built.get(entry.cik);
    if (list) list.push(symbol);
    else built.set(entry.cik, [symbol]);
  }
  return built;
}

/** The render-path entry point. Synchronous; committed data only. */
export function excludedFromFundamentals(symbol: string): FundamentalsExclusion {
  const { present, map } = loadTickerMap();
  // No map, no CIK groups: nothing can be shown to share a CIK, so nothing is
  // excluded -- the same answer the guard gives, and loud elsewhere (the SEC
  // pages refuse too).
  if (!present) return null;
  if (!groups) groups = cikGroupsFrom(map);
  const cik = lookupBySpelling(map, symbol)?.value?.cik ?? null;
  return fundamentalsExclusion({
    symbol,
    cik,
    cikGroup: cik ? groups.get(cik) ?? [] : [],
    securityName: snapshotCompanyName(symbol) || null,
  });
}
