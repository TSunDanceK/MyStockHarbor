// WHICH SYMBOLS THE SCHEDULED SEC JOBS MAY TAKE ON (#552 COWORK #147 1a).
//
// The sec-facts manifest admitted anything with a CIK: the render path's
// security-kind gate (admitSymbolForExtraction) was never applied to it. So a
// preferred or warrant sharing its issuer's CIK (STRK, MicroStrategy's) would
// be populated with the PARENT's statements, and warm-pickers-sec, which reads
// stored sets directly, would build a picker row from them. An ETF or trust
// costs a request for an empty set (SPY) or stores a trust's own 10-K figures
// on a fund's page (GLD, IBIT). Widening the seed to the whole universe (#139)
// would have multiplied both, and MANIFEST ENTRIES ARE NEVER REMOVED — so the
// gate goes in before the widening, not after.
//
// ONE RULE FOR THE SEED AND THE POPULATE QUEUE: a new symbol is not seeded,
// and an entry already in the manifest that fails it is never populated.
// Pure over committed files: no Redis, no network.
import { admitSymbolForExtraction } from "./securityKind";
import { nonEquityListingOf } from "./secPrimaryListing";
import { uniqueEtfs } from "../curatedSymbols";
import { toDashed } from "../symbolSpellings.mjs";

/** The curated ETFs and trusts: SEC has no operating figures for a fund's page. */
const ETFS = new Set(uniqueEtfs.map((s) => toDashed(s.toUpperCase())));

export type SeedRefusal = "no-cik" | "etf" | "non-equity" | "security-kind";

/** Null when the symbol may be seeded and populated; else why not. */
export function secSeedRefusal(symbol: string, cik: string | null | undefined): SeedRefusal | null {
  const clean = String(symbol ?? "").trim().toUpperCase();
  if (!cik) return "no-cik";
  if (ETFS.has(toDashed(clean))) return "etf";
  if (nonEquityListingOf(clean)) return "non-equity";
  if (!admitSymbolForExtraction(clean, cik).admit) return "security-kind";
  return null;
}
