// Prove check-due-strip-state can FAIL. A suite that passes against a broken
// module is testing nothing, and the specific thing at risk here is subtle:
// every mutant below still returns a valid state object and still renders a
// plausible page. None of them throw. The only thing separating them from
// correct behaviour is which sentence a reader is shown.
//
//   node scripts/mutate-due-strip-state.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "lib/server/dueStripState.ts");
const CHECK = "scripts/check-due-strip-state.mjs";

const dirty = execFileSync("git", ["status", "--porcelain", SRC, CHECK], { encoding: "utf8" }).trim();
if (dirty) {
  console.error("FATAL: refusing to run with uncommitted changes to the files this mutates:");
  console.error(dirty);
  console.error("\nThis rewrites tracked files in place and restores them with `git checkout --`,");
  console.error("which would DESTROY that work. Commit or stash first.");
  process.exit(2);
}

const ORIGINAL = fs.readFileSync(SRC, "utf8");

const MUTANTS = [
  ["S1", "the failed-read guard removed (a failed read reads as an empty one)",
    'if (!inputs.manifestRead) return { kind: "unavailable", reason: "manifest-unread" };',
    ""],
  ["S2", "the zero-denominator guard removed (0/0 = NaN falls through the floor)",
    'if (inputs.universeSize <= 0 || inputs.withResultsDate <= 0) {\n    return { kind: "unavailable", reason: "no-results-dates" };\n  }',
    ""],
  ["S3", "the coverage floor removed (any coverage may claim the market is quiet)",
    'if (coverage < MIN_COVERAGE_TO_CLAIM_EMPTY) {\n    return { kind: "unavailable", reason: "no-results-dates" };\n  }',
    ""],
  ["S4", "the floor lowered to zero (present but inert)",
    "export const MIN_COVERAGE_TO_CLAIM_EMPTY = 0.5;",
    "export const MIN_COVERAGE_TO_CLAIM_EMPTY = 0;"],
  ["S5", "the existential claim gated behind the floor (a real list suppressed)",
    'if (inputs.entries.length > 0) return { kind: "listed", entries: inputs.entries, coverage };\n\n  if (coverage < MIN_COVERAGE_TO_CLAIM_EMPTY) {\n    return { kind: "unavailable", reason: "no-results-dates" };\n  }',
    'if (coverage < MIN_COVERAGE_TO_CLAIM_EMPTY) {\n    return { kind: "unavailable", reason: "no-results-dates" };\n  }\n\n  if (inputs.entries.length > 0) return { kind: "listed", entries: inputs.entries, coverage };'],
  ["C1", "the intro reverted to forecast phrasing",
    '"This is a record of what has been filed to date, not a forecast of future filing dates."',
    '"Shows when each company is expected to report its next results."'],
  ["C2", "the row label reverted to a forecast",
    "return `Period ended ${entry.periodEnd} · results have not yet been filed · ${since} outstanding`;",
    "return `Period ended ${entry.periodEnd} · will report shortly · ${since} outstanding`;"],
  ["C3", "the unavailable state reworded as a quiet market (the lie this module exists to stop)",
    'export const DUE_STRIP_UNAVAILABLE =\n  "Outstanding results cannot be listed right now. This page reads results dates from " +\n  "companies\' own filings, and that record is not yet populated — so this is a gap on " +\n  "our side, not a quiet market.";',
    'export const DUE_STRIP_UNAVAILABLE =\n  "No companies in this list currently have results outstanding.";'],
];

let caught = 0;
const survivors = [];

for (const [id, label, from, to] of MUTANTS) {
  if (!ORIGINAL.includes(from)) {
    console.log(`  SKIPPED   ${id}  ${label}`);
    console.log(`             the mutation target is not in the source — the mutant is stale, which is`);
    console.log(`             NOT the same as caught and must not be counted as one.`);
    survivors.push(`${id} (stale target)`);
    continue;
  }
  fs.writeFileSync(SRC, ORIGINAL.replace(from, to));
  let failed = false;
  let detail = "";
  try {
    execFileSync("node", [CHECK], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    failed = true;
    detail = String(e.stdout ?? "").split("\n").filter((l) => l.includes("FAIL")).slice(0, 2)
      .map((l) => l.trim()).join(" | ");
  }
  if (failed) {
    caught++;
    console.log(`  CAUGHT    ${id}  ${label}`);
    if (detail) console.log(`             ${detail}`);
  } else {
    survivors.push(`${id} ${label}`);
    console.log(`  SURVIVED  ${id}  ${label}`);
    console.log(`             the suite passed against this. It is not covered.`);
  }
}

fs.writeFileSync(SRC, ORIGINAL);
const restored = execFileSync("git", ["status", "--porcelain", SRC], { encoding: "utf8" }).trim();
console.log(`\n  ${caught}/${MUTANTS.length} mutants caught`);
console.log(restored ? `  ** TREE NOT RESTORED: ${restored}` : "  working tree restored and verified clean");

if (survivors.length) {
  console.log("\n  UNCOVERED, by name:");
  for (const s of survivors) console.log(`    ${s}`);
}

// ── THE BRIEF'S MUTANTS ARE A SEPARATE DENOMINATOR ────────────────────────
// This file covers stage 2c's own rule. It does not touch the ten the brief
// defines, and printing that here stops a green run from reading as a green
// brief -- the standing rule for this build.
console.log(`
  The brief's ten mutants are NOT measured by this file. As of stage 2c,
  1 of 10 is covered (by mutate-sec-results-date.mjs); the other 9 describe
  stage 2/3/4 code that does not exist yet and must not be counted as covered.
  One of those nine -- "stage 4: FPI market-cap suppression removed" -- now has
  an owner decision behind it (suppress for HDB, IBN, TSM, BABA, ASML) and is
  still uncovered until that suppression is built.
`);

process.exit(survivors.length || restored ? 1 : 0);
