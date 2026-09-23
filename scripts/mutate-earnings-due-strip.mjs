// Prove check-earnings-due-strip can FAIL.
//
// Every mutant below still RENDERS. None throw, none blank the page, and all of
// them look like a working strip. What separates them from correct behaviour is
// which sentence a reader is shown — which is precisely the class of defect
// this whole strip exists to prevent, so a suite that cannot catch them is
// worth nothing.
//
//   node scripts/mutate-earnings-due-strip.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "app/earnings-calendar/EarningsDueStrip.tsx");
const PAGE = path.join(process.cwd(), "app/earnings-calendar/page.tsx");
const CHECK = "scripts/check-earnings-due-strip.mjs";

const dirty = execFileSync("git", ["status", "--porcelain", SRC, PAGE, CHECK], { encoding: "utf8" }).trim();
if (dirty) {
  console.error("FATAL: refusing to run with uncommitted changes to the files this mutates:");
  console.error(dirty);
  console.error("\nThis rewrites tracked files in place and restores them from memory,");
  console.error("which would DESTROY that work. Commit or stash first.");
  process.exit(2);
}

const ORIGINALS = new Map([[SRC, fs.readFileSync(SRC, "utf8")], [PAGE, fs.readFileSync(PAGE, "utf8")]]);

const MUTANTS = [
  [SRC, "R1", "the two empties collapsed into one sentence (the lie the strip exists to stop)",
    'state.kind === "none-outstanding" ? DUE_STRIP_NONE_OUTSTANDING : DUE_STRIP_UNAVAILABLE',
    "DUE_STRIP_NONE_OUTSTANDING"],
  [SRC, "R2", "the empties collapsed the OTHER way (a real quiet day reads as our failure)",
    'state.kind === "none-outstanding" ? DUE_STRIP_NONE_OUTSTANDING : DUE_STRIP_UNAVAILABLE',
    "DUE_STRIP_UNAVAILABLE"],
  [SRC, "R3", "expectedOn rendered as a date pill (the one field both modules forbid)",
    "<span className=\"dueStripLabel\">{dueRowLabel(entry)}</span>",
    "<span className=\"dueStripLabel\">{dueRowLabel(entry)} · {entry.expectedOn}</span>"],
  [SRC, "R4", "the row label paraphrased into a forecast",
    "{dueRowLabel(entry)}",
    '{`${entry.symbol} will report shortly`}'],
  [SRC, "R5", "the intro dropped (the sentence that says this is not a forecast)",
    '<p className="dueStripIntro">{DUE_STRIP_INTRO}</p>',
    ""],
  [SRC, "R6", "the heading hardcoded instead of imported",
    "{DUE_STRIP_HEADING}",
    '{"Upcoming earnings this week"}'],
  [SRC, "R7", "the strip hidden when there is nothing to list (both empties become silence)",
    "export default function EarningsDueStrip({ state }: { state: DueStripState }) {\n  return (",
    "export default function EarningsDueStrip({ state }: { state: DueStripState }) {\n  if (state.kind !== \"listed\") return null;\n  return ("],
  [PAGE, "R8", "the strip fed the BROWSED date rather than today (a forecast on any future date)",
    "getForwardSections(todayDate)",
    "getForwardSections(selectedDate)"],
  [PAGE, "R9", "the strip removed from the page while the meta description still promises it",
    "<EarningsDueStrip state={forward.due} />",
    ""],
];

let caught = 0;
const survivors = [];

for (const [file, id, label, from, to] of MUTANTS) {
  const original = ORIGINALS.get(file);
  // AN ANCHOR THAT NO LONGER MATCHES IS NOT A PASS. A stale mutant silently
  // stops testing the thing it names, and counting it as caught is how a
  // coverage figure rots without anyone editing it.
  const hits = original.split(from).length - 1;
  if (hits !== 1) {
    console.log(`  SKIPPED   ${id}  ${label}`);
    console.log(`             anchor matched ${hits} times, needs exactly 1 — stale, NOT caught.`);
    survivors.push(`${id} (anchor matched ${hits}x)`);
    continue;
  }
  fs.writeFileSync(file, original.replace(from, to));
  let failed = false;
  let detail = "";
  try {
    execFileSync("node", [CHECK], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    failed = true;
    const out = String(e.stdout ?? "");
    detail = out.split("\n").filter((l) => l.includes("FAIL")).slice(0, 2).map((l) => l.trim()).join(" | ")
      // A mutant that makes the module fail to COMPILE is caught, but for the
      // wrong reason -- it proves the transpiler works, not the assertions. Said
      // plainly rather than counted silently.
      || (/SyntaxError|TransformError/.test(out + String(e.stderr ?? "")) ? "(compile error, not an assertion)" : "");
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
const restored = execFileSync("git", ["status", "--porcelain", SRC, PAGE], { encoding: "utf8" }).trim();
console.log(`\n  ${caught}/${MUTANTS.length} mutants caught`);
console.log(restored ? `  ** TREE NOT RESTORED: ${restored}` : "  working tree restored and verified clean");

if (survivors.length) {
  console.log("\n  UNCOVERED, by name:");
  for (const s of survivors) console.log(`    ${s}`);
}

console.log(`
  NOT COVERED BY THIS FILE, deliberately:
    The RENDERED PAGE in a browser. The sandbox is refused *.vercel.app and the
    production domain (403 CONNECT), so "it looks right on the preview" is an
    owner-side step, not something a session can assert. What IS asserted here
    is the markup the server produces, which is what a crawler and a
    screen-reader consume.

    The LIVE DATA behind it. That is the relay task "write-due-input-census",
    which renders this same component against the production store.

    The brief's ten mutants are a SEPARATE denominator; run
    scripts/check-brief-mutants.mjs. A green run here is not a green brief.
`);

process.exit(survivors.length || restored ? 1 : 0);
