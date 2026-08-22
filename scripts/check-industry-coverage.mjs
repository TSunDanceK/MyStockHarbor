// Proves the profile-fetch selection asks "does this row have an INDUSTRY",
// not "does a row EXIST".
//
// The bug this locks down: warmFundamentals chose which symbols to send to the
// FMP profile endpoint with
//
//     !cachedProfiles.has(s) && !screenerFund.has(s)
//
// `ScreenerFundamentalsRow.industry` is `string | null`, and
// cacheScreenerFundamentals writes a row whenever `row.symbol` is truthy, so a
// symbol whose screener row carried a null industry counted as covered and was
// never sent to the one call that could have supplied it. The screener call
// refreshes that row on every rebuild, so the exclusion renewed itself
// indefinitely and re-running the cron could never clear it.
//
// It was invisible because the affected pages select ON industry/sector --
// /semiconductor-stocks (industry === "Semiconductors") and /cheap-tech-stocks
// (sector === "Technology"). An affected company was not a row with a dash. It
// was not on the page.
//
//   node scripts/check-industry-coverage.mjs
//
// Like scripts/check-orderby.mjs, this does NOT test a copy: it extracts the
// real predicate from lib/server/fundamentalsCache.ts by AST and runs that, so
// it drifts with the source rather than away from it
// (claude/traps/two-validators-for-one-value.md).
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/fundamentalsCache.ts");
const source = fs.readFileSync(SRC, "utf8");
const sf = ts.createSourceFile(SRC, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ------------------------------------------------- 1. the old form is gone
// Comment lines are stripped first. The fix's own explanation quotes the buggy
// expression verbatim, and matching that would report the bug as still present
// -- claude/traps/grep-finds-the-comment-not-the-code.md, which this repo has
// paid for more than once.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

console.log("\n=== 1. The membership-not-content test is gone from the code ===");
check(
  "no `screenerFund.has(` in live code",
  !/screenerFund\.has\s*\(/.test(code),
  /screenerFund\.has\s*\(/.test(source) ? "(still present in a COMMENT, which is fine)" : ""
);
check("no `cachedProfiles.has(` in live code", !/cachedProfiles\.has\s*\(/.test(code));

// ------------------------------------------------- 2. extract the predicate
let arrowSrc = null;
const visit = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(sf) === "needsIndustry" &&
    node.initializer &&
    ts.isCallExpression(node.initializer) &&
    node.initializer.arguments.length === 1
  ) {
    arrowSrc = node.initializer.arguments[0].getText(sf);
  }
  ts.forEachChild(node, visit);
};
visit(sf);

if (!arrowSrc) {
  console.error("\nFAIL: could not find the `needsIndustry` filter predicate in lib/server/fundamentalsCache.ts");
  console.error("It may have been renamed or restructured. This script is now measuring nothing.");
  process.exit(1);
}
console.log(`\n=== 2. Predicate under test (read from source) ===\n\n    ${arrowSrc.replace(/\s+/g, " ")}\n`);

const js = ts.transpileModule(`export const pred = (cachedProfiles, screenerFund) => (${arrowSrc});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const { pred } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

// ------------------------------------------------- 3. the six real cases
// GFS/TSEM/ALAB/MTSI are the symbols observed missing from /semiconductor-stocks.
const CASES = [
  { sym: "GFS", profile: null, screener: { industry: null }, miss: true, why: "screener row exists, industry null — THE BUG" },
  { sym: "TSEM", profile: null, screener: { industry: null }, miss: true, why: "same" },
  { sym: "ALAB", profile: null, screener: { industry: null }, miss: true, why: "same" },
  { sym: "MTSI", profile: null, screener: { industry: null }, miss: true, why: "same" },
  { sym: "NVDA", profile: null, screener: { industry: "Semiconductors" }, miss: false, why: "screener has it — free, skip" },
  { sym: "INTC", profile: { industry: "Semiconductors" }, screener: null, miss: false, why: "profile has it — skip" },
  { sym: "NEWCO", profile: null, screener: null, miss: true, why: "nothing anywhere — always was a miss" },
  { sym: "SPY", profile: { industry: null }, screener: null, miss: true, why: "cached profile, industry null" },
  { sym: "AMD", profile: { industry: null }, screener: { industry: "Semiconductors" }, miss: false, why: "one source has it — skip" },
];

const cachedProfiles = new Map();
const screenerFund = new Map();
for (const c of CASES) {
  if (c.profile) cachedProfiles.set(c.sym, { ...c.profile, sector: null, marketCap: null });
  if (c.screener) screenerFund.set(c.sym, { symbol: c.sym, ...c.screener, sector: null, marketCap: null });
}

console.log("=== 3. Selection, per case ===\n");
const p = pred(cachedProfiles, screenerFund);
console.log("    symbol  profile.industry  screener.industry  selected  expected");
for (const c of CASES) {
  const got = Boolean(p(c.sym));
  const ok = got === c.miss;
  if (!ok) failures++;
  console.log(
    `    ${c.sym.padEnd(7)} ${String(c.profile ? (c.profile.industry ?? "null") : "—").padEnd(17)} ` +
      `${String(c.screener ? (c.screener.industry ?? "null") : "—").padEnd(18)} ` +
      `${String(got).padEnd(9)} ${String(c.miss).padEnd(9)} ${ok ? "" : "  <-- MISMATCH"}`
  );
}
console.log();
for (const c of CASES) check(`${c.sym}: ${c.why}`, Boolean(p(c.sym)) === c.miss);

// ------------------------------------------------- 4. the old predicate, for contrast
console.log("\n=== 4. CONTRAST: what the old predicate selected on the same universe ===\n");
const oldPred = (s) => !cachedProfiles.has(s) && !screenerFund.has(s);
const oldSel = CASES.filter((c) => oldPred(c.sym)).map((c) => c.sym);
const newSel = CASES.filter((c) => p(c.sym)).map((c) => c.sym);
console.log(`    old: ${oldSel.join(", ") || "(none)"}`);
console.log(`    new: ${newSel.join(", ") || "(none)"}\n`);
const rescued = newSel.filter((s) => !oldSel.includes(s));
check(
  "the four observed-missing semiconductor symbols were excluded by the old form",
  ["GFS", "TSEM", "ALAB", "MTSI"].every((s) => !oldSel.includes(s))
);
check("...and are selected by the new form", ["GFS", "TSEM", "ALAB", "MTSI"].every((s) => newSel.includes(s)));
check("no symbol that already has an industry is fetched", !newSel.some((s) => ["NVDA", "INTC", "AMD"].includes(s)));
console.log(`\n    rescued by the fix: ${rescued.join(", ")}`);

// ------------------------------------------------- 5. deferral, not exclusion
console.log("\n=== 5. The empty-marker DEFERS, it does not exclude ===\n");
const marked = new Set(["SPY"]);
const afterDefer = newSel.filter((s) => !marked.has(s));
check("a marked symbol is skipped this run", !afterDefer.includes("SPY"));
check("...but is still selected by the predicate, so it returns when the mark expires", newSel.includes("SPY"));
check("marking never touches a symbol that has an industry", !marked.has("NVDA") && !marked.has("AMD"));

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
