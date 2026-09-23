// The FMP cache-deletion task's gates (#553 COWORK #8 §3).
//
// WHAT IS AT RISK: a delete that runs when it should not. The script is run on
// the relay's credentialled job, so its own input gates are the last line:
//   - an unknown or free-text surface is refused;
//   - mode=delete without confirm=<same surface> is refused;
//   - the key cap is enforced BEFORE any delete;
//   - UNLINK is batched by 100 and the first error stops the run.
// The gates are RUN (the script exits 2 before it ever builds a Redis client),
// and each is mutated to prove the assertion bites.
//
//   node scripts/check-fmp-cache-delete.mjs
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const FILE = "scripts/fmp-cache-delete.mjs";
const src = fs.readFileSync(path.join(ROOT, FILE), "utf8");

function run(source, symbols) {
  const file = path.join(ROOT, "scripts", `.check-fcd-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, source);
  try {
    // No Upstash variables: a run that gets past the gates fails building the
    // client, with a DIFFERENT exit code from the gates' 2.
    const env = { ...process.env, SYMBOLS: symbols };
    delete env.UPSTASH_REDIS_REST_URL;
    delete env.UPSTASH_REDIS_REST_TOKEN;
    return spawnSync(process.execPath, [file], { env, encoding: "utf8" }).status;
  } finally {
    fs.unlinkSync(file);
  }
}

function suite(source) {
  const fails = [];
  const refused = (symbols) => run(source, symbols) === 2;
  if (!refused("")) fails.push("no surface is refused");
  if (!refused("surface=msh:news:v1:*")) fails.push("a free-text pattern is refused");
  if (!refused("surface=history")) fails.push("a surface not on the list (P keys, Friday) is refused");
  if (!refused("surface=pickers mode=delete")) fails.push("delete without confirm is refused");
  if (!refused("surface=pickers mode=delete confirm=profile")) fails.push("delete with a DIFFERENT confirm is refused");
  if (!refused("surface=pickers mode=wipe")) fails.push("an unknown mode is refused");
  if (refused("surface=pickers")) fails.push("a well-formed dry run passes the gates");
  if (refused("surface=pickers mode=delete confirm=pickers")) fails.push("a confirmed delete passes the gates");
  return fails;
}

let failures = 0;
const real = suite(src);
console.log(real.length ? real.map((f) => `  FAIL  ${f}`).join("\n") : "  PASS  every gate refuses what it should and passes what it should");
failures += real.length;

const MUTANTS = [
  ["confirm check removed", 'if (mode === "delete" && arg("confirm") !== surface) {', 'if (false) {'],
  ["free-text surface accepted", "if (!surface || !Object.hasOwn(SURFACES, surface)) {", "if (!surface) {"],
  ["unknown mode accepted", 'if (mode !== "dry" && mode !== "delete") {', "if (false) {"],
];
for (const [label, from, to] of MUTANTS) {
  if (!src.includes(from)) { console.log(`  FAIL  mutant "${label}" no longer matches`); failures++; continue; }
  const caught = suite(src.replace(from, to)).length > 0;
  console.log(`  ${caught ? "PASS" : "FAIL"}  mutant caught: ${label}`);
  if (!caught) failures++;
}

const structural = [
  ["the key cap is checked BEFORE the delete loop", src.indexOf("exceeds the ${MAX_KEYS} cap") > 0 && src.indexOf("exceeds the ${MAX_KEYS} cap") < src.indexOf("redis.unlink(")],
  ["UNLINK is batched by 100", /redis\.unlink\(\.\.\.all\.slice\(i, i \+ 100\)\)/.test(src)],
  ["the first Redis error stops the run", /STOPPED on a Redis error[\s\S]{0,120}process\.exit\(1\)/.test(src)],
  ["counts are re-scanned after a delete", /census\("AFTER \(re-scanned\)"\)/.test(src)],
  ["price/history (P) keys are NOT a surface yet", !/msh:history|msh:price-pool|msh:pickers:v10/.test(src.split("const SURFACES")[1].split("};")[0])],
];
for (const [label, pass] of structural) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failures++;
}
console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
