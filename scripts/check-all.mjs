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

for (const f of scripts) {
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

console.log(`\n${failed ? `${failed} of ${scripts.length} FAILED` : `all ${scripts.length} passed`}\n`);
process.exit(failed ? 1 : 0);
