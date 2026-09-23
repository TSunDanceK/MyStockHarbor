// CITED EXCEPTIONS TO THE FISCAL-YEAR NAMING VOTE (#535 COWORK #12 on #2).
//
// data/sec/fiscal-year-naming-overrides.json carries reviewed per-filer
// exceptions, used only where the vote disagrees. Pinned here:
//   1. every entry is cited (a filing, a date, the company's own name for the
//      year) and its offset is a naming convention (0 or +1);
//   2. applyNamingOverride, run: the vote stands when there is no entry or the
//      two agree, and only a listed filer's offset moves;
//   3. CRWD, extracted from a CRWD-shaped payload: Q2 FY2026 by the vote, Q2
//      FY2027 with the entry — the company's own name;
//   4. AAP, CRM, PFGC, NTAP, ORCL and UHAL have no entry (the vote is right for
//      them, measured in CODE #19), so nothing about them can move;
//   5. every app caller extracts through secExtractFor, so an entry cannot
//      reach one writer and miss another.
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const FILE = JSON.parse(fs.readFileSync("data/sec/fiscal-year-naming-overrides.json", "utf8"));
console.log("1. every entry is cited");
check("the file has entries", Array.isArray(FILE.overrides) && FILE.overrides.length > 0);
for (const o of FILE.overrides) {
  check(`${o.symbol}: numeric CIK, offset 0 or +1, dated`,
    Number.isInteger(o.cik) && (o.offset === 0 || o.offset === 1) && /^\d{4}-\d{2}-\d{2}$/.test(o.addedOn ?? ""), JSON.stringify(o).slice(0, 120));
  check(`${o.symbol}: the citation names the filing, its date and the company's own name for the year`,
    /\b(10-K|20-F|40-F)\b/.test(o.citation ?? "") && /\d{4}-\d{2}-\d{2}/.test(o.citation ?? "") && /fiscal \d{4}/i.test(o.citation ?? ""),
    o.citation?.slice(0, 100));
}
check("one entry per CIK", new Set(FILE.overrides.map((o) => o.cik)).size === FILE.overrides.length);

// secExtract lifts with its two sibling modules, as check-sec-extract does.
const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const fxSrc = fs.readFileSync("lib/server/fxRates.ts", "utf8");
const currencySrc = fs.readFileSync("lib/server/secCurrency.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const extractSrc = fs.readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
const X = await lift(`${fieldsSrc}\n${fxSrc}\n${currencySrc}\n${extractSrc}`);

console.log("\n2. applyNamingOverride, run");
const vote = { offset: 0, basis: "annual", agreeing: 3, disagreeing: 1, yearEnd: "2026-01-31" };
check("no entry: the vote stands", X.applyNamingOverride(vote, undefined) === vote);
check("an entry that agrees: the vote stands", X.applyNamingOverride(vote, 0) === vote);
check("an entry that disagrees: its offset, marked overridden",
  X.applyNamingOverride(vote, 1).offset === 1 && X.applyNamingOverride(vote, 1).overridden === true);
check("an offset that is not a naming convention is ignored", X.applyNamingOverride(vote, 2) === vote);

console.log("\n3. CRWD, extracted");
{
  const r = (start, end, val, form, fp, fy) => ({ start, end, val, accn: `0001535527-26-${form === "10-K" ? "000010" : "000020"}`, fy, fp, form, filed: form === "10-K" ? "2026-03-05" : "2026-08-28" });
  const facts = {
    cik: 1535527, entityName: "CrowdStrike Holdings, Inc.",
    facts: { "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
        r("2025-02-01", "2026-01-31", 4_800e6, "10-K", "FY", 2025),
        r("2026-05-01", "2026-07-31", 1_300e6, "10-Q", "Q2", 2026),
      ] } },
    } },
  };
  const label = (opts) => { const q = X.extractCompanyFacts("CRWD", facts, opts).quarters.find((p) => p.end === "2026-07-31"); return q ? `${q.fp} FY${q.fy}` : "missing"; };
  const byVote = label({});
  const entry = FILE.overrides.find((o) => o.symbol === "CRWD");
  const withEntry = label({ namingOffset: entry?.offset });
  check("by the vote alone: Q2 FY2026 (the defect)", byVote === "Q2 FY2026", byVote);
  check("with the cited entry: Q2 FY2027, the company's own name", withEntry === "Q2 FY2027", withEntry);
}

console.log("\n4. the filers the vote gets right are not listed");
{
  const t = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
  const i = t.fields.indexOf("ticker"), c = t.fields.indexOf("cik");
  const cikOf = new Map(t.data.map((row) => [row[i], Number(row[c])]));
  const listed = new Set(FILE.overrides.map((o) => o.cik));
  for (const s of ["AAP", "CRM", "PFGC", "NTAP", "ORCL", "UHAL"]) {
    check(`${s} has no entry`, cikOf.has(s) && !listed.has(cikOf.get(s)), `cik ${cikOf.get(s)}`);
  }
}

console.log("\n5. one way in");
{
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []);
  const direct = [...walk("app"), ...walk("lib")]
    .filter((f) => !["lib/server/secExtract.ts", "lib/server/secExtractFor.ts"].includes(f))
    .filter((f) => /\bextractCompanyFacts\(/.test(readCodeOnly(f)));
  check("no app file calls extractCompanyFacts directly — every caller goes through extractForSymbol",
    direct.length === 0, direct.join(", ") || "none");
  check("the wrapper passes the entry by CIK", /namingOffset: namingOffsetFor\(facts\.cik\)/.test(readCodeOnly("lib/server/secExtractFor.ts")));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nNaming exceptions are cited and reach every writer.");
