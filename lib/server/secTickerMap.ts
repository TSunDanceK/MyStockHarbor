// symbol -> CIK, from SEC's own ticker file, committed as a static asset.
//
// WHY A COMMITTED FILE RATHER THAN A FETCH. The endpoint works -- measured
// 2026-09-13 from iad1: 200, 798 KB, 10,426 tickers, all five probe symbols
// resolved (the earlier 403 was the undeclared-agent block, not a host block).
// It is committed anyway for two reasons the brief names: it removes a runtime
// dependency from the seed path, and it is what lets an unknown ticker 404
// BEFORE any network call, which is what bounds cold-fetch exposure at 10,426
// requests ever rather than at whatever a scraper asks for.
//
// THE FILE IS NOT IN THE TREE YET AND THIS MODULE SAYS SO RATHER THAN GUESSING.
// The agent sandbox is refused www.sec.gov with 403 CONNECT, so this session
// could not download it, and inventing 10,426 ticker->CIK pairs would be the
// worst possible failure here: every one would look plausible and route
// companyfacts requests at the wrong company. Run
// `node scripts/fetch-company-tickers.mjs` from anywhere with network access
// and commit the result.
//
// Absence is reported, never defaulted: `present:false` with `count:0` means
// the manifest seeds with null CIKs and the daily index matches nothing, and
// every caller surfaces that as its own outcome instead of as "no filings".

import fs from "node:fs";
import path from "node:path";

export const TICKER_FILE = "data/sec/company-tickers.json";

export type TickerMap = {
  present: boolean;
  count: number;
  map: Map<string, string>;
  source: string;
  error: string | null;
};

type TickerRow = { cik_str?: number | string; ticker?: string; title?: string };

let cached: TickerMap | null = null;

/** Ten digits, zero-padded -- the spelling every SEC URL wants. */
export function padCik(value: number | string): string {
  return String(value).replace(/\D/g, "").padStart(10, "0");
}

export function parseTickerFile(text: string): Map<string, string> {
  const parsed = JSON.parse(text) as Record<string, TickerRow>;
  const map = new Map<string, string>();
  for (const row of Object.values(parsed)) {
    if (!row?.ticker || row.cik_str === undefined) continue;
    const symbol = String(row.ticker).trim().toUpperCase();
    if (!symbol) continue;
    // FIRST WINS. Dual-class names appear as separate rows sharing one CIK, so
    // order cannot change the answer -- scripts/sec-fundamentals-ingest.mjs
    // already establishes this and the same rule is kept here deliberately.
    if (!map.has(symbol)) map.set(symbol, padCik(row.cik_str));
  }
  return map;
}

export function loadTickerMap(force = false): TickerMap {
  if (cached && !force) return cached;
  const file = path.join(process.cwd(), TICKER_FILE);
  try {
    const text = fs.readFileSync(file, "utf8");
    const map = parseTickerFile(text);
    cached = { present: true, count: map.size, map, source: TICKER_FILE, error: null };
  } catch (err) {
    cached = {
      present: false,
      count: 0,
      map: new Map(),
      source: TICKER_FILE,
      error: (err as Error)?.message ?? String(err),
    };
  }
  return cached;
}
