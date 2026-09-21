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
const DATES = "lib/server/secReportDates.ts";
const FILES = [SRC, DATES];
const CHECK = "scripts/check-results-date-from-store.mjs";

const dirty = execFileSync("git", ["status", "--porcelain", ...FILES, CHECK], { encoding: "utf8" }).trim();
if (dirty) {
  console.error("FATAL: refusing to run with uncommitted changes to the files this mutates:");
  console.error(dirty);
  console.error("\nThis rewrites tracked files in place and restores them with `git checkout --`.");
  process.exit(2);
}
const ORIGINAL = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(f, "utf8")]));

const MUTANTS = [
  [SRC, "D1", "the null/shape guard removed",
    "  if (!rec || !Array.isArray(rec.events)) return null;", "  if (!rec) return null;"],
  [SRC, "D2", "the unmatched-period skip removed (a half-null row is returned)",
    '    if (!e || typeof e.announcedOn !== "string" || typeof e.periodEnd !== "string") continue;',
    "    if (!e) continue;"],
  [SRC, "D3", "the empty-string guard removed (an empty date counts as a date)",
    "    if (!e.announcedOn || !e.periodEnd) continue;", ""],
  [SRC, "D4", "the newest-first order reversed (the oldest matched event wins)",
    "  for (const e of rec.events) {", "  for (const e of [...rec.events].reverse()) {"],
  [SRC, "D5", "basis dropped from the return (the caller cannot tell 8-K from 6-K)",
    "    return { announcedOn: e.announcedOn, periodEnd: e.periodEnd, accession: e.accession, basis: e.basis };",
    "    return { announcedOn: e.announcedOn, periodEnd: e.periodEnd, accession: e.accession, basis: undefined as never };"],

  // ── THE 9.01 PREFERENCE, restored from the deleted secResultsDate.ts ────
  // E1 is the brief's own mutant, back in a new home.
  [DATES, "E1", "the 9.01 tie-break removed (index order decides again)  [brief]",
    "    return carriesExhibits(candidate.items) && !carriesExhibits(incumbent.items);",
    "    return false;"],
  [DATES, "E2*", "the tie-break WIDENED to override earliest — DECLARED EQUIVALENT",
    `    if (candidate.announcedOn !== incumbent.announcedOn) {
      return candidate.announcedOn < incumbent.announcedOn;
    }
    return carriesExhibits(candidate.items) && !carriesExhibits(incumbent.items);`,
    `    if (carriesExhibits(candidate.items) && !carriesExhibits(incumbent.items)) return true;
    return candidate.announcedOn < incumbent.announcedOn;`],
  [DATES, "E3", "carriesExhibits made inert (matches 2.02, so every candidate 'carries' it)",
    'export const carriesExhibits = (raw: unknown): boolean => hasItem(raw, EXHIBITS_ITEM);',
    'export const carriesExhibits = (raw: unknown): boolean => hasItem(raw, RESULTS_ITEM);'],
];

let caught = 0;
const survivors = [];
// A mutant whose id ends in * is DECLARED EQUIVALENT: it cannot change
// behaviour, and the reason is printed rather than left as a survivor nobody
// re-derives. E2* widens the tie-break to override "earliest wins", but
// reportEvents sorts newest-first BEFORE the dedup, so the incumbent is always
// the newer event, a candidate is never newer, and the overriding branch is
// unreachable. check-results-date-from-store asserts that sort contract, which
// is what makes this equivalence true rather than merely observed today.
//
// Counted apart from both caught and uncovered. Folding it into "caught" would
// inflate the score; leaving it in "uncovered" would report a gap that no test
// can close.
const equivalent = [];
for (const [file, id, label, from, to] of MUTANTS) {
  if (!ORIGINAL[file].includes(from)) {
    console.log(`  SKIPPED   ${id}  ${label}`);
    console.log("             mutation target absent -- STALE, which is not caught.");
    survivors.push(`${id} (stale target)`);
    continue;
  }
  fs.writeFileSync(file, ORIGINAL[file].replace(from, to));
  let failed = false, detail = "";
  try { execFileSync("node", [CHECK], { encoding: "utf8", stdio: "pipe" }); }
  catch (e) {
    failed = true;
    detail = String(e.stdout ?? "").split("\n").filter((l) => l.includes("FAIL")).slice(0, 2).map((l) => l.trim()).join(" | ");
  }
  if (failed) { caught++; console.log(`  CAUGHT    ${id}  ${label}`); if (detail) console.log(`             ${detail}`); }
  else if (id.endsWith("*")) {
    equivalent.push(`${id} ${label}`);
    console.log(`  EQUIVALENT ${id}  ${label}`);
    console.log("             unreachable given the newest-first pre-sort; not a gap.");
  }
  else { survivors.push(`${id} ${label}`); console.log(`  SURVIVED  ${id}  ${label}`); }
  fs.writeFileSync(file, ORIGINAL[file]);
}

for (const f of FILES) fs.writeFileSync(f, ORIGINAL[f]);
const restored = execFileSync("git", ["status", "--porcelain", ...FILES], { encoding: "utf8" }).trim();
console.log(`\n  ${caught}/${MUTANTS.length - equivalent.length} mutants caught (${equivalent.length} declared equivalent, excluded from the denominator)`);
console.log(restored ? `  ** TREE NOT RESTORED: ${restored}` : "  working tree restored and verified clean");
if (survivors.length) {
  console.log("\n  UNCOVERED, by name:");
  for (const s of survivors) console.log(`    ${s}`);
}

console.log(`
  ── THE BRIEF'S DENOMINATOR: 1 of 10 ────────────────────────────────────
  Back to 1 of 10, where it was before the consolidation -- not progress,
  a restoration. It fell to 0 when secResultsDate.ts was deleted and its
  strict/loose 9.01 rule went with it; E1 above covers that rule in its new
  home in secReportDates.ts, so the mutant has a subject again.

  NARROWER THAN THE ORIGINAL, AND COUNTED ANYWAY. The restored rule breaks
  ties at equal announcedOn rather than overriding an earlier 2.02-only
  filing, because overriding would move announcedOn onto a later amendment
  and the stock page measures price reaction against it. E2 asserts that
  narrowing holds. If the brief meant the wider rule, this is 1 of 10 by a
  reading, and the reading is stated here rather than left implicit.

  Uncovered, by name:
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
