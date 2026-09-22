// Prove check-due-inputs can FAIL.
//
// A suite that passes against a broken producer is testing nothing, and what is
// at risk here is particularly quiet: every mutant below still returns a
// well-formed DueInput[], still renders a strip, and still reads as a working
// page. The difference between them and correct behaviour is which companies a
// reader is shown and which ratio gates the claim.
//
// ── ONE MUTANT HERE WAS ALMOST WORTHLESS, AND THAT IS RECORDED ────────────
// D1 removes the union's discriminant gate. The first draft of the check could
// not have caught it: `kind !== "date"` and the Number.isFinite guard below it
// give the SAME answer for every record the TYPE permits, so the mutant would
// have passed against every fixture while proving nothing -- the third time
// this build has met that shape. It bites only against a non-date estimate
// carrying a stray numeric lag, which is reachable because a stored record is
// JSON from an older deployment rather than a typed value. The check gained
// that fixture before this mutant was written.
//
//   node scripts/mutate-due-inputs.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "lib/server/dueInputs.ts");
const CHECK = "scripts/check-due-inputs.mjs";

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
  ["D1", "the union discriminant replaced by a truthiness test (a stray lag is believed)",
    'if (rec.next?.kind !== "date") return { skip: "no-median-lag" };',
    'if (!rec.next) return { skip: "no-median-lag" };'],
  ["D2", "the unknown-annual default flipped to the TIGHTENING direction",
    "export const ANNUAL_WHEN_UNKNOWN = true;",
    "export const ANNUAL_WHEN_UNKNOWN = false;"],
  ["D3", "`annual` read with || so a stored FALSE is swallowed",
    'annual: typeof rec.annual === "boolean" ? rec.annual : ANNUAL_WHEN_UNKNOWN,',
    "annual: rec.annual || ANNUAL_WHEN_UNKNOWN,"],
  ["D4", "an absent category coerced to \"\" (reads as a category we had)",
    'filerCategory: typeof rec.category === "string" ? rec.category : null,',
    'filerCategory: typeof rec.category === "string" ? rec.category : "",'],
  ["D5", "coverage counting RECORDS rather than events (a found-nothing record inflates it)",
    "if (rec && Array.isArray(rec.events) && rec.events.length > 0) withResultsDate++;",
    "if (rec) withResultsDate++;"],
  ["D6", "the coverage test dropped entirely (coverage always reads 100%)",
    "    const rec = records.get(symbol);\n    if (rec && Array.isArray(rec.events) && rec.events.length > 0) withResultsDate++;",
    "    withResultsDate++;"],
  ["D9", "cutDrift inverted (a cut that has left the universe reads as covered)",
    "return DUE_STRIP_CUT.filter((s) => !inUniverse.has(s));",
    "return DUE_STRIP_CUT.filter((s) => inUniverse.has(s));"],
  ["D7", "the skip bookkeeping dropped (a symbol vanishes with no owner)",
    'if ("input" in got) inputs.push(got.input);\n    else skipped[got.skip].push(symbol);',
    'if ("input" in got) inputs.push(got.input);'],
  ["D8", "the FPI/6-K census deleted from the source (the next reader 'fixes' the estimator)",
    "// ASML, BABA, HSBC, RY, MUFG, NVS, AZN and SHEL are foreign private issuers:",
    "// Some symbols in the cut do not produce an input."],
];

let caught = 0;
const survivors = [];

for (const [id, label, from, to] of MUTANTS) {
  // AN ANCHOR THAT NO LONGER MATCHES IS NOT A PASS. A stale mutant silently
  // stops testing the thing it names, and counting it as caught is how a
  // coverage figure rots without anyone editing it.
  const hits = ORIGINAL.split(from).length - 1;
  if (hits !== 1) {
    console.log(`  SKIPPED   ${id}  ${label}`);
    console.log(`             anchor matched ${hits} times, needs exactly 1 — the mutant is stale,`);
    console.log(`             which is NOT the same as caught and must not be counted as one.`);
    survivors.push(`${id} (anchor matched ${hits}x)`);
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

// ── WHAT THIS FILE DOES NOT COVER, SAID HERE RATHER THAN INFERRED ─────────
console.log(`
  NOT COVERED BY THIS FILE, deliberately:
    getDueStripState's Redis half. It is exercised end to end against the LIVE
    store by the relay task "write-due-input-census" (run 35714403198), which
    is where the "listed" branch was verified with real production data -- one
    real row, MU, at 75.1% coverage. The "none-outstanding" and "unavailable"
    branches CANNOT be produced from production as it stands and are exercised
    from forced inputs only, in check-due-inputs.mjs section 6, labelled as
    such. Neither this file nor that one claims full real-data coverage.

    The brief's ten mutants are a SEPARATE denominator and are not measured
    here. Run scripts/check-brief-mutants.mjs for that figure; a green run of
    this file is not a green brief.
`);

process.exit(survivors.length || restored ? 1 : 0);
