// THE PRIMARY COMMON LISTING PER SHARED CIK (#552 COWORK #48/#55):
// data/sec/primary-listings.json.
//
// BIP, BIPH and BIPI share Brookfield Infrastructure's CIK. Only BIPI reached
// the SEC universe (through the dynamic pool), so the fact set was stored under
// a ticker its own 20-F lists as "5.125% Perpetual Subordinated Notes" while
// the "Limited Partnership Units" listing, BIP, had none. Each entry is cited
// from the cover: the 12(b) row that names the class and ticker, and the
// cover's count for that class. Nothing here is inferred from ticker spelling.
import listingsFile from "@/data/sec/primary-listings.json";

export type PrimaryListing = {
  primary: string;
  /** The equity class the primary trades as, as the 12(b) row names it. */
  class: string;
  /** Verbatim: the 12(b) row, then the cover's count for that class. */
  evidence: string[];
  /** Tickers on the same CIK that the 12(b) table lists as debt, with their class. */
  nonEquity?: Record<string, string>;
  form: string;
  source: string;
  filed: string;
};

const ENTRIES = (listingsFile as unknown as { entries: Record<string, PrimaryListing> }).entries;

/** The primaries, for the SEC universe: each is stored and read under its own symbol. */
export function primaryListingSymbols(): string[] {
  return Object.values(ENTRIES).map((e) => e.primary);
}

/** A debt ticker on a mapped CIK: its class and the equity's own listing. */
export function nonEquityListingOf(symbol: string): { cls: string; primary: string } | null {
  const s = String(symbol ?? "").toUpperCase();
  for (const e of Object.values(ENTRIES)) {
    const cls = e.nonEquity?.[s];
    if (cls) return { cls, primary: e.primary };
  }
  return null;
}
