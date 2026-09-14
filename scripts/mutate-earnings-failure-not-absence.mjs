// Does check-earnings-failure-not-absence.mjs actually catch anything?
//
// THE TRAP THIS EXISTS FOR (#453). A suite that passes against correct code has
// demonstrated nothing. The defect it guards against shipped BECAUSE the code
// looked right: quoteOne returned a well-formed object on failure and every
// reader accepted it. An assertion written against that same intuition can be
// just as wrong, and it announces PASS either way.
//
// So each fix is REVERTED in turn, in the tracked file, and the suite must FAIL.
// A mutant that survives is reported as a hole in the suite, not as a pass.
//
// ── THE STANDING RULE: THIS REWRITES TRACKED FILES IN PLACE ────────────────
// It edits lib/server/earningsCalendar.ts and app/earnings-calendar/*, runs the
// suite, and restores. It must NEVER overlap a commit: a mutant left in the tree
// when something else commits is a corrupted fix shipped under an innocent
// message. Two guards, because one is a habit and two is a mechanism:
//   1. it REFUSES to start unless the working tree is clean
//   2. it restores with `git checkout --` in a finally, and re-verifies
//      cleanliness before exiting, failing loudly if anything is left behind
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CAL = "lib/server/earningsCalendar.ts";
const BTN = "app/earnings-calendar/BackfillButton.tsx";
const PAGE = "app/earnings-calendar/page.tsx";
const TOUCHED = [CAL, BTN, PAGE];

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

// Each mutant undoes exactly one fix. `from` must appear exactly once, or the
// mutant is reported as unapplied rather than silently skipped -- an unapplied
// mutant looks identical to a caught one from the exit code alone.
const MUTANTS = [
  {
    id: "F1a  failed flag dropped from quoteOne's return",
    file: CAL,
    from: `if (!res.ok) return { price: null, marketCap: null, exchange: null, capped: false, failed: true };`,
    to: `if (!res.ok) return { price: null, marketCap: null, exchange: null, capped: false, failed: false };`,
  },
  {
    id: "F1b  failed flag dropped from the thrown-fetch arm",
    file: CAL,
    from: `    return { price: null, marketCap: null, exchange: null, capped: false, failed: true };\n  }\n}`,
    to: `    return { price: null, marketCap: null, exchange: null, capped: false, failed: false };\n  }\n}`,
  },
  {
    id: "F1c  !anyFailed removed from the completeness test",
    file: CAL,
    from: `  const complete = quotedEveryCandidate && !anyCapped && !anyFailed;`,
    to: `  const complete = quotedEveryCandidate && !anyCapped;`,
  },
  {
    id: "F2   the write guard removed (writes empty whatever happened)",
    file: CAL,
    from: `  if (!emptyAndUnverifiable) {\n    // Materialise what we have, so the next render -- and Show more -- read it\n    // back instead of re-quoting.\n    await writeDayItemsCache(date, items);\n  }`,
    to: `  await writeDayItemsCache(date, items);`,
  },
  {
    id: "F2b  the write guard reverted to the candidate-count form",
    file: CAL,
    from: `  const emptyAndUnverifiable = items.length === 0 && totalCandidates > 0 && anyFailed;`,
    to: `  const emptyAndUnverifiable = items.length === 0 && totalCandidates > 0;`,
  },
  {
    id: "F3   the cache read reverted to truthiness",
    file: CAL,
    from: `    if (cachedItems && emptyIsSettled) {`,
    to: `    if (cachedItems) {`,
  },
  {
    id: "F3b  the settled-empty read reverted to the candidate-count form",
    file: CAL,
    from: `      (cachedItems.length > 0 || totalCandidates === 0 || (await isDateComplete(date)));`,
    to: `      (cachedItems.length > 0 || totalCandidates === 0);`,
  },
  {
    id: "F6b  the per-month visibility guard removed",
    file: CAL,
    from: `    if (visibility === "unknown") {`,
    to: `    if (false) {`,
  },
  {
    id: "F5   the empty-month cache refusal removed",
    file: CAL,
    from: `  if (byDate.size > 0) {\n    candidatesCache.set(key, { at: Date.now(), byDate });\n  }`,
    to: `  candidatesCache.set(key, { at: Date.now(), byDate });`,
  },
  {
    id: "F6   the zero-candidate frontier guard removed",
    file: CAL,
    from: `  if (!sawAnyCandidates) {`,
    to: `  if (false) {`,
  },
  {
    id: "F7   the TTL re-ordered after the counter (the original two-step)",
    file: CAL,
    from: `    await redis.set(key, 0, { ex: 70 * 60, nx: true }); // just over an hour, covers clock skew\n    const current = await redis.incr(key);`,
    to: `    const current = await redis.incr(key);\n    if (current === 1) {\n      await redis.expire(key, 70 * 60);\n    }`,
  },
  {
    id: "F4   Backfill re-reading the complete flag",
    file: BTN,
    from: `  if (!hasEarnings) {`,
    to: `  if (arguments.length === -1) {\n    return (\n      <button type="button" disabled>\n        Backfill (this date is fully populated)\n      </button>\n    );\n  }\n\n  if (!hasEarnings) {`,
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
      execFileSync("node", ["scripts/check-earnings-failure-not-absence.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: "pipe",
      });
      how = "the suite passed";
    } catch (e) {
      caught = true;
      const out = String(e.stdout ?? "");
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

if (unapplied.length) {
  console.error(`\n${unapplied.length} MUTANT(S) COULD NOT BE APPLIED — the anchors have drifted:`);
  for (const r of unapplied) console.error(`  - ${r.id}: ${r.detail}`);
}
if (survived.length) {
  console.error(`\n${survived.length} MUTANT(S) SURVIVED — the suite does not actually test these:`);
  for (const r of survived) console.error(`  - ${r.id}`);
}
process.exit(survived.length || unapplied.length ? 1 : 0);
