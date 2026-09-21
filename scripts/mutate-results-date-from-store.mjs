// Prove check-results-date-from-store can fail.
//
// Replaces mutate-sec-results-date.mjs, which was deleted with the module it
// mutated. THAT IS A LOSS OF COVERAGE, NOT A TIDY-UP, and it is reported at the
// bottom of every run rather than quietly absorbed: its 14 mutants included the
// only one of the brief's ten that was covered.
//
//   node scripts/mutate-results-date-from-store.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const SRC = "lib/server/secReportDatesStore.ts";
const CHECK = "scripts/check-results-date-from-store.mjs";

const dirty = execFileSync("git", ["status", "--porcelain", SRC, CHECK], { encoding: "utf8" }).trim();
if (dirty) {
  console.error("FATAL: refusing to run with uncommitted changes to the files this mutates:");
  console.error(dirty);
  console.error("\nThis rewrites tracked files in place and restores them with `git checkout --`.");
  process.exit(2);
}
const ORIGINAL = fs.readFileSync(SRC, "utf8");

const MUTANTS = [
  ["D1", "the null/shape guard removed",
    "  if (!rec || !Array.isArray(rec.events)) return null;", "  if (!rec) return null;"],
  ["D2", "the unmatched-period skip removed (a half-null row is returned)",
    '    if (!e || typeof e.announcedOn !== "string" || typeof e.periodEnd !== "string") continue;',
    "    if (!e) continue;"],
  ["D3", "the empty-string guard removed (an empty date counts as a date)",
    "    if (!e.announcedOn || !e.periodEnd) continue;", ""],
  ["D4", "the newest-first order reversed (the oldest matched event wins)",
    "  for (const e of rec.events) {", "  for (const e of [...rec.events].reverse()) {"],
  ["D5", "basis dropped from the return (the caller cannot tell 8-K from 6-K)",
    "    return { announcedOn: e.announcedOn, periodEnd: e.periodEnd, accession: e.accession, basis: e.basis };",
    "    return { announcedOn: e.announcedOn, periodEnd: e.periodEnd, accession: e.accession, basis: undefined as never };"],
];

let caught = 0;
const survivors = [];
for (const [id, label, from, to] of MUTANTS) {
  if (!ORIGINAL.includes(from)) {
    console.log(`  SKIPPED   ${id}  ${label}`);
    console.log("             mutation target absent -- STALE, which is not caught.");
    survivors.push(`${id} (stale target)`);
    continue;
  }
  fs.writeFileSync(SRC, ORIGINAL.replace(from, to));
  let failed = false, detail = "";
  try { execFileSync("node", [CHECK], { encoding: "utf8", stdio: "pipe" }); }
  catch (e) {
    failed = true;
    detail = String(e.stdout ?? "").split("\n").filter((l) => l.includes("FAIL")).slice(0, 2).map((l) => l.trim()).join(" | ");
  }
  if (failed) { caught++; console.log(`  CAUGHT    ${id}  ${label}`); if (detail) console.log(`             ${detail}`); }
  else { survivors.push(`${id} ${label}`); console.log(`  SURVIVED  ${id}  ${label}`); }
}

fs.writeFileSync(SRC, ORIGINAL);
const restored = execFileSync("git", ["status", "--porcelain", SRC], { encoding: "utf8" }).trim();
console.log(`\n  ${caught}/${MUTANTS.length} mutants caught`);
console.log(restored ? `  ** TREE NOT RESTORED: ${restored}` : "  working tree restored and verified clean");
if (survivors.length) {
  console.log("\n  UNCOVERED, by name:");
  for (const s of survivors) console.log(`    ${s}`);
}

console.log(`
  ── THE BRIEF'S DENOMINATOR CHANGED, AND IT GOT WORSE ───────────────────
  0 of the brief's ten mutants are covered. It was 1 of 10.

  The one that WAS covered -- R1, "strict falls back to loose when it
  resolves to ONE" -- described secResultsDate.ts's preference for an 8-K
  carrying item 9.01 alongside 2.02. That module was retired in favour of
  secReportDates, which has NO 9.01 preference, so the mutant lost its
  subject rather than being satisfied.

  Uncovered, by name:
    stage 1  strict/loose 9.01 attribution preference  <- NEWLY uncovered,
             and the rule itself no longer exists in the surviving module
    stage 3  frame matching replaced by end - 365
    stage 3  Revenues promoted above contract-revenue
    stage 3  fy/fp used as the primary match
    stage 3  year-ago absence rendered as 0 rather than a dash
    stage 4  multi-class grouping removed (per-ticker instead of per-CIK)
    stage 4  FPI market-cap suppression removed
    stage 4  weighted-average diluted tag admitted to the shares chain
    stage 2  due-strip k changed from 7
    stage 2  30-day overdue cap removed
`);
process.exit(survivors.length || restored ? 1 : 0);
