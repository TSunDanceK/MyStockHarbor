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
import nonCommonFile from "@/data/sec/non-common-listings.json";
import citedCoversFile from "@/data/sec/cited-covers.json";

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

/** A census row (#552 COWORK #64): one non-common ticker, its 12(b) class and its CIK's common listing. */
export type NonCommonListing = { cls: string; primary: string; cik: string; form: string; source: string; filed: string };
const NON_COMMON = (nonCommonFile as unknown as { entries: Record<string, NonCommonListing> }).entries;

/**
 * A 20-F / 40-F COVER COUNT, CITED (#552 COWORK #86b): data/sec/cited-covers.json.
 * The cover sentence states the count as of the close of the period; the row
 * keeps the sentence verbatim, and the count is read back out of it.
 */
export type CitedCoverRow = {
  form: "20-F" | "40-F";
  /** The accession the cover is from. */
  source: string;
  filed: string;
  /** The date the count is as of: the close of the period the report covers. */
  period: string;
  /** The class the count is of, as the cover names it. */
  class: string;
  count: number;
  /** Verbatim from the cover; must contain `count` as printed. */
  quote: string;
};
const CITED_COVERS = (citedCoversFile as unknown as { entries: Record<string, CitedCoverRow> }).entries;

/** `count` as a cover prints it: 1,234,567 (or 1.234.567, the European layout). */
export function coverQuoteHasCount(row: Pick<CitedCoverRow, "count" | "quote">): boolean {
  const n = Math.round(row.count);
  if (!(n > 0)) return false;
  const comma = n.toLocaleString("en-US");
  return row.quote.includes(comma) || row.quote.includes(comma.replace(/,/g, "."));
}

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
  // THE CENSUS ROWS (#552 COWORK #64), after the hand-cited entries above.
  const c = Object.prototype.hasOwnProperty.call(NON_COMMON, s) ? NON_COMMON[s] : null;
  return c ? { cls: c.cls, primary: c.primary } : null;
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
  if (!e) return citedCoverRowFor(s);
  if (!count || !day || !mm) return null;
  const val = Number(count.replace(/,/g, ""));
  if (!Number.isFinite(val) || val <= 0) return null;
  return { val, asOf: `${year}-${mm}-${day.padStart(2, "0")}`, quote: line!, source: e.source };
}

/**
 * THE 20-F / 40-F ROW, for a symbol with no primary-listing entry (#552 COWORK
 * #86b). Refused (null) unless the row is whole: a positive count, an ISO
 * period, and a quote that prints the count. A row that fails is a data error
 * and check-cited-covers fails on it; here it is simply not used.
 */
export function citedCoverRowFor(symbol: string): { val: number; asOf: string; quote: string; source: string } | null {
  const s = String(symbol ?? "").toUpperCase();
  const r = Object.prototype.hasOwnProperty.call(CITED_COVERS, s) ? CITED_COVERS[s] : null;
  if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.period) || !coverQuoteHasCount(r)) return null;
  return { val: Math.round(r.count), asOf: r.period, quote: r.quote, source: r.source };
}
