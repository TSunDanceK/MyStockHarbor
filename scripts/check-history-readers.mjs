// Who reads history, and what a background job is allowed to do about a miss.
//
// TWO THINGS FAIL SILENTLY HERE, and both had already happened.
//
//   A READER WITH NO CALLER TAG REPORTS AS NOBODY. The meter's whole purpose is
//   to answer "who reads history"; a call site that omits its tag is folded into
//   `unattributed`, which looks like a small residue rather than the reader you
//   were hunting. #418 shipped with TWELVE such readers, because it metered the
//   two BULK paths and the single-symbol path was invisible -- the three plays
//   builders read ~700 symbols each ONE AT A TIME and reported zero bytes.
//   The call-site list here is DERIVED BY SCANNING, never hand-typed: a
//   hand-typed list is how the thirteenth reader gets missed.
//
//   A BACKGROUND JOB THAT CAN TRIGGER A BUILD. getPickersData() reads a cached
//   payload OR builds one, and a build reads every symbol's history out of Redis
//   -- ~80 MB. warmTargets called it to obtain a list of tickers. Measured in
//   production overnight on 2026-09-04, market shut, no human traffic:
//   warm-price-pool, a FIVE-MINUTE cron, rebuilt the entire picker universe at
//   01:00, 02:05 and 03:10 UTC and then returned `skipped: market-closed`.
//   Nothing about that looks wrong in any log except the one line that says
//   "build complete", and nothing was asserting on it.
//
//   node scripts/check-history-readers.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── 1. Every history reader says who it is ──────────────────────────────────
console.log("\n1. Every history reader is attributed");

// DERIVED BY SCANNING lib/ and app/, not compared against a second list. The
// four entry points are read out of historyCache's own exports so a fifth one
// added later is picked up rather than silently unscanned.
const historySrc = readCodeOnly("lib/server/historyCache.ts");
const ENTRY_POINTS = [
  ...historySrc.matchAll(
    /export async function (getDailyHistory|getDailyHistoryBulk|getCachedDailyHistory|getCachedDailyHistoryBulk)\(/g
  ),
].map((m) => m[1]);
check(
  "the history entry points were found in historyCache",
  ENTRY_POINTS.length === 4,
  `${ENTRY_POINTS.join(", ") || "NONE"} — a scan that finds nothing passes trivially`
);

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) files.push(path.relative(ROOT, full));
  }
};
walk(path.join(ROOT, "lib"));
walk(path.join(ROOT, "app"));

