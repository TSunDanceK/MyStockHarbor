// A weighted term that is the same for every candidate cannot rank anything.
//
// `const recencyScore = 100` sat in computeOversoldCandidate's weighted sum and
// contributed `recencyScore * 0.05` -- a flat 5.00 on every candidate. It read
// as a considered weight and did no work, so that composite had FIVE
// discriminating terms and looked like six.
//
// This is not a one-off: /api/debug/picker-structure carries two "modes" that
// are identical by construction for the same class of reason (see
// claude/picker-structure-findings-2026-08-22.md). A term that cannot separate
// anything is invisible in output and obvious in source, so source is where to
// catch it.
//
//   node scripts/check-inert-terms.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = "lib/server/pickersBuilder.ts";
const raw = fs.readFileSync(path.join(ROOT, SRC), "utf8");
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => (l.trim().startsWith("//") ? "" : l))
  .join("\n");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Every `const NAME = <bare number>;` inside the file, paired with whether that
// NAME is later multiplied by a weight -- i.e. used as a scoring term rather
// than as a threshold or a cap. A threshold compared with `<` is fine; a
// constant multiplied into a weighted sum is the defect.
console.log("\n=== 1. No constant is used as a weighted scoring term ===\n");
const constAssignments = [...code.matchAll(/\bconst (\w+) = (-?\d+(?:\.\d+)?);/g)].map((m) => ({
  name: m[1],
  value: m[2],
}));
check("the scan found constants to check", constAssignments.length > 0, `${constAssignments.length} numeric consts`);

const offenders = constAssignments.filter(({ name }) =>
  new RegExp(`\\b${name}\\s*\\*\\s*0?\\.\\d+`).test(code)
);
check(
  "no numeric constant is multiplied by a weight",
  offenders.length === 0,
  offenders.map((o) => `${o.name} = ${o.value}`).join(", ")
);

console.log("\n=== 2. The specific term is gone, and the real ones are untouched ===\n");
check(
  "the flat `const recencyScore = 100` is gone",
  !/const recencyScore = 100;/.test(code)
);
check(
  "...and its weight went with it, rather than being left dangling",
  !/recencyScore \* 0\.05/.test(code),
  "a removed variable still referenced would not compile, but a removed REFERENCE with the const left behind would"
);
// The other two recencyScore bindings are real: they vary per symbol with
// breakout age. Removing the flat one must not have touched them.
const realOnes = [...code.matchAll(/const recencyScore = ([^;]+);/g)].map((m) => m[1].trim());
check(
  "the two breakout recencyScores survive and are computed, not constant",
  realOnes.length === 2 && realOnes.every((r) => /scoreInverse\(/.test(r)),
  realOnes.join(" | ") || "none found"
);

console.log("\n=== 3. Why removal cannot change any ordering ===\n");
// Arithmetic, stated rather than tested, because it is a property of the
// expression and not of any data: the term was `C * w` with C and w both
// literal, inside a numerator divided by `keep`, which is constant per mode. So
// every candidate in a mode moved by exactly the same amount and no pair could
// swap. The scores DO shift -- about 5.00 on the live path and 5.26 where the
// divisor is 0.95 -- which is the whole of the visible effect.
const oversold = (code.match(/function computeOversoldCandidate[\s\S]*?\n\}/) ?? [""])[0];
check(
  "the removed term was inside the numerator divided by `keep`",
  /\) \/\s*\n?\s*keep -/.test(oversold),
  "so the shift is uniform per mode"
);
check(
  "`keep` is per-mode constant, not per-symbol",
  /const keep = mode === "live" \? 1 : 1 - STRUCTURE_WEIGHT;/.test(oversold)
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
