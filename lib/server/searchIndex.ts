// The symbol search index, without FMP (Relay B, #553 inventory #21, 2026-09-23).
//
// Search used FMP's /stable/search-symbol and /stable/search-name, two metered
// calls per uncached query. This replaces the SOURCE only; the ranking in
// lib/server/symbolSearch.ts (rankResult, POPULAR_SYMBOLS, isDerivativeSymbol,
// the exchange allow-list) is unchanged.
//
// ── READ THIS BEFORE CHANGING HOW THE DIRECTORY IS USED ──────────────────
// symbolSearch.ts records that an earlier version searched these same Nasdaq
// Trader files and had three bugs: a name-based ADS/ADR exclusion (ARM could not
// be found), substring matching inside names ("arm" -> Ph-ARM-aceuticals), and
// fetching both files on every request. None of the three was the source's
// fault, and none is reintroduced here:
//   1. NO NAME-BASED EXCLUSION. Rows are dropped only on the directory's own
//      flags (test issues) and on exchange, never on words in the name.
//   2. NO SUBSTRING MATCHING. Matching is rankResult's symbol / word-prefix
//      tiers, as before.
//   3. NOT PER REQUEST. The files are fetched with the same 24 h fetch cache
//      lib/server/companyNames.ts already uses for them, and the parsed index is
//      memoised per instance.
//
// ── SOURCES, BOTH NON-FMP ────────────────────────────────────────────────
//   PRIMARY   Nasdaq Trader symbol directory (nasdaqlisted.txt + otherlisted.txt),
//             already fetched by the app for company names. It carries every
//             US-listed stock AND ETF (SPY, IWM, VOO...) with its exchange.
//   FALLBACK  data/sec/company-tickers.json (committed, SEC, public domain), so
//             search still answers for operating companies if the directory
//             cannot be reached. It has no ETFs, which is why it is not primary.
//
// PURE FUNCTIONS ARE EXPORTED for scripts/check-search-index.mjs.
import secTickers from "@/data/sec/company-tickers.json";
import { cleanName } from "./companyNames";

export type SymbolRow = {
  symbol: string;
  name: string;
  exchange: string;
};

/**
 * What kind of ETF a row is, or null for anything that is not one.
 *   "geared"  leveraged, inverse or option-income products (2x/3x, -1x, Ultra,
 *             Bear/Bull, covered call, YieldMax...). Real, tradable, and almost
 *             never what a search for a company or an index means -- so they
 *             rank BELOW every operating company and plain ETF that matches
 *             (#553 COWORK #11: ARMA/ARMG and NVDQ/NVDX were outranking the
 *             companies' own listings). Demoted, never dropped.
 *   "plain"   every other ETF (SPY, IWM, QQQ).
 */
export type EtfKind = "plain" | "geared" | null;

/**
 * DEMOTION ONLY, read off the directory's RAW security name and only for rows
 * the directory itself flags ETF=Y -- so an operating company whose name holds
 * one of these words ("Bull Run Inc.") is never touched. This is not the
 * name-based EXCLUSION symbolSearch.ts warns about: nothing is removed.
 */
export const GEARED_ETF_RE =
  /(?:\b\d+(?:\.\d+)?\s?[xX]\b|\bultra(?:pro|short)?\b|\bleveraged\b|\binverse\b|\bshort\b(?!\s*-?\s*(?:term|treasury|duration|maturity|dated|bond))|\bbear\b|\bbull\b|\bdaily target\b|\boption income\b|\bcovered call\b|\byieldmax\b|\bpremium income\b|\boption strategy\b|\bbuffer\b)/i;

export type IndexRow = SymbolRow & {
  etfKind: EtfKind;
  /** Precomputed for rankResult: upper-cased, non-alphanumerics removed. */
  symbolNorm: string;
  nameNorm: string;
  nameWords: string[];
};

const NASDAQ_LISTED = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
const OTHER_LISTED = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";

/** otherlisted.txt's Exchange codes, as the labels search has always shown. */
const OTHER_EXCHANGE: Record<string, string> = {
  A: "AMEX", // NYSE American
  N: "NYSE",
  P: "NYSE ARCA",
  Z: "CBOE", // Cboe BZX
  V: "IEX",
};

export const normalise = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function toIndexRow(row: SymbolRow & { etfKind?: EtfKind }): IndexRow {
  return {
    ...row,
    etfKind: row.etfKind ?? null,
    symbolNorm: normalise(row.symbol),
    nameNorm: normalise(row.name),
    nameWords: row.name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean),
  };
}

/**
 * One directory file into rows, PARSED BY HEADER (the two files do not share a
 * first column name; scripts/lib/nasdaq-directory.mjs records why position is
 * unsafe). `$` in a symbol (the directory's preferred-series marker) becomes
 * `-`, the form symbolSearch's isDerivativeSymbol already demotes; `.` class
 * shares (BRK.B) are kept as the site spells them.
 */
