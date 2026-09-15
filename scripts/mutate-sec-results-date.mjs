// Does check-sec-results-date.mjs actually catch anything?
//
// THE TRAP THIS EXISTS FOR (#453). A suite that passes against correct code has
// demonstrated nothing, and the results date is the single field both halves of
// /earnings-calendar are built on: the grid inverts it by date, the due strip
// asks which periods have no entry. A wrong date is not a visible error, it is
// a plausible one -- a company appears to have reported on the day it announced
// a board change, and the page looks fine.
//
// So each rule is REVERTED in turn, in the tracked file, and the suite must
// FAIL. A mutant that survives is reported as a hole in the suite, not as a
// pass.
//
// ── WHERE THE BRIEF'S TEN MUTANTS LIVE ─────────────────────────────────────
// One of the ten is a stage-1 rule and is here, first in the list:
//   "strict falling back to loose when strict resolves to ONE, not zero"
// The other nine belong to code that does not exist yet and CANNOT be written
// against it -- four are year-ago column rules (stage 3), three are market-cap
// rules (stage 4), two are due-strip rules (stage 2). They are named in
// MISSING below so that "we wrote the mutants" is never confused with "we wrote
// one of them".
//
// ── THE STANDING RULE: THIS REWRITES TRACKED FILES IN PLACE ────────────────
// It edits lib/server/secResultsDate.ts and lib/server/secManifest.ts, runs the
// suite, and restores. It must NEVER overlap a commit: a mutant left in the
// tree when something else commits is a corrupted rule shipped under an
// innocent message. Two guards, because one is a habit and two is a mechanism:
//   1. it REFUSES to start unless the working tree is clean
//   2. it restores with `git checkout --` in a finally, and re-verifies
//      cleanliness before exiting, failing loudly if anything is left behind
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = "lib/server/secResultsDate.ts";
const MANIFEST = "lib/server/secManifest.ts";
const TOUCHED = [SRC, MANIFEST];

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
const dirty = () => git("status", "--porcelain", "--", ...TOUCHED).trim();

// ── Guard 1 ────────────────────────────────────────────────────────────────
const before = dirty();
if (before) {
  console.error("FATAL: refusing to run with uncommitted changes to the files this mutates:\n" + before);
  console.error(
    "\nThis rewrites tracked files in place and restores them with `git checkout --`, " +
      "which would DESTROY that work. Commit or stash first."
  );
  process.exit(2);
}

// Named in the brief, buildable only once the code they describe exists. Listed
// rather than omitted: a runner that silently covers one tenth of a brief reads
// as a runner that covers the brief.
const MISSING = [
  ["stage 3", "frame matching replaced by end - 365"],
  ["stage 3", "Revenues promoted above contract-revenue"],
  ["stage 3", "fy/fp used as the primary match"],
  ["stage 3", "year-ago absence rendered as 0 rather than a dash"],
  ["stage 4", "multi-class grouping removed (per-ticker instead of per-CIK)"],
  ["stage 4", "FPI market-cap suppression removed"],
  ["stage 4", "weighted-average diluted tag admitted to the shares chain"],
  ["stage 2", "due-strip k changed from 7"],
  ["stage 2", "30-day overdue cap removed"],
];

