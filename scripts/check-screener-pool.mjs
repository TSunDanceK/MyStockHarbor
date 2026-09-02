// The candidate pool widened, and the two constants that bound it.
//
// WHY. SCREENER_LIMIT was 1000 and the screener answers market-cap-descending,
// so the 1000th row was PATH at $9.66B. That was the real coverage floor, and
// it is why ONDS at $4.37B -- up 171% -- could never enter the universe except
// by being searched or turning up in a mover bucket, which is exactly the stock
// a breakout screener exists to find.
//
// Three things about the change fail quietly:
//
//   * WHICH CONSTANT BINDS. Between the limit and SCREENER_MIN_MARKET_CAP, only
//     one shapes the pool at a time. Probe Q1 found the $300M and $1B calls
//     returned BYTE-IDENTICAL responses at limit 1000 -- the floor has been
//     inert its whole life. The day it stops being inert, nothing says so.
//   * THE POOL AND THE UNIVERSE ARE DIFFERENT SIZES, deliberately. Raising
//     ANALYSIS_UNIVERSE_CAP in the same change would multiply the load on every
//     downstream job at the same moment the candidate set widened, and nobody
//     would know which one moved the needle.
//   * THE WRITE. 3,000 SETs in one Upstash pipeline is a several-hundred-KB
//     POST, and cacheScreenerFundamentals fails open by returning 0 -- so an
//     oversized request writes NOTHING and logs "industry backfill has no free
//     source this cycle", which reads as FMP failing.
//
//   node scripts/check-screener-pool.mjs
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const screener = readCodeOnly("lib/server/screenerFundamentals.ts");
const fundCache = readCodeOnly("lib/server/fundamentalsCache.ts");
const universeSrc = readCodeOnly("lib/server/dynamicUniverseCache.ts");

const limit = Number((screener.match(/SCREENER_LIMIT = (\d+)/) ?? [])[1]);
const floor = Number(
  (screener.match(/SCREENER_MIN_MARKET_CAP = ([0-9_]+)/) ?? [])[1]?.replace(/_/g, "")
);
const analysisCap = Number(
  (universeSrc.match(/ANALYSIS_UNIVERSE_CAP = (\d+)/) ?? [])[1]
);
if (!limit || !floor || !analysisCap) {
  console.error(
    `FAIL: could not read SCREENER_LIMIT (${limit}), SCREENER_MIN_MARKET_CAP ` +
      `(${floor}) or ANALYSIS_UNIVERSE_CAP (${analysisCap}) — this script would ` +
      `otherwise pass by measuring nothing.`
  );
  process.exit(1);
}

// ── 1. The pool is wider than the analysed set ──────────────────────────────
console.log("\n1. The candidate pool widened; the universe did not");

check(
  "the screener returns more candidates than the universe analyses",
  limit > analysisCap,
  `${limit} candidates against an ANALYSIS_UNIVERSE_CAP of ${analysisCap} — a pool ` +
    `no larger than the universe is not a pool, it is the universe with extra steps`
);
check(
  "and the universe cap was NOT raised in the same change",
  analysisCap === 700,
  `${analysisCap} — raising both at once multiplies the load on every downstream ` +
    `job at the same moment the candidate set widens, and nothing afterwards can ` +
    `say which change moved what. 7c is where this number moves.`
);

// ── 2. Which constant actually binds ────────────────────────────────────────
console.log("\n2. The limit bounds the pool; the market-cap floor is a backstop");

// Probe Q1: at limit 1000 the 1000th row was $9.66B; at 3000, with funds
// excluded, the floor lands around $2B. Both are far above the constant, which
// is what makes it inert. This asserts the RELATIONSHIP, not the observation --
// the observation needs FMP, which this sandbox cannot reach.
const PROBE_FLOOR_AT_3000 = 2_000_000_000;
check(
  "the expected coverage floor still sits clear of the configured floor",
  PROBE_FLOOR_AT_3000 > floor * 1.5,
  `~$${PROBE_FLOOR_AT_3000 / 1e9}B observed at limit 3000 against a $${floor / 1e9}B ` +
    `constant — while these are apart the LIMIT decides coverage and the constant ` +
    `is inert; when they converge it has started shaping the universe`
);
check(
  "the run reports the floor it actually got, not just the one configured",
  /observedFloor/.test(screener) &&
    /observedFloor: result\.observedFloor/.test(
      readCodeOnly("app/api/jobs/warm-screener-fundamentals/route.ts")
    ),
  "the screener answers market-cap-descending, so the smallest cap returned IS " +
    "the coverage floor — recording it makes 'has the constant started binding' " +
    "answerable from a run record instead of from reasoning"
);

// ── 3. The write survives 3x the rows ───────────────────────────────────────
console.log("\n3. Three thousand rows do not become one oversized request");

const chunkSize = Number((fundCache.match(/SCREENER_WRITE_CHUNK = (\d+)/) ?? [])[1]);
check(
  "screener rows are written in bounded chunks, not one pipeline",
  chunkSize > 0 && chunkSize < limit,
  chunkSize
    ? `${chunkSize} SETs per request against ${limit} rows = ` +
      `${Math.ceil(limit / chunkSize)} requests — one ${limit}-command pipeline is a ` +
      `several-hundred-KB POST, and this function fails open by writing nothing`
    : "no chunk size found"
);
check(
  "a partial write reports what landed rather than zero",
  // Scoped to the CATCH BLOCK, with a class that CANNOT CROSS A BRACE.
  // `return written.length` is also the happy-path return, so both a file-wide
  // match and a lazy [\s\S]*? pass with the catch still returning 0 — the
  // second ran straight out of the catch and matched the function's own final
  // return. Verified by breaking it (claude/traps/a-regex-over-source-has-no-scope.md).
  /catch \{[^}]*return written\.length;/.test(fundCache),
  "returning 0 after 2,500 rows had already been written would log 'industry " +
    "backfill has no free source this cycle' — which reads as FMP failing, the " +
    "exact absence-vs-failure confusion this module's header documents"
);

console.log(
  failures === 0
    ? "\nAll screener-pool assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
