// EDGAR's daily index: one request a day that lists every filing by every filer.
//
// This is the change detector, and step 2 of the build order is this file and
// nothing else -- no companyfacts, no submissions, no per-symbol calls at all.
// If one request a day can tell us which of our symbols filed, the rest of the
// pipeline is plumbing.
//
//   https://www.sec.gov/Archives/edgar/daily-index/YYYY/QTRn/master.YYYYMMDD.idx
//   CIK|Company Name|Form Type|Date Filed|File Name
//
// Measured 2026-09-13 from iad1: reachable, layout stable, ~3,600-4,100 rows a
// day, and it correctly surfaced a PLAB 10-Q and two ARM filings from the
// target set.

import { getEasternParts } from "./marketHours";

/**
 * PERIODIC FORMS, AND 6-K/20-F ARE NOT OPTIONAL.
 *
 * ARM -- the symbol this whole page was audited against -- files 20-F and 6-K
 * and has never filed an 8-K in its life. A detector keyed on 10-Q/10-K means
 * ARM never updates, silently, forever. Foreign private issuers are not an edge
 * case here; one of five probe symbols is one.
 */
export const PERIODIC_FORMS = ["10-Q", "10-K", "20-F", "6-K"] as const;

/**
 * `/A` is the restatement signal and it is tracked SEPARATELY from the periodic
 * set. 12,637 amended filings over 29 days market-wide, of which 28 10-K/A and
 * 44 10-Q/A -- about two a day. The 8-K Item 4.02 route does not exist for
 * foreign private issuers at all, so for ARM the suffix is the only signal
 * there is (`20-F/A` is a real form type).
 */
export function isAmendment(form: string): boolean {
  return /\/A$/i.test(form.trim());
}

/** Matches a periodic form, with or without its `/A` suffix. */
export function isPeriodicForm(form: string): boolean {
  const base = form.trim().toUpperCase().replace(/\/A$/, "");
  return (PERIODIC_FORMS as readonly string[]).includes(base);
}

/**
 * THE QUARTER IS DERIVED, NEVER HARDCODED. A literal QTR3 is right for three
 * months of the year and 404s for the other nine -- caught in the probe's 6b,
 * where a 30-day window run in early October would have reached back across the
 * boundary and read every pre-October day as unreachable.
 */
export function quarterOf(yyyymmdd: string): number {
  return Math.floor((Number(yyyymmdd.slice(4, 6)) - 1) / 3) + 1;
}

export function dailyIndexUrl(yyyymmdd: string): string {
  return `https://www.sec.gov/Archives/edgar/daily-index/${yyyymmdd.slice(0, 4)}/QTR${quarterOf(yyyymmdd)}/master.${yyyymmdd}.idx`;
}

// ── Dates ───────────────────────────────────────────────────────────────────

export function toYyyymmdd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() + days);
  return toYyyymmdd(d);
}

export function isWeekend(yyyymmdd: string): boolean {
  const day = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8))).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * EDGAR dissemination runs to 22:00 ET, so a date's index is not final until
 * after that. The latest date worth asking for is therefore today in Eastern
 * only once today's dissemination has closed, and yesterday otherwise.
 *
 * Asking too early would 403 on a file that simply does not exist yet, and that
 * 403 is indistinguishable from a holiday -- it would increment the failure
 * counter for a reason that is our own scheduling rather than SEC's.
 */
export const DISSEMINATION_CLOSE_MINUTES_ET = 22 * 60;

export function latestProcessableDate(now = new Date()): string {
  const et = getEasternParts(now);
  const etDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replace(/-/g, "");
  return et.minutesOfDay >= DISSEMINATION_CLOSE_MINUTES_ET ? etDate : addDays(etDate, -1);
}

// ── Parsing ─────────────────────────────────────────────────────────────────

export type IndexRow = {
  cik: string;
  company: string;
  form: string;
  filed: string;
  file: string;
  accession: string;
};

/**
 * The accession lives in the File Name, not in a column of its own:
 *   edgar/data/1973239/0001973239-26-000012.txt
 * Extracted by pattern rather than by splitting on "/" and trimming ".txt", so
 * a path shape change shows up as an empty accession rather than as a wrong one.
 */
export function accessionFrom(file: string): string {
  return file.match(/(\d{10}-\d{2}-\d{6})/)?.[1] ?? "";
}

export type ParsedIndex = {
  rows: IndexRow[];
  dataRows: number;
  malformedRows: number;
  columnLayout: string | null;
};

