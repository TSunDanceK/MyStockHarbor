// A TOTAL BESIDE ITS SUB-LINE, FRAME BY FRAME (earnings audit r2).
//
// The total-over-contract rule moves a filer's whole series only when its
// newest period carries both concepts more than 5% apart. Older frames that
// file both kept the contract sub-line (PIPR's years, RITM's FY2023 and Q1
// 2024, RCAT's quarters). Per frame, an as-filed contract cell now takes
// `Revenues` for the same frame when it is larger and filed no earlier.
// Figures are the filers' own ($M, filed month as in companyfacts). Pinned:
// PIPR's years move and its quarters keep; CXT's pre-spin total (filed before
// its restated contract line) does not; SON's smaller, restated `Revenues`
// does not; an excise-tagged filer does not; a series on one concept is not
// mixed by it; and three mutations.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const fxSrc = fs.readFileSync("lib/server/fxRates.ts", "utf8");
const currencySrc = fs.readFileSync("lib/server/secCurrency.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const extractRaw = fs.readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
const load = (src) => lift(`${fieldsSrc}\n${fxSrc}\n${currencySrc}\n${src}`);
const X = await load(extractRaw);
const REV = X.SEC_FIELD_KEYS.indexOf("revenue");
const M = 1e6;
const CONTRACT = "RevenueFromContractWithCustomerExcludingAssessedTax";
// { tag: [[start, end, $M, filed], ...] } -> companyfacts; a ~year is a 10-K row.
const payload = (tags) => ({ cik: 1, entityName: "Fixture", facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, {
  units: { USD: rows.map(([start, end, v, filed]) => {
    const year = (Date.parse(end) - Date.parse(start)) / 864e5 > 300;
    return { start, end, val: v * M, form: year ? "10-K" : "10-Q", fy: Number(end.slice(0, 4)), fp: year ? "FY" : "Q1", filed, accn: `0000000000-${filed.slice(2, 4)}-${filed.slice(5, 7)}0001` };
  }) },
}])) } });
const cell = (ex, kind, end) => ex[kind].find((p) => p.end === end)?.values?.[REV];

console.log("1. PIPR: its years take the filed total; its quarters were already on it");
const PIPR = payload({
  [CONTRACT]: [["2023-01-01", "2023-12-31", 1301.4, "2026-02-26"], ["2024-01-01", "2024-12-31", 1506.6, "2026-02-26"],
    ["2025-01-01", "2025-12-31", 1834.1, "2026-02-26"], ["2026-01-01", "2026-03-31", 459.0, "2026-05-01"]],
  Revenues: [["2023-01-01", "2023-12-31", 1358.1, "2026-02-26"], ["2024-01-01", "2024-12-31", 1531.6, "2026-02-26"],
    ["2025-01-01", "2025-12-31", 1904.2, "2026-02-26"], ["2026-01-01", "2026-03-31", 475.1, "2026-05-01"],
    ["2025-10-01", "2025-12-31", 667.0, "2026-02-26"]],
});
{
  const ex = X.extractCompanyFacts("PIPR", PIPR);
  check("FY2023/2024/2025 read Revenues 1,358.1 / 1,531.6 / 1,904.2",
    [["2023-12-31", 1358.1], ["2024-12-31", 1531.6], ["2025-12-31", 1904.2]].every(([e, v]) => cell(ex, "years", e)?.val === v * M && cell(ex, "years", e)?.tag === "Revenues"),
    JSON.stringify(cell(ex, "years", "2025-12-31")));
  check("Q1 2026 reads Revenues 475.1, not 459.0", cell(ex, "quarters", "2026-03-31")?.val === 475.1 * M);
  check("...and says so in the notes", (ex.notes ?? []).some((n) => /filed beside a smaller contract line/.test(n)));
}

// PIPR's years without its Revenues quarters: one concept, nothing mixed.
const PURE = payload({
  [CONTRACT]: [["2024-01-01", "2024-12-31", 1506.6, "2026-02-26"], ["2025-01-01", "2025-12-31", 1834.1, "2026-02-26"]],
  Revenues: [["2024-01-01", "2024-12-31", 1531.6, "2026-02-26"], ["2025-01-01", "2025-12-31", 1904.2, "2026-02-26"]],
});

