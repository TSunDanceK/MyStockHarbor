// Run a calibration: break the code deliberately, count what fails, put it back.
//
// WHY THIS IS A SCRIPT AND NOT A RULE.
//
// The rule was "commit before calibrating, never `git checkout --` over
// uncommitted work". It is written down in
// claude/traps/the-calibration-measured-a-tree-that-no-longer-exists.md, and it
// has lost to the same reflex SIX times. The last one produced a commit whose
// message described a fix the commit did not contain: the mutation removed a
// line, `git checkout -- <file>` restored to HEAD, and HEAD predated the fix.
//
// So the restore is mechanised. This script snapshots every file a calibration
// will touch to a scratch directory OUTSIDE the repo, mutates, runs, and
// restores FROM THE SNAPSHOT -- never from git. Nothing in the loop consults the
// index or HEAD, so uncommitted work is safe by construction rather than by
// remembering. It then verifies the restore byte-for-byte and refuses to exit
// quietly if anything is left changed.
//
// THE SECOND HALF IS THE EXPECTED COUNTS. A calibration whose results live in a
// PR body is a measurement taken once. Here each mutation carries the number of
// checks it is supposed to break, so re-running is one command and drift is a
// failure rather than something someone has to notice. That is what made
// answering "do #362's fourteen mutations still behave the same under the new
// stripper" a single run instead of an afternoon.
//
//   node scripts/calibrate.mjs scripts/calibrations/<name>.mjs [--id M3] [--verbose]
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const specPath = args.find((a) => !a.startsWith("--"));
const onlyId = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;
const verbose = args.includes("--verbose");

if (!specPath) {
  console.error("usage: node scripts/calibrate.mjs scripts/calibrations/<name>.mjs [--id M3] [--verbose]");
  process.exit(2);
}

const { MUTATIONS, TITLE } = await import(path.resolve(ROOT, specPath));
const selected = onlyId ? MUTATIONS.filter((m) => m.id === onlyId) : MUTATIONS;
if (!selected.length) {
  console.error(`no mutation matched --id ${onlyId}`);
  process.exit(2);
}

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const writeFile = (rel, text) => fs.writeFileSync(path.join(ROOT, rel), text);

// ---------------------------------------------------------------- snapshot
// Taken ONCE, up front, over every file any selected mutation touches -- before
// a single edit. The restore below reads only from here.
const touched = [...new Set(selected.map((m) => m.file))];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "msh-calibrate-"));
const snapshot = new Map();
for (const rel of touched) {
  const text = readFile(rel);
  const dest = path.join(scratch, rel.replace(/[/\\]/g, "__"));
  fs.writeFileSync(dest, text);
  snapshot.set(rel, { dest, sha: hash(text) });
}
console.log(`\n${TITLE ?? specPath}`);
console.log(`snapshot: ${touched.length} file(s) -> ${scratch}\n`);

const restore = (rel) => {
  const snap = snapshot.get(rel);
  writeFile(rel, fs.readFileSync(snap.dest, "utf8"));
  const now = hash(readFile(rel));
  if (now !== snap.sha) {
    throw new Error(`RESTORE FAILED for ${rel} — the working tree is NOT back to its pre-calibration state.`);
  }
};

// ---------------------------------------------------------------- run one harness
// A crash and a set of failing checks are different results and are reported as
// such. #362's M2 originally CRASHED the harness at the first throwing
// assertion, which reported 2 failures when the real count was 7 -- a harness
// that dies measures how far it got, not what is broken.
// A CRASH IS DETECTED BY THE ABSENCE OF THE VERDICT LINE, not by a zero fail
// count. Every harness ends with "ALL CHECKS PASSED" or "FAILED (n)"; if neither
// is present it died partway and its fail count is how far it got, not what is
// broken.
//
// The distinction is not academic. #362 recorded M2 as 7. Re-running it here
// first reported 4 -- because the harness threw at section 3 and sections 3-6
// never ran. A tool that counted FAIL lines and called 4 a measurement would
// have quietly recorded the drift as real and sent me looking for a
// regression that was not there.
const VERDICT = /^(ALL CHECKS PASSED|FAILED \(\d+\))/m;

