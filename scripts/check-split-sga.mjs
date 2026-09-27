// SPLIT SG&A: SALES & MARKETING + G&A, SUMMED (#552 COWORK #40, CODE-A #33).
//
// GOOGL files GeneralAndAdministrativeExpense (Q2 FY2026: 6.46B) and
// SellingAndMarketingExpense (8.40B) and no SellingGeneralAndAdministrativeExpense.
// The chain fell through to G&A alone, the lines missed operating income by
// 8.41B and the waterfall was hidden. Pinned on companyfacts-shaped payloads:
//   GOOGL     three-month rows: SG&A = 14.86B, tagged SUMMED_SGA_TAG, recorded
//             in summedSga; 119.80 - 45.94 - 18.22 - 14.86 = 40.78 vs 40.77 filed
//   YTD-ONLY  Q2 from 6M YTD minus Q1, both summed: the differencing still works
//   COMBINED  the 18-filer case: the combined tag filed beside the parts wins,
//             nothing is synthesized, nothing is double counted
//   G&A ONLY  no selling line: unchanged (G&A, as before)
// plus mutations: the combined-tag guard removed, and the synthetic tag ranked
// above the combined one; both must fail. And the labels are wired.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

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
const load = (fields = fieldsSrc, extract = extractRaw) => lift(`${fields}\n${fxSrc}\n${currencySrc}\n${extract}`);
const X = await load();
const SGA = X.SEC_FIELD_KEYS.indexOf("sellingGeneralAndAdministrative");

const B = 1e9;
const ACCN = "0001652044-26-000070";
const row = (start, end, val, fp = "Q2", accn = ACCN) => ({ start, end, val, accn, fy: 2026, fp, form: "10-Q", filed: "2026-07-24" });
const payload = (tags) => ({
  cik: 1652044, entityName: "Fixture",
  facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, { units: { USD: rows.map((r) => row(...r)) } }])) },
});
const Q2 = ["2026-04-01", "2026-06-30"];
const sgaOf = (x, facts, end = "2026-06-30") => {
  const res = x.extractCompanyFacts("FIX", facts);
  const q = res.quarters.find((p) => p.end === end);
  return { val: q?.values?.[SGA]?.val ?? null, tag: q?.values?.[SGA]?.tag ?? null, summed: res.summedSga ?? [] };
};

console.log("\n1. GOOGL, three-month rows");
const GOOGL = payload({
  Revenues: [[...Q2, 119.80 * B]], CostOfRevenue: [[...Q2, 45.94 * B]], ResearchAndDevelopmentExpense: [[...Q2, 18.22 * B]],
  GeneralAndAdministrativeExpense: [[...Q2, 6.46 * B]], SellingAndMarketingExpense: [[...Q2, 8.40 * B]], OperatingIncomeLoss: [[...Q2, 40.77 * B]],
});
const g = sgaOf(X, GOOGL);
check("SG&A = G&A 6.46B + S&M 8.40B = 14.86B", Math.abs(g.val - 14.86 * B) < 1, String(g.val));
check("...tagged with the synthetic tag, never as a filed combined SG&A", g.tag === X.SUMMED_SGA_TAG, String(g.tag));
check("...and recorded in summedSga as start|end", g.summed.includes("2026-04-01|2026-06-30"), JSON.stringify(g.summed));
const reach = 119.80 - 45.94 - 18.22 - g.val / B;
check("the lines now reach filed operating income (40.78 vs 40.77, inside rounding)", Math.abs(reach - 40.77) < 0.02, reach.toFixed(2));

console.log("\n2. YTD-only filer: Q2 = 6M - Q1, both summed");
const YTD = payload({
  GeneralAndAdministrativeExpense: [["2026-01-01", "2026-03-31", 4 * B, "Q1"], ["2026-01-01", "2026-06-30", 9 * B, "Q2"]],
  SellingAndMarketingExpense: [["2026-01-01", "2026-03-31", 6 * B, "Q1"], ["2026-01-01", "2026-06-30", 13 * B, "Q2"]],
});
const y = sgaOf(X, YTD);
check("Q2 SG&A = (9 + 13) - (4 + 6) = 12B", Math.abs(y.val - 12 * B) < 1, String(y.val));
check("...still labelled as summed", y.summed.some((k) => k.endsWith("|2026-06-30")), JSON.stringify(y.summed));

