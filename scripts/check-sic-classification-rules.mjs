// THE 10-K RULES PASS (scripts/build-sic-classification.mjs), RUN on small
// synthetic inputs against the committed table and rules (#552 COWORK #22/#23/#26).
//
//   1. The self-description sentence decides first, by rule order.
//   2. Customer mentions, acquisitions and service lists are skipped.
//   3. CROSS-SECTOR codes let a rule move the filer out of the table's sector
//      (3559 "wafer" → Semiconductors); a plain code does not. MUTATION: the
//      crossSector switch ignored.
//   4. SELF-ONLY rules count only inside the self-description sentence of a
//      catch-all code. MUTATION: selfOnly ignored.
//   5. Two REIT property types in one sentence → REIT - Diversified.
//   And the committed overrides file is current (build --check).
//
//   node scripts/check-sic-classification-rules.mjs
import fs from "node:fs";
import { execFileSync } from "node:child_process";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const SRC = fs.readFileSync("scripts/build-sic-classification.mjs", "utf8");
const load = async (src) => {
  const f = `scripts/.sic-rules-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`;
  fs.writeFileSync(f, src);
  try { return await import(`${process.cwd()}/${f}`); } finally { fs.rmSync(f, { force: true }); }
};
const table = read("data/sec/sic-classification.json");
const rules = read("data/sec/classification-rules.json");
const run = (M, rows) => {
  const registrants = {}, descriptions = {};
  for (const [sym, sic, text] of rows) { registrants[sym] = { sic }; descriptions[sym] = ["10-K", "2026-02-01", "0000000000-26-000001", text]; }
  return M.buildOverrides({ registrants, table, rules, descriptions }).overrides;
};
const B = await load(SRC);

const CASES = [
  ["AAA", "2834", "We are a biopharmaceutical company developing generic and proprietary injectable products."],
  ["BBB", "7389", "Most leading banks and credit card issuers rely on our solutions. We sell analytics."],
  ["CCC", "3559", "Acme is a leading supplier of wafer processing equipment for chipmakers."],
  ["DDD", "3560", "Acme is a leading supplier of wafer processing equipment for chipmakers."],
  ["EEE", "7370", "Zeta is a technology platform for small businesses."],
  ["FFF", "7370", "We sell tools. Our partners include a technology platform for small businesses."],
  ["GGG", "6798", "We are a REIT that owns office and multifamily properties in coastal markets."],
];
const o = run(B, CASES);

console.log("1-2. self-description first; customers skipped");
check("the specific rule wins inside the self sentence (generic injectables)", o.AAA?.industry === "Drug Manufacturers - Specialty & Generic", JSON.stringify(o.AAA));
check("'credit card issuers rely on our solutions' is a customer, not the business", o.BBB?.industry !== "Financial - Credit Services");

console.log("\n3. cross-sector codes");
check("3559 (cross-sector): 'wafer' → Semiconductors, in Technology", o.CCC?.industry === "Semiconductors" && o.CCC?.sector === "Technology", JSON.stringify(o.CCC));
check("3560 (plain table code): no override, the table's Industrials stands", !o.DDD);
{
  const M = await load(SRC.replace("const scope = entry?.crossSector ? null : entry?.sector ?? null;", "const scope = entry?.sector ?? null;"));
  check("MUTATION: crossSector ignored → 3559 stays in Industrials", run(M, CASES).CCC?.industry !== "Semiconductors");
}

console.log("\n4. self-only rules");
check("inside the self sentence of a catch-all code: counts", o.EEE?.industry === "Software - Application", JSON.stringify(o.EEE));
check("outside it (a partner's description): does not", o.FFF?.industry !== "Software - Application");
{
  const M = await load(SRC.replace("selfOnly: Boolean(r.selfOnly),", "selfOnly: false,"));
  check("MUTATION: selfOnly ignored → the stray mention counts again", run(M, CASES).FFF?.industry === "Software - Application");
}

console.log("\n5. REIT property types");
check("office + multifamily in one sentence → REIT - Diversified", o.GGG?.industry === "REIT - Diversified", JSON.stringify(o.GGG));

console.log("\n6. the committed file is current");
check("classification-overrides.json matches the rules",
  (() => { try { execFileSync("node", ["scripts/build-sic-classification.mjs", "--check"], { stdio: "pipe" }); return true; } catch { return false; } })());

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