function runHarness(rel) {
  let out;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, rel)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const fails = (out.match(/^ {2}FAIL/gm) ?? []).length;
  return { crashed: !VERDICT.test(out), fails, out };
}

const rows = [];
let drift = 0;

try {
  for (const m of selected) {
    // `edits` lets one mutation make several changes -- moving a block is a
    // delete plus an insert, and expressing it as two separate mutations would
    // measure two things neither of which is the change being tested.
    const edits = m.edits ?? [{ find: m.find, replace: m.replace, all: m.all, count: m.count }];

    let text = readFile(m.file);
    let bad = null;
    for (const e of edits) {
      const n = e.all ? text.split(e.find).length - 1 : text.includes(e.find) ? 1 : 0;
      if (n === 0) { bad = "ANCHOR MISSING"; break; }
      if (e.count !== undefined && n !== e.count) { bad = `anchor x${n}, wanted x${e.count}`; break; }
      text = e.all ? text.split(e.find).join(e.replace) : text.replace(e.find, e.replace);
    }
    if (bad) {
      rows.push({ id: m.id, desc: m.description, expected: m.expect, actual: bad, ok: false });
      drift++;
      continue;
    }

    writeFile(m.file, text);

    let actual;
    try {
      const results = m.harnesses.map((h) => ({ h, ...runHarness(h) }));
      const crashed = results.filter((r) => r.crashed);
      const total = results.reduce((n, r) => n + r.fails, 0);
      actual = crashed.length ? `CRASH (${crashed.map((r) => path.basename(r.h)).join(", ")})` : total;
      if (verbose) {
        for (const r of results) {
          for (const line of r.out.split("\n").filter((l) => /^ {2}FAIL/.test(l))) console.log(`      ${line.trim()}`);
        }
      }
    } finally {
      // ALWAYS, including when a harness throws out of the loop.
      restore(m.file);
    }

    const ok = String(actual) === String(m.expect);
    if (!ok) drift++;
    rows.push({ id: m.id, desc: m.description, expected: m.expect, actual, ok });
  }
} finally {
  // Belt and braces: restore everything, whatever happened above.
  for (const rel of touched) restore(rel);
}

// ------------------------------------------------------- prove the tree is clean
// The snapshot restore is verified per file by hash. This is the independent
// check: if a mutation somehow touched a file the spec did not declare, the
// hashes above would all pass and the damage would ship.
const declaredDirty = new Set(touched);
const gitDirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .map((l) => l.slice(3).trim())
  .filter(Boolean);
const undeclared = gitDirty.filter((f) => !declaredDirty.has(f));

const w = Math.max(...rows.map((r) => r.desc.length), 10);
const ew = Math.max(...rows.filter((r) => String(r.expected).length <= 24).map((r) => String(r.expected).length), 6);
console.log(`  ${"id".padEnd(5)}${"mutation".padEnd(w + 2)}${"expect".padEnd(ew + 2)}actual`);
for (const r of rows) {
  const expect = String(r.expected);
  // Long values (a CRASH list) get their own line rather than running into the
  // next column -- a report that is hard to read is a report that gets skimmed.
  if (expect.length > 24 || String(r.actual).length > 24) {
    console.log(`  ${r.ok ? " " : "!"}${r.id.padEnd(4)}${r.desc}`);
    console.log(`        expect: ${expect}`);
    console.log(`        actual: ${r.actual}${r.ok ? "" : "   <-- DRIFT"}`);
    continue;
  }
  console.log(
    `  ${r.ok ? " " : "!"}${r.id.padEnd(4)}${r.desc.padEnd(w + 2)}${expect.padEnd(ew + 2)}${r.actual}${r.ok ? "" : "   <-- DRIFT"}`
  );
}

fs.rmSync(scratch, { recursive: true, force: true });

console.log(
  `\n${drift ? `${drift} of ${rows.length} mutations DRIFTED` : `all ${rows.length} mutations behave as recorded`}`
);
if (undeclared.length) {
  console.log(`\nNOTE: files changed that this calibration did not declare: ${undeclared.join(", ")}`);
  console.log("      (pre-existing working-tree changes, or a mutation that reached further than its spec says)");
}
console.log();
process.exit(drift ? 1 : 0);
