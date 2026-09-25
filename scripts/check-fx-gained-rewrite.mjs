// A SET WHOSE CONVERSION BECAME POSSIBLE IS REWRITTEN (#552 COWORK #50, CHT).
//
// contentHash is on the reported figures, so adding a rate source (TWD via
// DEXTAUS, #615) moved nothing and the on-demand re-read of CHT reported
// `unchanged=1` with its ten refused periods still stored. conversionGained
// makes that a write; a rate that merely differs for a converted period does not.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// THE SHIPPED FUNCTION, LIFTED ON ITS OWN: it uses only types, and
// secFactBuild's other imports are extensionless (not loadable by bare node).
const SRC = fs.readFileSync("lib/server/secFactBuild.ts", "utf8");
const helperOf = (src) => {
  const at = src.indexOf("export function conversionGained(");
  if (at < 0) throw new Error("conversionGained not found in secFactBuild.ts");
  return `type StoredFactSet = any;\n${src.slice(at)}`;
};
const B = await lift(helperOf(SRC));
const per = (e) => ({ e, s: null, fp: "FY", fy: Number(e.slice(0, 4)), a: null, f: null, v: [], d: "" });
const fx = (refused, rate = 0.0314) => ({ from: "TWD", source: "fred-h10", refused,
  applied: ["2019-12-31", "2024-12-31"].filter((e) => !refused.includes(e)).map((end) => ({ end, usdPerUnit: rate, basis: "average" })) });
const years = [per("2019-12-31"), per("2024-12-31")];

// CHT before: 2024 refused (ECB's TWD leg ended 2020). After: converted.
const priorCht = { fx: { ...fx(["2024-12-31"]), source: "ecb-reference" } };
const freshCht = { fx: fx([]), quarters: [], years, instants: [] };
check("CHT: a period refused before and converted now → rewrite", B.conversionGained(priorCht, freshCht) === true);
check("a rate that differs for an already-converted period → NO rewrite (stored rates stay put)",
  B.conversionGained({ fx: fx([], 0.0300) }, { ...freshCht, fx: fx([], 0.0314) }) === false);
check("still refused → no rewrite", B.conversionGained(priorCht, { ...freshCht, fx: fx(["2024-12-31"]) }) === false);
check("the refused period has left the window (not converted) → no rewrite",
  B.conversionGained({ fx: fx(["2018-12-31"]) }, freshCht) === false);
check("USD filer (no fx on either side) → no rewrite", B.conversionGained({}, { quarters: [], years, instants: [] }) === false);
check("no prior set → false (the job's `prior ? … : true` writes it anyway)", B.conversionGained(null, freshCht) === false);

// Wiring: the job's `changed` includes it.
const route = readCodeOnly("app/api/jobs/sec-facts/route.ts");
check("sec-facts: changed = hash moved || conversionGained(prior, set)",
  /prior\.contentHash !== set\.contentHash \|\| conversionGained\(prior, set\)/.test(route));

// MUTATION: the helper stops looking at refusals → CHT stays unwritten.
{
  const from = "return before.some((end) => !stillRefused.has(end) && present.has(end));";
  if (!SRC.includes(from)) check("mutation could not be applied", false);
  else {
    const M = await lift(helperOf(SRC.replace(from, "return false; void stillRefused; void present;")));
    check("MUTATION: conversionGained always false → CHT's gained periods never written (caught)",
      M.conversionGained(priorCht, freshCht) !== true);
  }
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
