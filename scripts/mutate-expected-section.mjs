// Prove check-expected-section can FAIL.
//
// Every mutant below still RENDERS a plausible section. None throw. What
// separates them from correct behaviour is whether a reader is shown a measured
// band or a promised date, and whether the suppression rules the measurement
// bought are actually doing anything.
//
//   node scripts/mutate-expected-section.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MOD = path.join(process.cwd(), "lib/server/expectedToReport.ts");
const SEC = path.join(process.cwd(), "app/earnings-calendar/EarningsExpectedSection.tsx");
const PAGE = path.join(process.cwd(), "app/earnings-calendar/page.tsx");
const COPY = path.join(process.cwd(), "lib/server/expectedCopy.ts");
const CHECK = "scripts/check-expected-section.mjs";

const FILES = [MOD, SEC, PAGE, COPY];
const dirty = execFileSync("git", ["status", "--porcelain", ...FILES, CHECK], { encoding: "utf8" }).trim();
if (dirty) {
  console.error("FATAL: refusing to run with uncommitted changes to the files this mutates:");
  console.error(dirty);
  console.error("\nThis rewrites tracked files in place and restores them from memory,");
  console.error("which would DESTROY that work. Commit or stash first.");
  process.exit(2);
}
const ORIGINALS = new Map(FILES.map((f) => [f, fs.readFileSync(f, "utf8")]));

const MUTANTS = [
  [MOD, "E1", "the FPI bar lowered to the domestic one (74 filers admitted on the wrong evidence)",
    "export const PRECISION_BAR_FPI = 0.8;", "export const PRECISION_BAR_FPI = 0.7;"],
  [MOD, "E2", "the precision bar removed entirely (every filer listed, measured or not)",
    "  if (scored.precision < bar) return { skip: \"below-precision-bar\" };", ""],
  [MOD, "E3", "the 6-K basis dropped, silently excluding every FPI again",
    'const isFpi = usable.some((e) => e.basis === "6-K near period end");',
    "const isFpi = false;"],
  [MOD, "E4", "the due-strip exclusion removed (a filer listed twice, two claims)",
    '  if (alreadyDue.has(symbol)) return { skip: "already-due" };', ""],
  [MOD, "E5", "the window's outer edge widened past what was measured",
    "export const EXPECTED_WINDOW_DAYS = 30;", "export const EXPECTED_WINDOW_DAYS = 60;"],
  [MOD, "E6", "lags left in STORED order, inverting every walk-forward",
    "    .sort((a, b) => parse(a.periodEnd as string) - parse(b.periodEnd as string))",
    "    .sort((a, b) => parse(b.periodEnd as string) - parse(a.periodEnd as string))"],
  [MOD, "E7", "precision scored pass/fail instead of by overlap (a 10-day error becomes a whole hit)",
    "    overlap += Math.max(0, span - error);",
    "    overlap += error <= EXPECTED_WINDOW_DAYS ? span : 0;"],
  [MOD, "E8", "thin history admitted (a filer scored on two quarters)",
    "export const MIN_USABLE_PERIODS = 8;", "export const MIN_USABLE_PERIODS = 2;"],
  [MOD, "E9", "past-due rows readmitted, colliding with the due strip",
    '  if (daysAway < 0) return { skip: "estimate-in-past" };', ""],
  [SEC, "E10", "the estimate rendered as a DATE — the one thing the measurement forbids",
    "<span className=\"expAway\">{awayLabel(row.daysAway)}</span>",
    "<span className=\"expAway\">{new Date(Date.now() + row.daysAway * 86400000).toISOString().slice(0, 10)}</span>"],
  [SEC, "E11", "the coverage denominator dropped (the list's length becomes the claim)",
    '          <p className="expCoverage">{coverageLabel(state.rows.length, state.considered)}</p>', ""],
  [SEC, "E12", "the two empties collapsed into one sentence",
    "state.kind === \"none\" ? EXPECTED_NONE : EXPECTED_UNAVAILABLE", "EXPECTED_NONE"],
  [SEC, "E13", "the evidence stripped, leaving the thin templated list",
    "                      <span className=\"expEvidence\">\n                        {habitLabel(row.medianLagDays, row.fromPeriods)}\n                      </span>", ""],
  [COPY, "E14", "the sample size dropped from the habit line",
    "return `Usually reports ${medianLagDays} ${plural(medianLagDays, \"day\")} after a period ends, ` +\n    `over its last ${fromPeriods} ${plural(fromPeriods, \"period\")}`;",
    "return `Usually reports ${medianLagDays} ${plural(medianLagDays, \"day\")} after a period ends`;"],
  [COPY, "E15", "the intro's 'not announced by the company' removed",
    "\"announced by the company, so this shows a range rather than a date.\";",
    "\"published, so this shows a range rather than a date.\";"],
  [PAGE, "E16", "the section fed the BROWSED date (a forecast on any past date)",
    "getForwardSections(todayDate)", "getForwardSections(selectedDate)"],
  [PAGE, "E17", "the expected section moved ABOVE the due strip, breaking the ladder",
    "          <EarningsExpectedSection state={forward.expected} />", ""],
];

let caught = 0;
const survivors = [];
for (const [file, id, label, from, to] of MUTANTS) {
  const original = ORIGINALS.get(file);
  const hits = original.split(from).length - 1;
  if (hits !== 1) {
    console.log(`  SKIPPED   ${id}  ${label}`);
    console.log(`             anchor matched ${hits} times, needs exactly 1 — stale, NOT caught.`);
    survivors.push(`${id} (anchor matched ${hits}x)`);
    continue;
  }
  fs.writeFileSync(file, original.replace(from, to));
  let failed = false, detail = "";
  try {
    execFileSync("node", [CHECK], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    failed = true;
    const out = String(e.stdout ?? "") + String(e.stderr ?? "");
    detail = out.split("\n").filter((l) => l.includes("FAIL")).slice(0, 2).map((l) => l.trim()).join(" | ")
      // A MUTANT CAUGHT BY A COMPILE ERROR PROVES THE TRANSPILER WORKS and
      // nothing else. Named rather than counted silently.
      || (/SyntaxError|TransformError|ReferenceError/.test(out) ? "(compile/runtime error, NOT an assertion)" : "");
  }
  fs.writeFileSync(file, original);
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

for (const [file, original] of ORIGINALS) fs.writeFileSync(file, original);
const restored = execFileSync("git", ["status", "--porcelain", ...FILES], { encoding: "utf8" }).trim();
console.log(`\n  ${caught}/${MUTANTS.length} mutants caught`);
console.log(restored ? `  ** TREE NOT RESTORED: ${restored}` : "  working tree restored and verified clean");
if (survivors.length) {
  console.log("\n  UNCOVERED, by name:");
  for (const s of survivors) console.log(`    ${s}`);
}
console.log(`
  NOT COVERED BY THIS FILE, deliberately:
    The page in a browser. The sandbox is refused *.vercel.app and the
    production domain with 403 CONNECT, so that is an owner-side step.
    The LIVE data behind it: relay task "write-due-input-census", which renders
    this component against the production store.
    The brief's ten mutants are a SEPARATE denominator -- run
    scripts/check-brief-mutants.mjs. A green run here is not a green brief.
`);
process.exit(survivors.length || restored ? 1 : 0);
