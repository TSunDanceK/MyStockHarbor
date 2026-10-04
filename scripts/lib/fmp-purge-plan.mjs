// WHAT THE FMP PURGE DELETES (#553 COWORK #136; CODE-B #125, CODE-A #147 on #552).
//
// Pure: a key name in, the group it belongs to (or null) out. The runner,
// scripts/fmp-purge.mjs, does the Redis work; scripts/check-fmp-purge.mjs
// holds the rules and mutants.
//
// DEFAULT GROUPS hold FMP-derived data that nothing needs after the cancel:
// either no live reader, or a reader that rebuilds from SEC / Tiingo when the
// key is gone. Most would lapse on their own within 7 days; the ones with no
// TTL would not.
//
// OPT-IN GROUPS are reported in the dry run but deleted only with their own
// flag, because deleting them changes something a reader sees:
//   --pool-figures       msh:price-pool:v1 is NOT deleted (its field names are
//                        the universe's fallback source: tiingoUniverse,
//                        jobs.ts, warm-screener-fundamentals all HKEYS it).
//                        The flag nulls the FMP figures in each row instead,
//                        keeping the field and its bookkeeping.
//   --market-state       msh:market:state is a universe input to the pickers,
//                        plays, bull-flag and triangle builders and warmTargets.
//   --insight-snapshots  FMP-era insight-snapshot:<slug> records are the frozen
//                        setup each article was written against; deleted, the
//                        next render builds a Tiingo record from today's bars.
//                        Tiingo-path records (source "tiingo") are never touched.
//   --meters             the FMP usage meters (msh:fmp-bytes:v1, msh:fmp-calls:v1):
//                        no FMP data, only the call history /cache-health shows.
//
// NEVER: anything under msh:tiingo: (scripts/tiingo-purge.mjs owns that), and
// msh:pickers:quote-offset:v1 (a progress counter, no FMP data).

/** owner: whose area (A or B). refills: a live writer rebuilds it from SEC/Tiingo, so keys may reappear. */
export const DEFAULT_GROUPS = [
  // B (CODE-B #125)
  { id: "pool-session-health", owner: "B", exact: "msh:pricepool:session-health:v1" },
  { id: "pickers-fundamentals", owner: "B", prefix: "msh:pickers:fundamentals:v1:" },
  { id: "pickers-screener-fundamentals", owner: "B", prefix: "msh:pickers:screener-fundamentals:v1:" },
  { id: "stockdata", owner: "B", prefix: "msh:stockdata:v1:" },
  { id: "history-v7", owner: "B", prefix: "msh:history:v7:" },
  { id: "history-newest-bar", owner: "B", exact: "msh:history:newest-bar:v1", noTtl: true },
  { id: "quote", owner: "B", prefix: "msh:quote:v1:" },
  { id: "benchmarks", owner: "B", prefix: "msh:benchmarks:", refills: true },
  { id: "feed-ipo-fmp", owner: "B", exact: "msh:feed:ipo:all:fmp" },
  { id: "feed-index-additions", owner: "B", exact: "msh:feed:index:additions" },
  // A (CODE-A #147, #552)
  { id: "pickers-earnings", owner: "A", prefix: "msh:pickers:earnings:v1:", note: "rows, :queue (no TTL), :due:, :lock, :enqueue-guard" },
  { id: "earnings-quoted-symbol", owner: "A", prefix: "msh:earnings-quoted-symbol:v1" },
  { id: "earnings-day-items-v2", owner: "A", prefix: "msh:earnings-day-items:v2", refills: true },
  { id: "earnings-day-complete-v4", owner: "A", prefix: "msh:earnings-day-complete:v4", refills: true },
  { id: "reference-earnings-calendar", owner: "A", prefix: "msh:reference:v1:earnings-calendar" },
  { id: "earnings-schedule", owner: "A", prefix: "msh:earnings-schedule:v1" },
  { id: "earnings-quote-calls", owner: "A", prefix: "msh:earnings-quote-calls:v1" },
  { id: "earnings-day-items-v1 (dead)", owner: "A", prefix: "msh:earnings-day-items:v1" },
  { id: "earnings-day-complete-v3 (dead)", owner: "A", prefix: "msh:earnings-day-complete:v3" },
  { id: "earnings-day-complete-v2 (dead)", owner: "A", prefix: "msh:earnings-day-complete:v2" },
];

export const OPT_IN_GROUPS = [
  { id: "pool-figures", flag: "--pool-figures", owner: "B", exact: "msh:price-pool:v1", action: "strip", noTtl: true },
  { id: "market-state", flag: "--market-state", owner: "B", exact: "msh:market:state", noTtl: true },
  { id: "insight-snapshots-fmp", flag: "--insight-snapshots", owner: "B", prefix: "insight-snapshot:", action: "fmp-era-only", noTtl: true },
  { id: "fmp-meters", flag: "--meters", owner: "B", prefix: "msh:fmp-", match: (k) => k.startsWith("msh:fmp-bytes:v1") || k.startsWith("msh:fmp-calls:v1") },
];

/** Keys the purge must never touch, whatever a group says. */
export const NEVER = [(k) => k.startsWith("msh:tiingo:"), (k) => k === "msh:pickers:quote-offset:v1"];

const hits = (g, key) => (g.match ? g.match(key) : g.exact ? key === g.exact : key.startsWith(g.prefix));

/** The group a key belongs to (default first, then opt-in), or null. */
export function classify(key) {
  if (typeof key !== "string" || NEVER.some((f) => f(key))) return null;
  for (const g of DEFAULT_GROUPS) if (hits(g, key)) return g;
  for (const g of OPT_IN_GROUPS) if (hits(g, key)) return g;
  return null;
}

/** The figures an FMP pool row loses under --pool-figures; ts, peTs and the fail bookkeeping stay. */
export const POOL_FIGURES = ["price", "changePct", "volume", "open", "dayHigh", "dayLow", "marketCap", "pe"];

/** Pure: a pool row with its FMP figures nulled, or null when it has none left to strip. */
export function strippedPoolRow(row) {
  if (!row || typeof row !== "object" || row.source === "tiingo") return null;
  if (!POOL_FIGURES.some((f) => row[f] !== null && row[f] !== undefined)) return null;
  const out = { ...row };
  for (const f of POOL_FIGURES) out[f] = null;
  return out;
}

/** Pure: an insight snapshot is FMP-era unless it is a Tiingo-path record. */
export const isFmpEraSnapshot = (raw) => !!raw && typeof raw === "object" && raw.source !== "tiingo";
