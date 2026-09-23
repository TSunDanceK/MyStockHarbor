// THE EXTRACTOR, WITH THE REVIEWED PER-FILER EXCEPTIONS APPLIED.
//
// Every app caller extracts through this, so a cited exception cannot reach
// one writer and miss another (scripts/check-fy-naming-overrides.mjs asserts
// no app file calls extractCompanyFacts directly). secExtract itself stays
// free of imports beyond secFields/secCurrency, which is what lets the checks
// lift it.
import overridesFile from "@/data/sec/fiscal-year-naming-overrides.json";
import { extractCompanyFacts, type CompanyFacts, type ExtractResult } from "./secExtract";

type Override = { cik: number; symbol: string; offset: number; citation: string; addedOn: string };
const BY_CIK = new Map<number, Override>(
  (overridesFile.overrides as Override[]).map((o) => [Number(o.cik), o])
);

/** The cited naming offset for this filer, or undefined (the vote stands). */
export function namingOffsetFor(cik: number | string | null | undefined): number | undefined {
  if (cik == null) return undefined;
  return BY_CIK.get(Number(cik))?.offset;
}

export function extractForSymbol(
  symbol: string,
  facts: CompanyFacts,
  opts: Omit<NonNullable<Parameters<typeof extractCompanyFacts>[2]>, "namingOffset"> = {},
): ExtractResult {
  return extractCompanyFacts(symbol, facts, { ...opts, namingOffset: namingOffsetFor(facts.cik) });
}