// Each mutant undoes exactly one rule. `from` must appear exactly once, or the
// mutant is reported as unapplied rather than silently skipped -- an unapplied
// mutant looks identical to a caught one from the exit code alone.
const MUTANTS = [
  {
    id: "R1   strict falls back to loose when it resolves to ONE  [brief]",
    file: SRC,
    from: `  const chosen = strict.length > 0 ? strict[0] : candidates[0];`,
    to: `  const chosen = strict.length > 1 ? strict[0] : candidates[0];`,
  },
  {
    id: "R1b  the loose pick still LABELLED strict",
    file: SRC,
    from: `      rule: strict.length > 0 ? "strict" : "loose",`,
    to: `      rule: "strict" as const,`,
  },
  {
    id: "R1c  the strict arm removed entirely (always loose)",
    file: SRC,
    from: `    const strict = candidates.filter((r) => ITEM_EXHIBITS.test(r.items));`,
    to: `    const strict: typeof candidates = [];`,
  },
  {
    id: "R1d  the strict filter made inert (2.02 tested twice)",
    file: SRC,
    from: `    const strict = candidates.filter((r) => ITEM_EXHIBITS.test(r.items));`,
    to: `    const strict = candidates.filter((r) => ITEM_RESULTS.test(r.items));`,
  },
  {
    id: "R2   9.01 alone admitted as a results release (2.02 dropped)",
    file: SRC,
    from: `    .filter((r) => r.form === "8-K" && ITEM_RESULTS.test(r.items) && valid(r.filingDate))`,
    to: `    .filter((r) => r.form === "8-K" && ITEM_EXHIBITS.test(r.items) && valid(r.filingDate))`,
  },
  {
    id: "R3   the attribution ceiling removed (next period end only)",
    file: SRC,
    from: `    const ceiling = Math.min(nextP, P + MAX_ATTRIBUTION_DAYS * DAY);`,
    to: `    const ceiling = nextP;`,
  },
  {
    id: "R4   the same accession counted twice (dedupe removed)",
    file: SRC,
    from: `    .filter((r) => !seen.has(r.accn) && seen.add(r.accn))\n`,
    to: ``,
  },
  {
    id: "R5   period end DERIVED to a month end instead of read",
    file: SRC,
    from: `    if (valid(r.reportDate)) set.add(r.reportDate);`,
    to: `    if (valid(r.reportDate)) set.add(r.reportDate.slice(0, 8) + "30");`,
  },
  {
    id: "R6   latestResults takes the FIRST of the series, not the last",
    file: SRC,
    from: `  return all.length ? all[all.length - 1] : null;`,
    to: `  return all.length ? all[0] : null;`,
  },
  {
    id: "R7   FPI test ignores the 10-Q (20-F alone decides)",
    file: SRC,
    from: `  return annualForeign && !quarterlyDomestic;`,
    to: `  return annualForeign;`,
  },
  {
    id: "R8   the FPI same-day tiebreak reverted to 'later reportDate wins'",
    file: SRC,
    from: `    const cur = byPeriod.get(r.reportDate);\n    if (!cur || parse(r.filingDate) < parse(cur.filingDate)) byPeriod.set(r.reportDate, r);`,
    to: `    const cur = byPeriod.get(r.filingDate);\n    if (!cur || parse(r.reportDate) > parse(cur.reportDate)) byPeriod.set(r.filingDate, r);`,
  },
  {
    id: "R9   the event-notice filter removed (a 6-K filed on its own reportDate counts)",
    file: SRC,
    from: `    if ((parse(r.filingDate) - parse(r.reportDate)) / DAY < FPI_MIN_REPORTING_GAP_DAYS) continue;\n`,
    to: ``,
  },
  {
    id: "R10  an over-large gap REJECTS instead of re-anchoring (the INFY bug)",
    file: SRC,
    from: `      if (gap > FPI_MAX_PERIOD_GAP_DAYS) { last = p; continue; }`,
    to: `      if (gap > FPI_MAX_PERIOD_GAP_DAYS) { continue; }`,
  },
  {
    id: "R11  the manifest field dropped from emptyEntry",
    file: MANIFEST,
    from: `    lastResultsDate: null,\n`,
    to: ``,
  },
];

const results = [];
try {
  for (const mut of MUTANTS) {
    const file = path.join(ROOT, mut.file);
    const original = fs.readFileSync(file, "utf8");
    const occurrences = original.split(mut.from).length - 1;

    if (occurrences !== 1) {
      results.push({ id: mut.id, status: "UNAPPLIED", detail: `anchor matched ${occurrences} times, expected 1` });
      console.log(`  UNAPPLIED  ${mut.id} — anchor matched ${occurrences}x`);
      continue;
    }

    fs.writeFileSync(file, original.replace(mut.from, mut.to));
    let caught = false;
    let how = "";
    try {
      execFileSync("node", ["scripts/check-sec-results-date.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: "pipe",
      });
      how = "the suite passed";
    } catch (e) {
      caught = true;
      const out = String(e.stdout ?? "") + String(e.stderr ?? "");
      const failed = out.split("\n").filter((l) => l.includes("FAIL")).slice(0, 2).map((l) => l.trim());
      how = failed.join(" | ") || "non-zero exit";
    }
    fs.writeFileSync(file, original);

    results.push({ id: mut.id, status: caught ? "CAUGHT" : "SURVIVED", detail: how });
    console.log(`  ${caught ? "CAUGHT   " : "SURVIVED "} ${mut.id}`);
    if (caught) console.log(`             ${how}`);
  }
} finally {
  // ── Guard 2 ──────────────────────────────────────────────────────────────
  try {
    git("checkout", "--", ...TOUCHED);
  } catch (e) {
    console.error(`\nFATAL: could not restore the mutated files: ${e.message}`);
    console.error("The working tree may still hold a mutant. Run: git checkout -- " + TOUCHED.join(" "));
    process.exit(3);
  }
}

const left = dirty();
if (left) {
  console.error("\nFATAL: files are still modified after restore:\n" + left);
  process.exit(3);
}

const survived = results.filter((r) => r.status === "SURVIVED");
const unapplied = results.filter((r) => r.status === "UNAPPLIED");

console.log(`\n  ${results.filter((r) => r.status === "CAUGHT").length}/${results.length} mutants caught`);
console.log("  working tree restored and verified clean");

console.log(`\n  ${MISSING.length} of the brief's ten mutants describe code that does not exist yet:`);
for (const [stage, name] of MISSING) console.log(`    ${stage}  ${name}`);
console.log("  They are not covered here and must not be counted as covered.");

if (unapplied.length) {
  console.error(`\n${unapplied.length} MUTANT(S) COULD NOT BE APPLIED — the anchors have drifted:`);
  for (const r of unapplied) console.error(`  - ${r.id}: ${r.detail}`);
}
if (survived.length) {
  console.error(`\n${survived.length} MUTANT(S) SURVIVED — the suite does not actually test these:`);
  for (const r of survived) console.error(`  - ${r.id}`);
}
process.exit(survived.length || unapplied.length ? 1 : 0);
