// The About block's description: the company's own words, from its latest
// annual report on SEC EDGAR (brief 2026-09-22 PR 3, owner-approved sample
// on #518).
//
// ── WHY A COMMITTED FILE AND NOT A REQUEST-TIME FETCH ────────────────────
// An annual report's primary document is megabytes of HTML, and the part the
// page shows changes once a year. data/sec/descriptions.json is built on a
// runner by scripts/sec-descriptions-build.mjs — the SAME locator and cleaner
// (lib/server/secDescription.ts) the owner reviewed on the 31-symbol sample —
// and merged into the repo by .github/workflows/descriptions-commit.yml. To
// refresh it, re-run relay tasks sec-descriptions-1 … -6 and point the commit
// workflow at the new runs.
//
// NO ROW MEANS NO PARAGRAPH (owner, #518): 40-F filers, filers with no annual
// report yet (XOM's holding company), sections a filter rejected (AZN's
// cross-reference) and 20-F filers whose Item 4 has no Business Overview
// (RYAAY, TSM) all render the existing no-description layout. There is no
// FMP fallback — FMP's profile is no longer called for this page.
import descriptionsFile from "@/data/sec/descriptions.json";
import { symbolSpellings } from "@/lib/symbolSpellings.mjs";

/** [form, filedOn (YYYY-MM-DD), accession, text] — positional to keep the file small. */
type Row = [string, string, string, string];

type DescriptionsFile = {
  asOf: string;
  source: string;
  fields: string[];
  rows: Record<string, Row>;
  misses: Record<string, string>;
};

const FILE = descriptionsFile as unknown as DescriptionsFile;

export type FilingDescription = {
  text: string;
  /** "10-K", "10-KT" or "20-F". */
  form: string;
  /** YYYY-MM-DD. */
  filedOn: string;
  accession: string;
};

/** The stored description for a symbol, or null — never a fallback. */
export function filingDescriptionFor(symbol: string): FilingDescription | null {
  for (const s of symbolSpellings(symbol)) {
    const row = FILE.rows[s];
    if (row) return { form: row[0], filedOn: row[1], accession: row[2], text: row[3] };
  }
  return null;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-10-31" → "Oct 2025". Parsed by hand: no time zone can move the month. */
export function monthYear(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : null;
}

/**
 * The owner's attribution line: "From {company}'s {form}, filed {Mon YYYY}".
 * With no company name, "the company's".
 */
export function descriptionAttribution(companyName: string | null, d: FilingDescription): string {
  const who = companyName?.trim() ? `${companyName.trim()}'s` : "the company's";
  const when = monthYear(d.filedOn);
  return `From ${who} ${d.form}${when ? `, filed ${when}` : ""}`;
}