console.log("\n2. what does not move");
{
  // CXT: Crane Holdings' pre-spin Q1 2023 total (filed May 2023) beside the
  // restated continuing-operations line (filed May 2024).
  const cxt = payload({
    [CONTRACT]: [["2023-01-01", "2023-03-31", 329.1, "2024-05-02"], ["2024-01-01", "2024-03-31", 313.6, "2025-05-01"]],
    Revenues: [["2023-01-01", "2023-03-31", 842.9, "2023-05-03"]],
  });
  check("CXT Q1 2023: an older total does not replace the restated line (329.1 kept)",
    cell(X.extractCompanyFacts("CXT", cxt), "quarters", "2023-03-31")?.val === 329.1 * M);
  // SON: a smaller `Revenues`, restated after a divestiture, is not a total over a sub-line.
  const son = payload({
    [CONTRACT]: [["2023-01-01", "2023-04-02", 1729.8, "2024-05-01"], ["2024-01-01", "2024-03-31", 1308.6, "2025-05-01"]],
    Revenues: [["2023-01-01", "2023-04-02", 1387.0, "2025-02-27"], ["2024-01-01", "2024-03-31", 1308.6, "2025-02-27"]],
  });
  check("SON Q1 2023: a smaller Revenues is left (1,729.8 kept)", cell(X.extractCompanyFacts("SON", son), "quarters", "2023-04-02")?.val === 1729.8 * M);
  // An excise-tagged filer (COP's shape) stays on its contract line.
  const cop = payload({
    [CONTRACT]: [["2024-01-01", "2024-12-31", 49418, "2025-02-15"], ["2025-01-01", "2025-12-31", 51824, "2026-02-15"]],
    Revenues: [["2024-01-01", "2024-12-31", 54745, "2025-02-15"], ["2025-01-01", "2025-12-31", 52000, "2026-02-15"]],
    ExciseAndSalesTaxes: [["2025-01-01", "2025-12-31", 10, "2026-02-15"]],
  });
  check("an excise-tagged filer keeps its contract line (FY2024 49,418)", cell(X.extractCompanyFacts("COP", cop), "years", "2024-12-31")?.val === 49418 * M);
  // A series wholly on the contract line, its total under 5% above it: the
  // one-concept rule (and its 5% test) leaves it, and so does this.
  check("a series on one concept is not mixed by this (contract 1,834.1 kept)",
    cell(X.extractCompanyFacts("PURE", PURE), "years", "2025-12-31")?.val === 1834.1 * M);
}

console.log("\n3. mutations");
{
  const guard = 'if (!rv || !cr || String(rv.filed ?? "") < String(cr.filed ?? "")) continue;';
  if (extractRaw.split(guard).length !== 2) throw new Error("mutation anchor (vintage guard) not unique");
  const XV = await load(extractRaw.replace(guard, ""));
  const cxt = payload({ [CONTRACT]: [["2023-01-01", "2023-03-31", 329.1, "2024-05-02"]], Revenues: [["2023-01-01", "2023-03-31", 842.9, "2023-05-03"]] });
  check("MUTATION: without the vintage guard CXT's Q1 2023 reads the pre-spin 842.9 (caught)",
    cell(XV.extractCompanyFacts("CXT", cxt), "quarters", "2023-03-31")?.val === 842.9 * M);
  const mixed = '!excise && tagsAsFiled.has("Revenues") && tagsAsFiled.has(CONTRACT_REVENUE_TAG)';
  if (extractRaw.split(mixed).length !== 2) throw new Error("mutation anchor (mixed series) not unique");
  const XM = await load(extractRaw.replace(mixed, "!excise"));
  check("MUTATION: without the mixed-series condition a one-concept series is mixed (caught)",
    cell(XM.extractCompanyFacts("PURE", PURE), "years", "2025-12-31")?.val === 1904.2 * M);
  const start = extractRaw.indexOf("    // ── A TOTAL BESIDE ITS SUB-LINE, FRAME BY FRAME");
  const stop = extractRaw.indexOf("    // ── A BANK'S QUARTERS: NO REVENUE LINE AT ALL");
  const XB = await load(extractRaw.slice(0, start) + extractRaw.slice(stop));
  check("MUTATION: without the block PIPR's FY2025 reads the 1,834.1 contract line (caught)",
    cell(XB.extractCompanyFacts("PIPR", PIPR), "years", "2025-12-31")?.val === 1834.1 * M);
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA total filed beside its sub-line is read for that frame.");