console.log("\n3. The combined tag filed beside the parts wins (the 18-filer case)");
const COMBINED = payload({
  SellingGeneralAndAdministrativeExpense: [[...Q2, 10 * B]],
  GeneralAndAdministrativeExpense: [[...Q2, 4 * B]], SellingAndMarketingExpense: [[...Q2, 5 * B]],
});
const c = sgaOf(X, COMBINED);
check("SG&A = the filed 10B, not 4 + 5", c.val === 10 * B && c.tag === "SellingGeneralAndAdministrativeExpense", `${c.val} ${c.tag}`);
check("nothing synthesized for a period that has the combined tag", !X.withSummedSga(COMBINED).facts["us-gaap"][X.SUMMED_SGA_TAG]);
check("...and not labelled summed", c.summed.length === 0);

console.log("\n4. G&A with no selling line: unchanged");
const GAONLY = payload({ GeneralAndAdministrativeExpense: [[...Q2, 3 * B]] });
const o = sgaOf(X, GAONLY);
check("SG&A = G&A 3B, tagged G&A", o.val === 3 * B && o.tag === "GeneralAndAdministrativeExpense", `${o.val} ${o.tag}`);
check("the payload is returned untouched (same object)", X.withSummedSga(GAONLY) === GAONLY);
const OTHERFILING = payload({ GeneralAndAdministrativeExpense: [[...Q2, 3 * B]] });
OTHERFILING.facts["us-gaap"].SellingAndMarketingExpense = { units: { USD: [row(...Q2, 2 * B, "Q2", "0000000000-26-999999")] } };
check("parts from DIFFERENT filings are not summed", sgaOf(X, OTHERFILING).tag === "GeneralAndAdministrativeExpense");

console.log("\n5. mutations");
{
  const guard = "      if (combined.has(`${r.start}|${r.end}`)) continue;\n";
  const M1 = await load(fieldsSrc, extractRaw.replace(guard, ""));
  check("MUTATION: combined-tag guard removed → parts synthesized beside the filed total (caught)",
    extractRaw.includes(guard) && Boolean(M1.withSummedSga(COMBINED).facts["us-gaap"][M1.SUMMED_SGA_TAG]));
  const chain = 'chain: ["SellingGeneralAndAdministrativeExpense", SUMMED_SGA_TAG, "GeneralAndAdministrativeExpense"]';
  const M2 = await load(fieldsSrc.replace(chain, 'chain: [SUMMED_SGA_TAG, "SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"]'), extractRaw.replace(guard, ""));
  const m2 = sgaOf(M2, COMBINED);
  check("MUTATION: guard removed AND the sum ranked above the combined tag → 9B double count appears (caught)",
    fieldsSrc.includes(chain) && m2.val === 9 * B, `${m2.val}`);
}

console.log("\n6. wiring");
const view = readCodeOnly("lib/server/secEarningsView.ts"), pres = readCodeOnly("lib/server/secPresentation.ts"), codec = readCodeOnly("lib/server/secFactCodec.ts");
check("the codec stores summedSga as `sg`", /sg: result\.summedSga/.test(codec));
check("the view labels the row 'Sales & marketing + G&A' from set.sg on the latest period",
  /SGA_SUMMED_LABEL = "Sales & marketing \+ G&A"/.test(view) && /set\.sg\?\.includes\(`\$\{latest\.s \?\? ""\}\|\$\{latest\.e\}`\)/.test(view));
check("the waterfall bar reads 'S&M + G&A' when summed", /view\.sgaSummed \? "S&M \+ G&A" : "SG&A"/.test(pres));
check("secFieldsHash did NOT move (no new field: a moved hash makes every stored set unreadable)",
  X.secFieldsHash() === (await load(fieldsSrc.replace(/SUMMED_SGA_TAG, "GeneralAndAdministrativeExpense"/, '"GeneralAndAdministrativeExpense"'))).secFieldsHash());

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
