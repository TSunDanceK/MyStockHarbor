// #6-B: THE TARGETED REVENUE FALLBACK (#535 COWORK #12 ruling A).
//
// Where the revenue line is incomplete (operating income above it, or pre-tax
// income where operating is untagged), and ONLY there, revenue is re-read from
// `Revenues`, then `RevenuesNetOfInterestExpense`, for the same period, through
// the same differencing. Pinned on companyfacts-shaped payloads built from the
// newest-quarter figures measured by relay write-spotcheck-census-5:
//   RESCUED   COF  ($2,762M contract revenue -> $15,850M Revenues)
//             SOFI ($153.6M -> $1,218.7M RevenuesNetOfInterestExpense)
//             UDR  ($2.5M -> $425.8M Revenues), and a DERIVED quarter (Q2 from
//             6M YTD minus Q1) rescued through the same differencing
//   REFUSED   OHI (fallback $328.2M < operating $330.9M), VS (fallback $0.0M
//             < $0.6M), MTB (no fallback tag at all)
//   UNTOUCHED a filer whose line is complete keeps its figure even though a
//             larger `Revenues` exists — nothing outside a flagged period moves
// plus a mutation: the substitution removed, and the rescued cases fail.
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
const load = (extractSrc) => lift(`${fieldsSrc}\n${fxSrc}\n${currencySrc}\n${extractSrc}`);
const X = await load(extractRaw);
const REV = X.SEC_FIELD_KEYS.indexOf("revenue");

const M = 1e6;
const row = (start, end, val, fp = "Q2") => ({ start, end, val, accn: "0000000000-26-000001", fy: 2026, fp, form: "10-Q", filed: "2026-08-01" });
/** A companyfacts payload: { tag: [[start, end, val], ...] } in USD. */
const payload = (tags) => ({
  cik: 1, entityName: "Fixture",
  facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, { units: { USD: rows.map(([s, e, v]) => row(s, e, v)) } }])) },
});
const Q = ["2026-04-01", "2026-06-30"];
const quarterRevenue = (facts) => {
  const q = X.extractCompanyFacts("FIX", facts).quarters.find((p) => p.end === "2026-06-30");
  return { val: q?.values?.[REV]?.val ?? null, tag: q?.values?.[REV]?.tag ?? null };
};
const OP = "OperatingIncomeLoss";
const PRE = "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest";
const CONTRACT = "RevenueFromContractWithCustomerExcludingAssessedTax";

const CASES = {
  COF: [{ [CONTRACT]: [[...Q, 2762 * M]], Revenues: [[...Q, 15850 * M]], [PRE]: [[...Q, 3900 * M]] }, 15850 * M, "Revenues"],
  SOFI: [{ [CONTRACT]: [[...Q, 153.6 * M]], RevenuesNetOfInterestExpense: [[...Q, 1218.7 * M]], [PRE]: [[...Q, 204.3 * M]] }, 1218.7 * M, "RevenuesNetOfInterestExpense"],
  UDR: [{ [CONTRACT]: [[...Q, 2.5 * M]], Revenues: [[...Q, 425.8 * M]], [OP]: [[...Q, 229.8 * M]] }, 425.8 * M, "Revenues"],
  OHI: [{ [CONTRACT]: [[...Q, 12 * M]], Revenues: [[...Q, 328.2 * M]], [OP]: [[...Q, 330.9 * M]] }, 12 * M, CONTRACT],
  VS: [{ [CONTRACT]: [[...Q, 0.1 * M]], Revenues: [[...Q, 0]], [OP]: [[...Q, 0.6 * M]] }, 0.1 * M, CONTRACT],
  MTB: [{ [CONTRACT]: [[...Q, 480 * M]], [PRE]: [[...Q, 900 * M]] }, 480 * M, CONTRACT],
  COMPLETE: [{ [CONTRACT]: [[...Q, 100 * M]], Revenues: [[...Q, 120 * M]], [OP]: [[...Q, 30 * M]] }, 100 * M, CONTRACT],
};
console.log("1. rescued, refused, untouched");
for (const [sym, [tags, want, tag]] of Object.entries(CASES)) {
  const got = quarterRevenue(payload(tags));
  const verdict = sym === "COMPLETE" ? "untouched (line complete)" : want === (tags[CONTRACT]?.[0]?.[2]) ? "stays refused" : "rescued";
  check(`${sym}: ${verdict} — ${(want / M).toFixed(1)}M from ${tag}`, got.val === want && got.tag === tag, JSON.stringify(got));
}

