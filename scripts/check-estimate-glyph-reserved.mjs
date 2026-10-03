// "≈" IS RESERVED FOR ESTIMATES (#553 COWORK #107/#109, 2026-10-03).
//
// A's estimate layer (#696) made "≈" mean "this figure is an estimate"
// site-wide (app/components/estimateMark.ts ESTIMATE_SIGN). Any other "≈" a
// reader can see -- the old ATR Spike nav icon, a lesson's arithmetic -- now
// reads as an estimate mark. This fails if "≈" appears in the CODE (comments
// stripped) of any app/ or lib/ source outside A's estimate files, and checks
// the ATR Spike icon is not "≈". Mutants: each rule broken once, caught.
//
//   node scripts/check-estimate-glyph-reserved.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const SIGN = "≈";
// A's estimate layer: where "≈" is the estimate mark (or its server-side note).
const ALLOWED = new Set([
  "app/components/estimateMark.ts",
  "app/components/EstimatedValue.tsx",
  "app/components/EstimateKey.tsx",
  "lib/server/secEstimates.ts",
  "lib/server/secValuation.ts",
]);
const NAV = "app/components/ScreenerNav.tsx";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(rel, out); }
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push(rel.split(path.sep).join("/"));
  }
  return out;
}

/** Files (relative) whose code, comments stripped, shows "≈" outside A's layer. `over` replaces a file's source. */
function offenders(over = {}) {
  const bad = [];
  for (const rel of [...walk("app"), ...walk("lib")]) {
    if (ALLOWED.has(rel)) continue;
    const raw = over[rel] ?? fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (!raw.includes(SIGN)) continue;
    let code;
    try { code = stripComments(raw, { file: rel }); } catch { code = raw; }
    if (code.includes(SIGN)) bad.push(rel);
  }
  return bad;
}
const atrIcon = (src) => /label: "ATR Spike", icon: "([^"]*)"/.exec(stripComments(src, { file: NAV }))?.[1] ?? null;

const navSrc = fs.readFileSync(path.join(ROOT, NAV), "utf8");
const real = offenders();
check("no \"≈\" in app/ or lib/ code outside A's estimate files", real.length === 0, real.join(", "));
const icon = atrIcon(navSrc);
check("the ATR Spike nav icon is set and is not \"≈\"", Boolean(icon) && icon !== SIGN, String(icon));

console.log("\n  mutants (each must be caught)");
{
  const mut = navSrc.replace(/label: "ATR Spike", icon: "[^"]*"/, `label: "ATR Spike", icon: "${SIGN}"`);
  check(`mutant "the ATR Spike icon back to ≈" is caught`, mut !== navSrc && offenders({ [NAV]: mut }).length > 0 && atrIcon(mut) === SIGN);
  const LESSONS = "app/learn/lessons.ts";
  const ls = fs.readFileSync(path.join(ROOT, LESSONS), "utf8");
  const from = "$200 ÷ $6 = 33.3, so 33 shares";
  const lm = ls.replace(from, `$200 ÷ $6 ${SIGN} 33 shares`);
  check(`mutant "a lesson's arithmetic uses ≈ again" is caught`, ls.includes(from) && offenders({ [LESSONS]: lm }).includes(LESSONS));
  const cm = navSrc.replace(`// 2026-10-03`, `// ${SIGN} 2026-10-03`);
  check(`control: "≈" inside a comment is not flagged`, cm !== navSrc && offenders({ [NAV]: cm }).length === 0);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
