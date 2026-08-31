// Proves the incremental history fetch cannot silently corrupt a price series.
//
// WHY THIS EXISTS. Until 2026-08-31 every history refresh re-downloaded the
// whole series -- ~184 KB per symbol to learn one closing price -- which put the
// FMP account at 97.8% of a 20 GB cap whose penalty is suspension. The fix is to
// ask only for bars at or after the newest one already held. See
// claude/fmp-history-payload-audit-2026-08-30.md.
//
// THE FAILURE THAT FIX INTRODUCES, AND WHAT THIS GUARDS. Appending blindly is
// only correct while the old bars are unchanged. A split or adjustment rewrites
// every close before its effective date, so a 4:1 split appended naively stitches
// pre-split bars onto post-split bars and fabricates a 75% crash that never
// happened. Nothing throws. Nothing fails a build. The chart just shows a cliff
// and every pattern builder treats it as real price action -- silent and wrong,
// which is a worse failure than the bandwidth problem was.
//
// So the overlap comparison is a correctness guard, not an optimisation, and it
// is the thing under test here.
//
//   node scripts/check-history-merge.mjs
//
// Runs the REAL lib/server/historyMerge.ts, not a copy of its logic
// (claude/traps/two-validators-for-one-value.md).
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/historyMerge.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// historyMerge.ts is pure and imports nothing, so it needs no stubbing at all --
// which is most of the reason the logic was put there rather than left inline in
// historyCache.ts, where Redis and Next are unavoidable.
const source = fs.readFileSync(SRC, "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;

const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const { shiftIsoDate, toIsoUtcDate, overlapVerdict, mergeDailyPoints } = mod;

const bar = (date, close) => ({ date, close, open: close, high: close, low: close, volume: 1000 });

console.log("shiftIsoDate");
check("subtracts days", shiftIsoDate("2026-08-31", -7) === "2026-08-24");
check("crosses a month boundary", shiftIsoDate("2026-09-03", -7) === "2026-08-27");
check("crosses a year boundary", shiftIsoDate("2026-01-02", -7) === "2025-12-26");
check("handles leap day", shiftIsoDate("2028-03-01", -1) === "2028-02-29");
check("rejects a malformed date", shiftIsoDate("not-a-date", -7) === null);
check("toIsoUtcDate returns YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(toIsoUtcDate(Date.now())));

console.log("\noverlapVerdict");
const stored = [bar("2026-08-25", 100), bar("2026-08-26", 101), bar("2026-08-27", 102)];

check(
  "unchanged overlap agrees",
  overlapVerdict(stored, [bar("2026-08-26", 101), bar("2026-08-27", 102), bar("2026-08-28", 103)]) ===
    "agrees"
);

// The case the whole guard exists for.
check(
  "4:1 split is caught as restated",
  overlapVerdict(stored, [bar("2026-08-26", 25.25), bar("2026-08-27", 25.5), bar("2026-08-28", 26)]) ===
    "restated"
);
check(
  "2:1 split is caught as restated",
  overlapVerdict(stored, [bar("2026-08-27", 51), bar("2026-08-28", 51.5)]) === "restated"
);

check(
  "no shared dates is unverifiable, NOT agreement",
  overlapVerdict(stored, [bar("2026-09-10", 110), bar("2026-09-11", 111)]) === "unverifiable"
);
check("empty fetch is unverifiable", overlapVerdict(stored, []) === "unverifiable");

// Tolerance boundaries: rounding noise must not trigger a full refetch, but
// anything resembling a corporate action must.
check(
  "0.4% drift tolerated (rounding, not a restatement)",
  overlapVerdict([bar("2026-08-27", 100)], [bar("2026-08-27", 100.4)]) === "agrees"
);
check(
  "0.6% drift flagged",
  overlapVerdict([bar("2026-08-27", 100)], [bar("2026-08-27", 100.6)]) === "restated"
);
check(
  "a zero stored close is skipped, not divided by",
  overlapVerdict([bar("2026-08-27", 0)], [bar("2026-08-27", 50)]) === "unverifiable"
);

console.log("\nmergeDailyPoints");
const merged = mergeDailyPoints(stored, [bar("2026-08-27", 102), bar("2026-08-28", 103)], 1400);
check("appends only genuinely new bars", merged.length === 4, `got ${merged.length}`);
check("stays ascending by date", merged.every((p, i) => i === 0 || merged[i - 1].date < p.date));
check("no duplicate dates", new Set(merged.map((p) => p.date)).size === merged.length);
check("newest bar is the appended one", merged[merged.length - 1].date === "2026-08-28");

check(
  "fetched wins on a shared date",
  mergeDailyPoints([bar("2026-08-27", 102)], [bar("2026-08-27", 555)], 1400)[0].close === 555
);

// Depth must survive the change -- the 260-week macro S/R pass and the 1300-day
// pattern builders read this array, and quietly shortening it would degrade
// every signal on the site without erroring.
const long = Array.from({ length: 1188 }, (_, i) =>
  bar(shiftIsoDate("2026-08-27", -(1187 - i)), 100 + i)
);
const grown = mergeDailyPoints(long, [bar("2026-08-28", 9999)], 1400);
check("1,188 stored + 1 new keeps all 1,189 under a 1400 cap", grown.length === 1189, `got ${grown.length}`);
check("depth is preserved, not truncated to the fetched window", grown.length > 1000);

const capped = mergeDailyPoints(long, [bar("2026-08-28", 9999)], 1000);
check("cap trims from the OLD end", capped.length === 1000 && capped[capped.length - 1].close === 9999);

console.log(`\n${failures === 0 ? "OK" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