export function parseDirectory(
  text: string,
  file: "nasdaqlisted" | "otherlisted"
): (SymbolRow & { etfKind: EtfKind })[] {
  const lines = text.split(/\r?\n/).filter((l) => l.includes("|"));
  if (lines.length < 2) return [];
  const header = lines[0].split("|").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iSym = col(file === "nasdaqlisted" ? "Symbol" : "ACT Symbol");
  const iName = col("Security Name");
  const iTest = col("Test Issue");
  const iExch = col("Exchange");
  const iEtf = col("ETF");
  if (iSym < 0 || iName < 0) return [];

  const out: (SymbolRow & { etfKind: EtfKind })[] = [];
  for (const line of lines.slice(1)) {
    if (/^File Creation Time/i.test(line)) continue;
    const cols = line.split("|");
    if (iTest >= 0 && (cols[iTest] || "").trim().toUpperCase() === "Y") continue;
    const symbol = (cols[iSym] || "").trim().toUpperCase().replace(/\$/g, "-");
    const name = cleanName(cols[iName] || "");
    if (!symbol || !name || !/^[A-Z][A-Z0-9.\-]*$/.test(symbol)) continue;
    const exchange = file === "nasdaqlisted" ? "NASDAQ" : OTHER_EXCHANGE[(cols[iExch] || "").trim()] ?? "";
    if (!exchange) continue;
    const isEtf = iEtf >= 0 && (cols[iEtf] || "").trim().toUpperCase() === "Y";
    const etfKind: EtfKind = !isEtf ? null : GEARED_ETF_RE.test(cols[iName] || "") ? "geared" : "plain";
    out.push({ symbol, name, exchange, etfKind });
  }
  return out;
}

type SecTickerFile = { fields: string[]; data: [number, string, string, string | null][] };

/**
 * The committed SEC ticker file as rows. SEC spells class shares with a dash
 * (BRK-B); a single-letter class suffix becomes the site's dotted form, and
 * anything longer (a preferred series, CMS-PB) keeps its dash.
 */
export function secRows(file: SecTickerFile): SymbolRow[] {
  const SEC_EXCHANGE: Record<string, string> = { Nasdaq: "NASDAQ", NYSE: "NYSE", CBOE: "CBOE" };
  const out: SymbolRow[] = [];
  for (const [, name, ticker, exchange] of file.data ?? []) {
    const ex = exchange ? SEC_EXCHANGE[exchange] : undefined;
    if (!ex || !ticker || !name) continue;
    const symbol = /^[A-Z]+-[A-Z]$/.test(ticker) ? ticker.replace("-", ".") : ticker.toUpperCase();
    out.push({ symbol, name: name.trim(), exchange: ex });
  }
  return out;
}

/** Directory rows first (they carry ETFs and cleaner names); SEC fills the rest. */
export function buildIndex(directory: (SymbolRow & { etfKind?: EtfKind })[], sec: SymbolRow[]): IndexRow[] {
  const seen = new Set<string>();
  const out: IndexRow[] = [];
  for (const row of [...directory, ...sec]) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    out.push(toIndexRow(row));
  }
  return out;
}

/**
 * The directory's bytes as text. NOT ALWAYS UTF-8 (#553 COWORK #11): a name
 * rendered "MicroSectors -3? Short" because the file's single-byte `×` was
 * read as UTF-8. Strict UTF-8 first; if the bytes are not valid UTF-8, they
 * are Windows-1252, which is a superset of Latin-1 for every printable byte.
 */
export function decodeDirectory(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

async function fetchDirectory(url: string): Promise<string> {
  try {
    // The same 24 h fetch cache companyNames.ts uses for these two files, so
    // the two readers share one fetch per URL per day.
    const res = await fetch(url, { next: { revalidate: 86400 } });
    return res.ok ? decodeDirectory(new Uint8Array(await res.arrayBuffer())) : "";
  } catch {
    return "";
  }
}

let memo: { rows: IndexRow[]; fromDirectory: boolean } | null = null;

/**
 * The index. Memoised per instance once the directory has answered; while it
 * has not, the SEC-only index is served and the directory is retried on the
 * next call rather than being pinned to the fallback for the instance's life.
 */
export async function getSearchIndex(): Promise<IndexRow[]> {
  if (memo?.fromDirectory) return memo.rows;
  const [nasdaq, other] = await Promise.all([fetchDirectory(NASDAQ_LISTED), fetchDirectory(OTHER_LISTED)]);
  const directory = [...parseDirectory(nasdaq, "nasdaqlisted"), ...parseDirectory(other, "otherlisted")];
  const rows = buildIndex(directory, secRows(secTickers as unknown as SecTickerFile));
  memo = { rows, fromDirectory: directory.length > 1000 };
  return rows;
}