// STRIPPED, NOT RAW. The first version of this scan matched historyCache's own
// prose -- the header explains `getDailyHistory()` in three separate comments --
// and reported the module as an unattributed reader of itself.
// claude/traps/grep-finds-the-comment-not-the-code.md, in the check written to
// prevent it.
const callSites = [];
for (const rel of files) {
  if (rel === "lib/server/historyCache.ts") continue; // its own internals
  let src;
  try {
    src = readCodeOnly(rel, { minRetainedFraction: 0.005 });
  } catch {
    continue;
  }
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // AST, NOT REGEX. A call spanning several lines -- which four of these do --
  // is invisible to a line-oriented match, and that is precisely the shape a
  // reader takes once it has options.
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : null;
      if (name && ENTRY_POINTS.includes(name)) {
        callSites.push({
          file: rel,
          name,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          text: node.getText(sf),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

check(
  "the scan found history call sites to check",
  callSites.length >= 12,
  `${callSites.length} across lib/ and app/ — the reader count is the point, and a ` +
    `scan returning few would pass by finding nothing`
);

const unattributed = callSites.filter((site) => !/caller\s*:/.test(site.text) && !/,\s*"[a-z0-9-]+"\s*\)$/.test(site.text));
check(
  "every history call site names its caller",
  unattributed.length === 0,
  unattributed.length
    ? `unattributed: ${unattributed.map((s) => `${s.file}:${s.line} ${s.name}`).join(", ")}`
    : `all ${callSites.length} attributed — an unlabelled reader is folded into ` +
      `"unattributed", which reads as a small residue rather than as the reader ` +
      `you were looking for`
);

// The tags must be DISTINCT enough to rank. Three readers all called "page" is
// a breakdown that does not break anything down.
const tags = new Set();
for (const site of callSites) {
  const m = site.text.match(/caller\s*:\s*"([a-z0-9-]+)"/) ?? site.text.match(/,\s*"([a-z0-9-]+)"\s*\)$/);
  if (m) tags.add(m[1]);
}
check(
  "the callers are distinguishable from one another",
  tags.size >= 10,
  `${tags.size} distinct tags: ${[...tags].sort().join(", ")}`
);

// ── 2. A background job may not become the thing that rebuilds the site ─────
console.log("\n2. No cron path can trigger a full picker build");

const warm = readCodeOnly("lib/server/warmTargets.ts");
const builder = readCodeOnly("lib/server/pickersBuilder.ts");

check(
  "warmTargets reads the payload through the build-free reader",
  /await readPickersSymbolsIfCached\(\)/.test(warm),
  "getPickersData() BUILDS on a payload miss — ~80 MB of history reads — and a " +
    "five-minute cron was doing that hourly to look up a list of tickers"
);
check(
  "readPickersSymbolsIfCached cannot build",
  /export async function readPickersSymbolsIfCached\(\)/.test(builder) &&
    !/readPickersSymbolsIfCached[\s\S]{0,900}?buildPickersPayload/.test(builder),
  "a reader whose miss path builds is the defect with an extra name"
);
check(
  "it does not re-attach the chart series either",
  !/readPickersSymbolsIfCached[\s\S]{0,900}?readPickerChartsBulk/.test(builder),
  "a symbol list does not need ~11 KB a symbol of chart points — ~1.5 MB " +
    "instead of ~9.4"
);
// ANCHORED ON THE CALL STATEMENT, NOT ON `readFallbackTargets()`.
//
// Calibration caught this one: the bare name-plus-parens also matches the
// DECLARATION (`async function readFallbackTargets(): Promise<...>` contains it
// as a substring), which sits near the top of the file and is therefore always
// before the build. Moving the fallback below the build left the assertion
// green. Same family as the regexes that matched past the block being asserted.
const fallbackCallIdx = warm.indexOf("const fallback = await readFallbackTargets();");
const buildCallIdx = warm.indexOf("const payload = await getPickersData(base);");
check(
  "a payload miss falls back to the last good list rather than building",
  fallbackCallIdx !== -1 && buildCallIdx !== -1 && fallbackCallIdx < buildCallIdx,
  `fallback read at ${fallbackCallIdx}, build at ${buildCallIdx} — the fallback ` +
    `is consulted BEFORE the build, or it is decoration`
);
check(
  "the fallback and the fresh key are written together",
  /p\.set\(WARM_TARGETS_KEY,[\s\S]{0,200}p\.set\(WARM_TARGETS_FALLBACK_KEY,/.test(warm),
  "written apart, the fallback could age into a list nothing ever refreshed"
);
// THE COLD START IS DELIBERATE AND STAYS. A new deploy against an empty
// namespace has no payload and no fallback, and warm jobs that never start are
// a silent site-wide freshness failure rather than a bill.
check(
  "a genuine cold start can still build, and says so",
  /cold start -- no cached payload and no fallback list, building/.test(warm) &&
    /await getPickersData\(base\)/.test(warm),
  "removing the last resort would trade a bill for warm jobs that never start"
);

// ── 3. The gate comes before the expensive part ─────────────────────────────
console.log("\n3. warm-price-pool checks the market before deriving targets");

const pool = readCodeOnly("app/api/jobs/warm-price-pool/route.ts");
const gateIdx = pool.indexOf("if (!isActiveMarketWindow())");
const targetsIdx = pool.indexOf("await getWarmTargetSymbols(base)");
check(
  "the market gate is BEFORE getWarmTargetSymbols",
  gateIdx !== -1 && targetsIdx !== -1 && gateIdx < targetsIdx,
  `gate at ${gateIdx}, targets at ${targetsIdx} — the window is shut ~15 hours a ` +
    `day plus weekends, and this job runs every 5 minutes; deriving first meant ` +
    `over half its 288 daily runs did their most expensive work for a run that ` +
    `then skipped`
);
check(
  "it gates on the shared predicate, not a second copy of the hours",
  /from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/server\/marketHours"/.test(pool) &&
    !/REGULAR_OPEN_MINUTES_ET|9 \* 60 \+ 30/.test(pool),
  "two answers to 'is the market open' is claude/traps/two-validators-for-one-value.md, " +
    "which /api/history already paid for once"
);
check(
  "the early skip is distinguishable from the old one on the record",
  /targetsSkipped: true,/.test(pool),
  "the previous market-closed record was written AFTER a full derivation; " +
    "without a flag the two are the same line and the saving is invisible"
);
// RELEASING THE LOCK TWICE IS WORSE THAN NOT RELEASING IT. The `finally` owns
// it; a second release can delete a token a LATER run has already taken.
const earlyReturn = pool.slice(gateIdx, pool.indexOf("return NextResponse.json", gateIdx));
check(
  "the early return does not release the lock the finally owns",
  gateIdx !== -1 && !/releaseLock/.test(earlyReturn),
  "a double release can delete a token a later run already holds"
);

console.log(
  failures === 0
    ? "\nAll history-reader assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
