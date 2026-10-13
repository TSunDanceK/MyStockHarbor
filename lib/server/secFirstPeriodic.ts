// WHEN A FILER'S PUBLIC RECORD STARTS (#552 COWORK #89 §3): the period end of
// its first periodic report (10-K/10-Q/20-F/40-F), for the dilution chart's
// "pre-listing points are dropped" rule. GDDY's 2013–2014 points come from
// comparatives in its first 10-K, from before it listed (first 10-Q: period
// 2015-03-31), and the chart read them as dilution.
//
// FROM THE ARCHIVED SUBMISSIONS, NOT companyfacts: a long-listed filer's
// facts also start at its first XBRL filing (2009), with comparatives before
// it, so the facts alone can't tell an IPO from the start of XBRL. The file is
// generated read-only from the R2 archive (scripts/dilution-series-probe.mjs on
// the probe branch) and lists only the filers whose series starts before that
// date. A filer absent from it keeps its series as it is.
import firstPeriodicFile from "@/data/sec/first-periodic.json";
import { lookupSpellingIn } from "../symbolSpellings.mjs";

const ROWS = (firstPeriodicFile as unknown as { rows: Record<string, string> }).rows;

/** The first periodic report's period end, YYYY-MM-DD, or null when none is on file. */
export function listedFromFor(symbol: string): string | null {
  const v = lookupSpellingIn(ROWS, String(symbol ?? "").trim().toUpperCase())?.value;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
