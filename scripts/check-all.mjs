// Run every check-*.mjs and report which passed.
//
// WHY THIS EXISTS. The suite was only ever run as an ad-hoc shell loop, and that
// hid a real gap: check-static-safety.mjs required an argv path and threw a
// TypeError on bare invocation, so a loop over the directory produced a crash
// that read as "that one's broken" rather than as a result. A harness nobody can
// run is a harness that cannot fail, which is the same shape as every other bug
// this suite exists to catch.
//
//   node scripts/check-all.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "scripts");

const scripts = fs
  .readdirSync(DIR)
  .filter((f) => f.startsWith("check-") && f.endsWith(".mjs") && f !== "check-all.mjs")
  .sort();

let failed = 0;
const failures = [];

// REPORT ONLY (#553): scripts that describe the state of the content rather than
// guard it. They are run and their output is printed (the first `lines` lines,
// then a pointer to the script), but they are never a failure and never counted
// as one: a non-zero exit is printed as a note, not added to `failed`.
const REPORT_ONLY = new Map([["check-bottleneck-links.mjs", { lines: 20, args: ["--brief"] }]]);

for (const f of scripts) {
  const report = REPORT_ONLY.get(f);
  if (report) {
    let out = "";
    let note = "";
    try {
      out = execFileSync(process.execPath, [path.join(DIR, f), ...(report.args ?? [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      out = `${e.stdout ?? ""}`;
      note = "  (the report script exited non-zero; reports never fail check-all)";
    }
    console.log(`REPORT  ${f}`);
    const rows = out.split("\n").filter((l) => l.trim() !== "");
    for (const l of rows.slice(0, report.lines)) console.log(`        ${l}`);
    if (rows.length > report.lines) console.log(`        ... ${rows.length - report.lines} more lines: node scripts/${f}`);
    if (note) console.log(note);
    continue;
  }
  let ok = true;
  let output = "";
  try {
    output = execFileSync(process.execPath, [path.join(DIR, f)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    ok = false;
    output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${f}`);
  if (!ok) {
    failed++;
    const lines = output.split("\n").filter((l) => /^  FAIL|Error/.test(l)).slice(0, 4);
    failures.push([f, lines]);
  }
}

if (failures.length) {
  console.log("\n--- failures ---");
  for (const [f, lines] of failures) {
    console.log(`\n${f}`);
    for (const l of lines) console.log(`  ${l.trim()}`);
  }
}

const checkCount = scripts.length - [...REPORT_ONLY.keys()].filter((f) => scripts.includes(f)).length;
console.log(`\n${failed ? `${failed} of ${checkCount} FAILED` : `all ${checkCount} passed`}\n`);
process.exit(failed ? 1 : 0);
