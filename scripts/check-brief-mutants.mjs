// THE DENOMINATOR, PRINTED IN FULL, EVERY RUN.
//
// ── WHY THIS IS A CHECK AND NOT A HABIT ───────────────────────────────────
// The standing rule on this build is that every one of the brief's ten mutants
// is named with its status on every mutation run. That rule was kept by
// remembering it, and it survived exactly as long as the document did: the
// list lives in BUILD-BRIEF-earnings-calendar-v1-2026-09-15 §9, that file was
// lost, and a session was then asked for a coverage figure it could not
// source. It correctly refused to invent one -- but "correctly refused" is not
// a reporting mechanism.
//
// So the list is committed and this file reads it. A mutant cannot be dropped
// from the denominator by being forgotten, only by being edited out of a
// tracked file in a reviewable diff.
//
// ── THE THREE STATUSES, AND WHY THE THIRD IS NOT THE SECOND ───────────────
//   caught         a named assertion fails when the rule is removed
//   uncovered      nothing would notice its removal            <- the real debt
//   inapplicable   it describes work that will NOT be built    <- not debt
//
// INAPPLICABLE IS NOT COVERAGE AND MUST NOT BE NETTED OUT. Owner decisions 4
// and 5 (2026-09-21) put whole-market bars and stage 5 off the roadmap, which
// makes two of the ten describe a stage that will never exist. Removing them
// from the denominator would move the figure from n/10 to n/8 and read as
// progress that did not happen. They stay in, counted separately, named every
// run.
//
//   node scripts/check-brief-mutants.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BRIEF = path.join(ROOT, "claude/BUILD-BRIEF-earnings-calendar-v1-2026-09-15.md");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── The ledger. EVIDENCE IS A FILE AND A STRING, not a claim. ─────────────
// `covers` names the check script and the exact mutant label inside it, so a
// status of "caught" is verified against the suite rather than asserted here.
// Renaming a mutant in its check turns this red, which is the point: coverage
// recorded in two places that cannot disagree.
const LEDGER = [
  { n: 1, brief: "`frame` matching replaced by `end − 365`",
    status: "inapplicable", why: "stage-5 dynamic ranking, off the roadmap (owner decision 4/5, 2026-09-21)" },
  { n: 2, brief: "`Revenues` promoted above the contract-revenue tag",
    status: "uncovered" },
  { n: 3, brief: "`fy`/`fp` used as the primary match",
    status: "inapplicable", why: "stage-5 dynamic ranking, off the roadmap (owner decision 4/5, 2026-09-21)" },
  { n: 4, brief: "year-ago absence rendered as `0` rather than a dash",
    status: "uncovered" },
  { n: 5, brief: "multi-class grouping removed (per-ticker cap instead of per-CIK)",
    status: "caught",
    covers: ["scripts/check-sec-valuation.mjs", "ambiguous multi-class count picked anyway"] },
  { n: 6, brief: "FPI market-cap suppression removed",
    status: "caught",
    covers: ["scripts/check-sec-valuation.mjs", "stage 4: FPI market-cap suppression removed"] },
  { n: 7, brief: "weighted-average diluted tag admitted to the shares chain",
    status: "caught",
    covers: ["scripts/check-sec-extract.mjs", "duration-average"] },
  { n: 8, brief: "strict 2.02+9.01 falling back to loose when strict resolves to one, not zero",
    status: "caught",
    covers: ["scripts/check-sec-report-dates.mjs", "9.01"] },
  { n: 9, brief: "due-strip k changed from 7",
    status: "uncovered",
    why: "STAYS LIVE — applies to the static-list strip, which decision 6 made permanent" },
  { n: 10, brief: "30-day overdue cap removed",
    status: "uncovered",
    why: "STAYS LIVE — applies to the static-list strip, which decision 6 made permanent" },
];

console.log("\n1. THE LIST IS READ FROM THE BRIEF, NOT FROM THIS FILE");
{
  const ok = fs.existsSync(BRIEF);
  check("the brief is committed and readable", ok,
    ok ? "" : "the denominator has been lost again — restore it before citing any coverage figure");
  if (!ok) { console.log(`\n${++failures} FAILED`); process.exit(1); }

  const src = fs.readFileSync(BRIEF, "utf8");

  // SCOPED TO §9, and the first version was not. It matched every numbered list
  // in the file, so completing the mirror with §§1-5 -- whose §4 numbers its
  // two resolution steps -- took the count from 10 to 12 and turned this red.
  //
  // That is the check working: a denominator read by a loose regex is a
  // denominator that changes when someone edits an unrelated section. The
  // window is cut at the §9 heading and closed at the next one.
  const from = src.indexOf("## §9");
  check("the brief still contains a §9", from >= 0,
    "the mutant list is the denominator; if its heading moved, this file must follow");
  const rest = src.slice(from + 1);
  const to = rest.indexOf("\n## ");
  const section9 = to >= 0 ? rest.slice(0, to) : rest;
  const listed = [...section9.matchAll(/^(\d+)\.\s+(.+)$/gm)].map((m) => m[2].trim());
  check("the brief lists exactly ten mutants", listed.length === 10, `found ${listed.length}`);
  check("the ledger covers every one of them, in order",
    LEDGER.length === listed.length && LEDGER.every((e, i) => e.brief === listed[i]),
    "a ledger entry that does not match the brief verbatim is a denominator drifting from its source");
}

console.log("\n2. EVERY 'caught' IS VERIFIED AGAINST THE SUITE THAT CLAIMS IT");
{
  for (const e of LEDGER.filter((x) => x.status === "caught")) {
    const [file, needle] = e.covers;
    const p = path.join(ROOT, file);
    const present = fs.existsSync(p) && fs.readFileSync(p, "utf8").includes(needle);
    check(`#${e.n} is caught by ${file}`, present,
      present ? "" : `"${needle}" is not in that file — the mutant was renamed or removed`);
  }
}

// ── 3. THE REPORT. Printed unconditionally, pass or fail. ────────────────
const byStatus = (s) => LEDGER.filter((e) => e.status === s);
const caught = byStatus("caught"), uncovered = byStatus("uncovered"), inapplicable = byStatus("inapplicable");

console.log("\n3. BRIEF-MUTANT STATUS — all ten, every run\n");
for (const e of LEDGER) {
  const tag = { caught: "CAUGHT      ", uncovered: "UNCOVERED   ", inapplicable: "INAPPLICABLE" }[e.status];
  console.log(`  ${tag} #${String(e.n).padStart(2)}  ${e.brief}`);
  if (e.why) console.log(`                    ${e.why}`);
}

const live = LEDGER.length - inapplicable.length;
console.log(
  `\n  ${caught.length} of ${LEDGER.length} caught` +
  `  (${uncovered.length} uncovered, ${inapplicable.length} permanently inapplicable)` +
  `\n  Against the ${live} that are still buildable: ${caught.length}/${live}.` +
  `\n  BOTH figures are printed deliberately. The denominator stays 10.`
);

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