export function parseDailyIndex(body: string): ParsedIndex {
  const lines = body.split("\n");
  const ruleAt = lines.findIndex((l) => /^-{5,}/.test(l.trim()));
  const columnLayout = ruleAt > 0 ? (lines[ruleAt - 1] ?? "").trim() : null;
  const rows: IndexRow[] = [];
  let dataRows = 0;
  let malformedRows = 0;

  for (const line of lines.slice(ruleAt + 1)) {
    if (!line.includes("|")) continue;
    dataRows++;
    const f = line.split("|");
    // Exactly five columns or the row is not used. A short row would shift the
    // form type into the filing date and mislabel a filing rather than failing.
    if (f.length !== 5) {
      malformedRows++;
      continue;
    }
    const cik = f[0].trim();
    if (!/^\d+$/.test(cik)) {
      malformedRows++;
      continue;
    }
    const file = f[4].trim();
    rows.push({
      cik,
      company: f[1].trim(),
      form: f[2].trim(),
      filed: f[3].trim().replace(/-/g, ""),
      file,
      accession: accessionFrom(file),
    });
  }

  return { rows, dataRows, malformedRows, columnLayout };
}

// ── Fetch ───────────────────────────────────────────────────────────────────

export type IndexFetch =
  | { outcome: "parsed"; status: number; ms: number; bytes: number; parsed: ParsedIndex }
  | { outcome: "absent"; status: number; ms: number; bytes: number; bodyHead: string }
  | { outcome: "failed"; status: number | null; ms: number; reason: string; bodyHead?: string };

/**
 * A DAY WITH NO INDEX ANSWERS 403, NOT 404, and the body is
 * `<Error><Code>AccessDenied</Code>` from S3 -- EDGAR's indexes sit in a bucket
 * that does not grant ListBucket, so a missing key reads as AccessDenied by
 * design. Stable behaviour, not a quirk, and the reason the probe's first
 * version filed every public holiday under "www.sec.gov refused us".
 *
 * This job sees ONE file a day and has no window to compare across, so the
 * probe's spread rule cannot be reused. It is re-expressed across TIME by the
 * caller: a single 403 advances the watermark silently, and only CONSECUTIVE
 * 403s alarm. The body shape is the corroborating signal, not the decider.
 */
export function looksLikeMissingIndex(status: number, body: string): boolean {
  if (status !== 403) return false;
  return /AccessDenied/i.test(body) || body.length <= 4096;
}

export async function fetchDailyIndex(
  yyyymmdd: string,
  ua: string,
  timeoutMs = 20000
): Promise<IndexFetch> {
  const url = dailyIndexUrl(yyyymmdd);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "user-agent": ua, "accept-encoding": "gzip, deflate", accept: "text/plain,*/*" },
    });
    const body = await res.text();
    const ms = Date.now() - started;
    if (res.status === 200) {
      return { outcome: "parsed", status: 200, ms, bytes: body.length, parsed: parseDailyIndex(body) };
    }
    if (looksLikeMissingIndex(res.status, body) || res.status === 404) {
      return {
        outcome: "absent",
        status: res.status,
        ms,
        bytes: body.length,
        bodyHead: body.slice(0, 200).replace(/\s+/g, " ").trim(),
      };
    }
    return { outcome: "failed", status: res.status, ms, reason: `HTTP ${res.status}`, bodyHead: body.slice(0, 200) };
  } catch (err) {
    const e = err as Error;
    return {
      outcome: "failed",
      status: null,
      ms: Date.now() - started,
      reason: e?.name === "AbortError" ? `timeout after ${timeoutMs / 1000}s` : `${e?.name}: ${e?.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Intersection ────────────────────────────────────────────────────────────

export type SymbolFiling = {
  symbol: string;
  cik: string;
  form: string;
  filed: string;
  accession: string;
  company: string;
  amendment: boolean;
};

/**
 * Intersect one day's rows against the manifest's CIKs.
 *
 * DEDUPED ON ACCESSION. The same accession can be listed more than once; a
 * filing counted twice would look like two reports.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. 3.4 asks that same-day pairs -- which ARM
 * files routinely -- be resolved by preferring the one whose reportDate is a
 * quarter end. **The daily index has no reportDate column.** Its five columns
 * are CIK, Company Name, Form Type, Date Filed and File Name, and the two
 * members of an ARM pair are genuinely distinct accessions, so dedupe cannot
 * collapse them either. Choosing between them needs `submissions`, which step 2
 * is explicitly forbidden from calling. So both are recorded and the symbol is
 * flagged `ambiguousSameDayFilings` for step 3 to resolve with the data that
 * actually carries the answer. Guessing here -- "take the later accession" --
 * would be an invented rule that is right about half the time and never
 * reviewed again.
 */
export function intersect(rows: IndexRow[], bySymbolCik: Map<string, string>): SymbolFiling[] {
  const seen = new Set<string>();
  const out: SymbolFiling[] = [];
  for (const row of rows) {
    const symbol = bySymbolCik.get(row.cik);
    if (!symbol) continue;
    const key = `${symbol}:${row.accession || row.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      symbol,
      cik: row.cik,
      form: row.form,
      filed: row.filed,
      accession: row.accession,
      company: row.company,
      amendment: isAmendment(row.form),
    });
  }
  return out;
}