console.log("\n2. a derived quarter is rescued through the same differencing");
{
  const facts = payload({
    [CONTRACT]: [["2026-01-01", "2026-03-31", 2.4 * M], ["2026-01-01", "2026-06-30", 4.9 * M]],
    Revenues: [["2026-01-01", "2026-03-31", 410 * M], ["2026-01-01", "2026-06-30", 835.8 * M]],
    [OP]: [["2026-01-01", "2026-03-31", 220 * M], ["2026-01-01", "2026-06-30", 449.8 * M]],
  });
  const q2 = X.extractCompanyFacts("FIX", facts).quarters.find((p) => p.end === "2026-06-30");
  const v = q2?.values?.[REV];
  check("Q2 = H1 − Q1 of Revenues (425.8M), differenced, not the contract line",
    Math.abs((v?.val ?? 0) - 425.8 * M) < 1 && v?.tag === "Revenues" && v?.derived === "differenced", JSON.stringify(v));
}

console.log("\n3. nothing outside a flagged period moves");
{
  // Two quarters: Q1 complete (contract 100 > op 30), Q2 flagged (contract 2 < op 50).
  const facts = payload({
    [CONTRACT]: [["2026-01-01", "2026-03-31", 100 * M], ["2026-04-01", "2026-06-30", 2 * M]],
    Revenues: [["2026-01-01", "2026-03-31", 140 * M], ["2026-04-01", "2026-06-30", 160 * M]],
    [OP]: [["2026-01-01", "2026-03-31", 30 * M], ["2026-04-01", "2026-06-30", 50 * M]],
  });
  const qs = X.extractCompanyFacts("FIX", facts).quarters;
  const q1 = qs.find((p) => p.end === "2026-03-31")?.values?.[REV];
  const q2 = qs.find((p) => p.end === "2026-06-30")?.values?.[REV];
  check("the complete quarter keeps its own line", q1?.val === 100 * M && q1?.tag === CONTRACT, JSON.stringify(q1));
  check("...while the flagged one beside it is rescued", q2?.val === 160 * M && q2?.tag === "Revenues", JSON.stringify(q2));
}

console.log("\n4. the one predicate");
check("the pages' refusal and the extractor share revenueLineIncompleteValues",
  /revenueLineIncompleteValues\(valueOf\(p, "revenue"\), valueOf\(p, "operatingIncome"\), valueOf\(p, "preTaxIncome"\)\)/.test(fs.readFileSync("lib/server/secEarningsView.ts", "utf8")) &&
    /if \(!revenueLineIncompleteValues\(rev, op, pre\)\) continue;/.test(extractRaw));
check("the fallback chain is the ruled one", JSON.stringify(X.REVENUE_FALLBACK_CHAIN) === JSON.stringify(["Revenues", "RevenuesNetOfInterestExpense"]));

console.log("\n5. mutation");
{
  const mutated = extractRaw.replace('        m.set("revenue", fb);\n', "");
  check("the mutation applied", mutated !== extractRaw);
  const XM = await load(mutated);
  const got = XM.extractCompanyFacts("FIX", payload(CASES.UDR[0])).quarters.find((p) => p.end === "2026-06-30")?.values?.[REV]?.val;
  check("MUTATION: without the substitution UDR is not rescued", got === 2.5 * M, String(got));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nThe revenue fallback reaches only the flagged periods.");
