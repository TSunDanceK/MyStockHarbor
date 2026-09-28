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
  /** Tickers on the same CIK that the 12(b) table lists as notes, debentures or units, with their class. */
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

/**
 * THE COVER COUNT CITED FROM THE PRIMARY'S OWN LATEST ANNUAL REPORT (#552 COWORK #56):
 * parsed from the entry's evidence line ("460,488,788 Limited Partnership
 * Units as of December 31, 2025"), never typed twice. BIP's dei cover count is
 * 295,429,987 as of 2020 and is refused as stale; the 20-F cover states the
 * current one. Only for the PRIMARY: a debt ticker gets nothing here.
 */
const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};
export function citedCoverFor(symbol: string): { val: number; asOf: string; quote: string; source: string } | null {
  const s = String(symbol ?? "").toUpperCase();
  const e = Object.values(ENTRIES).find((x) => x.primary === s);
  const line = e?.evidence?.[1];
  // Three cover wordings: "N <class> as of <date>" (BIP's 20-F); "As of
  // <date>, there were N shares of <class>" (CMCSA's 10-K, #552 COWORK #61);
  // and a table, "Shares Outstanding at <date> <registrant> <class> N" (SO's
  // 10-K, #552 COWORK #63).
  const a = line ? /^([\d,]+)\s+.+?\s+as of\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(line) : null;
  const b = line && !a ? /^As of\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+there were\s+([\d,]+)\s+shares of\s+.+$/.exec(line) : null;
  const c = line && !a && !b ? /^Shares Outstanding at\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+.+?\s+([\d,]+)$/.exec(line) : null;
  const [count, month, day, year] = a ? [a[1], a[2], a[3], a[4]] : b ? [b[4], b[1], b[2], b[3]] : c ? [c[4], c[1], c[2], c[3]] : [];
  const mm = month ? MONTHS[month.toLowerCase()] : undefined;
  if (!e || !count || !day || !mm) return null;
  const val = Number(count.replace(/,/g, ""));
  if (!Number.isFinite(val) || val <= 0) return null;
  return { val, asOf: `${year}-${mm}-${day.padStart(2, "0")}`, quote: line!, source: e.source };
}
