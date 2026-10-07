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
//   UNTOUCHED (flagged-period rule) nothing outside a flagged period moves
//   TOTAL     (#552 COWORK #192 ruling A, superseding #535 COWORK #12 ruling A
//             for this case) a filer whose newest `Revenues` is > 5% above its
//             contract line takes `Revenues` for every period -- AFRM -- unless
//             it tags excise (COP, CEG: kept on the contract line)
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
  // OHI: the flagged-period fallback still refuses ($328.2M < $330.9M operating);
  // ruling A then makes `Revenues` its one concept, and the PAGE still refuses
  // the period through revenueLineIncompleteValues (checked below).
  OHI: [{ [CONTRACT]: [[...Q, 12 * M]], Revenues: [[...Q, 328.2 * M]], [OP]: [[...Q, 330.9 * M]] }, 328.2 * M, "Revenues"],
  VS: [{ [CONTRACT]: [[...Q, 0.1 * M]], Revenues: [[...Q, 0]], [OP]: [[...Q, 0.6 * M]] }, 0.1 * M, CONTRACT],
  MTB: [{ [CONTRACT]: [[...Q, 480 * M]], [PRE]: [[...Q, 900 * M]] }, 480 * M, CONTRACT],
  // Was "COMPLETE … keeps its figure"; ruling A (b) now takes the total.
  TOTAL: [{ [CONTRACT]: [[...Q, 100 * M]], Revenues: [[...Q, 120 * M]], [OP]: [[...Q, 30 * M]] }, 120 * M, "Revenues"],
  // Within 5%: the contract line stays.
  NEAR: [{ [CONTRACT]: [[...Q, 100 * M]], Revenues: [[...Q, 104 * M]], [OP]: [[...Q, 30 * M]] }, 100 * M, CONTRACT],
  // Excise-tagged (COP ×1.11, CEG ×1.39 in the #198 census): excluded.
  COP: [{ [CONTRACT]: [[...Q, 31588 * M]], Revenues: [[...Q, 34922 * M]], [OP]: [[...Q, 4000 * M]], ExciseAndSalesTaxes: [[...Q, 100 * M]] }, 31588 * M, CONTRACT],
  CEG: [{ [CONTRACT]: [[...Q, 13384 * M]], Revenues: [[...Q, 18626 * M]], [OP]: [[...Q, 1500 * M]], ExciseAndSalesTaxes: [[...Q, 50 * M]] }, 13384 * M, CONTRACT],
};
console.log("1. rescued, refused, untouched");
for (const [sym, [tags, want, tag]] of Object.entries(CASES)) {
  const got = quarterRevenue(payload(tags));
  const verdict = sym === "OHI" ? "stores the total; the page still refuses it" : ["NEAR", "COP", "CEG"].includes(sym) ? "keeps the contract line" : sym === "TOTAL" ? "takes the total" : want === (tags[CONTRACT]?.[0]?.[2]) ? "stays refused" : "rescued";
  check(`${sym}: ${verdict} — ${(want / M).toFixed(1)}M from ${tag}`, got.val === want && got.tag === tag, JSON.stringify(got));
}

check("OHI's stored total is still below operating income, so the pages' shared predicate refuses it",
  X.revenueLineIncompleteValues(328.2 * M, 330.9 * M, null) === true);

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

console.log("\n3b. AFRM: the total becomes the filer's one concept (#552 COWORK #192 ruling A)");
{
  // FY2025 / FY2024 years and the newest quarter: Revenues filed for all of them.
  const yr = (s, e, v) => [s, e, v];
  const facts = payload({
    [CONTRACT]: [yr("2024-07-01", "2025-06-30", 1110 * M), yr("2023-07-01", "2024-06-30", 830 * M), ["2026-04-01", "2026-06-30", 380 * M]],
    Revenues: [yr("2024-07-01", "2025-06-30", 3220 * M), yr("2023-07-01", "2024-06-30", 2320 * M), ["2026-04-01", "2026-06-30", 1100 * M]],
    [OP]: [yr("2024-07-01", "2025-06-30", 50 * M), yr("2023-07-01", "2024-06-30", -500 * M), ["2026-04-01", "2026-06-30", 90 * M]],
  });
  const r = X.extractCompanyFacts("AFRM", facts);
  const fy25 = r.years.find((p) => p.end === "2025-06-30")?.values?.[REV];
  const fy24 = r.years.find((p) => p.end === "2024-06-30")?.values?.[REV];
  check("FY2025 reads the $3.22B total, not the $1.11B contract line", fy25?.val === 3220 * M && fy25?.tag === "Revenues", JSON.stringify(fy25));
  check("...and FY2024 the $2.32B total (one concept for the filer)", fy24?.val === 2320 * M && fy24?.tag === "Revenues", JSON.stringify(fy24));
  // Five years, `Revenues` on the newest four (the floor's window) but not the
  // oldest: the floor holds, and the oldest year reads Not reported.
  const fy = (y, c, r) => [yr(`${y - 1}-07-01`, `${y}-06-30`, c * M), r == null ? null : yr(`${y - 1}-07-01`, `${y}-06-30`, r * M)];
  const years5 = [fy(2026, 1440, 4260), fy(2025, 1110, 3220), fy(2024, 830, 2320), fy(2023, 600, 1590), fy(2022, 450, null)];
  const gap = payload({
    [CONTRACT]: years5.map(([c]) => c),
    Revenues: years5.map(([, r]) => r).filter(Boolean),
    [OP]: years5.map(([c]) => [c[0], c[1], 10 * M]),
  });
  const gr = X.extractCompanyFacts("AFRM", gap);
  const old = gr.years.find((p) => p.end === "2022-06-30")?.values?.[REV];
  const fy26 = gr.years.find((p) => p.end === "2026-06-30")?.values?.[REV];
  check("the floor holds (Revenues on the newest 4 years) and the total is used", fy26?.val === 4260 * M && fy26?.tag === "Revenues", JSON.stringify(fy26));
  check("...and a period with no Revenues reads Not reported, never the contract line beside the total", old == null, JSON.stringify(old));

  // BANC's shape (#552 COWORK #194): `Revenues` on the newest year only, the
  // contract line on all four -- the floor fails and the contract line stays.
  const banc = payload({
    [CONTRACT]: years5.slice(0, 4).map(([c]) => c),
    Revenues: [years5[0][1]],
    [OP]: years5.slice(0, 4).map(([c]) => [c[0], c[1], 10 * M]),
  });
  const b23 = X.extractCompanyFacts("BANC", banc).years.find((p) => p.end === "2023-06-30")?.values?.[REV];
  const b26 = X.extractCompanyFacts("BANC", banc).years.find((p) => p.end === "2026-06-30")?.values?.[REV];
  check("the floor fails (Revenues on 1 of 4 years): the contract line is kept everywhere",
    b23?.val === 600 * M && b26?.val === 1440 * M && b26?.tag === CONTRACT, JSON.stringify({ b23, b26 }));
  const nofloor = extractRaw.replace("const floorHolds = covers(quarterCells, fbQuarter, 8) && covers(yearCells, fbYear, 4);", "const floorHolds = true;");
  check("the floor mutation applied", nofloor !== extractRaw);
  const XF = await load(nofloor);
  const f23 = XF.extractCompanyFacts("BANC", banc).years.find((p) => p.end === "2023-06-30")?.values?.[REV];
  check("MUTATION: without the floor BANC's older years go unreported (caught)", f23 == null, JSON.stringify(f23));
  // ADP's shape: the newest end carries a contract QUARTER and a Revenues YEAR
  // only. Like for like, there is nothing to compare: the rule must not fire.
  const adp = payload({
    [CONTRACT]: [["2026-04-01", "2026-06-30", 5474 * M], yr("2025-07-01", "2026-06-30", 21000 * M)],
    Revenues: [yr("2025-07-01", "2026-06-30", 21947 * M)],
    [OP]: [["2026-04-01", "2026-06-30", 1200 * M], yr("2025-07-01", "2026-06-30", 5500 * M)],
  });
  const aq = X.extractCompanyFacts("ADP", adp).quarters.find((p) => p.end === "2026-06-30")?.values?.[REV];
  check("a quarter is never compared with a year (ADP: the year is 4.5% above, so nothing moves)",
    aq?.val === 5474 * M && aq?.tag === CONTRACT, JSON.stringify(aq));
  const mixed = extractRaw.replace("const pair = pairAt(quarterCells, fbQuarter) ?? pairAt(yearCells, fbYear);",
    "const pair = (() => { const r = newest ? (quarterCells.get(newest) ?? yearCells.get(newest))?.get(\"revenue\") : undefined; const f = newest ? (fbQuarter.get(newest) ?? fbYear.get(newest))?.get(\"revenue\") : undefined; return r && f ? { rev: r, fb: f } : null; })();");
  check("the duration mutation applied", mixed !== extractRaw);
  // The floor disabled too: ADP has no quarterly Revenues, so the floor alone
  // would also refuse, and the duration guard must be tested on its own.
  const XD = await load(mixed.replace("const floorHolds = covers(quarterCells, fbQuarter, 8) && covers(yearCells, fbYear, 4);", "const floorHolds = true;"));
  const dq = XD.extractCompanyFacts("ADP", adp).quarters.find((p) => p.end === "2026-06-30")?.values?.[REV];
  check("MUTATION: quarter-against-year comparison flips ADP's quarter away (caught)", !(dq?.val === 5474 * M && dq?.tag === CONTRACT), JSON.stringify(dq));
  const mutated = extractRaw.replace("if (!filerTagsExcise(facts)) {", "if (false) {");
  check("the mutation applied", mutated !== extractRaw);
  const XM = await load(mutated);
  const m25 = XM.extractCompanyFacts("AFRM", facts).years.find((p) => p.end === "2025-06-30")?.values?.[REV];
  check("MUTATION: without the rule AFRM reads the contract line (caught)", m25?.val === 1110 * M, JSON.stringify(m25));
  const excise = extractRaw.replace("if (!filerTagsExcise(facts)) {", "if (true) {");
  const XE = await load(excise);
  const cop = XE.extractCompanyFacts("FIX", payload(CASES.COP[0])).quarters.find((p) => p.end === "2026-06-30")?.values?.[REV];
  check("MUTATION: without the excise exclusion COP flips to Revenues (caught)", cop?.val === 34922 * M, JSON.stringify(cop));
}

console.log("\n4. the one predicate");
check("the pages' refusal and the extractor share revenueLineIncompleteValues",
  /revenueLineIncompleteValues\(valueOf\(p, "revenue"\), valueOf\(p, "operatingIncome"\), valueOf\(p, "preTaxIncome"\)\)/.test(fs.readFileSync("lib/server/secEarningsView.ts", "utf8")) &&
    /if \(!revenueLineIncompleteValues\(rev, op, pre\)\) continue;/.test(extractRaw));
check("the fallback chain is the ruled one", JSON.stringify(X.REVENUE_FALLBACK_CHAIN) === JSON.stringify(["Revenues", "RevenuesNetOfInterestExpense"]));

console.log("\n5. mutation");
{
  // The total-over-contract rule disabled too, so the substitution is tested alone.
  const mutated = extractRaw.replace('        m.set("revenue", fb);\n', "").replace("if (!filerTagsExcise(facts)) {", "if (false) {");
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
