// THE LAYOUT PASS'S SMALL RULES (#552 COWORK #40 / #49 / #50 / #51 / #52), each
// run and then run again under a mutation that must break it.
//   1. gross profit (computed) where revenue and cost are filed and GP is not
//   2. AAPL: a filed other-income total and no interest line → hedged wording
//   3. a large non-operating item: marked on Other income and Net income, and
//      EPS growth not scored off it (GOOGL Q2 FY2026)
//   4. the balance-sheet date is never an opening balance (CHT 2020-01-01)
//   5. P/E is "Not meaningful" on near-zero EPS (AXTI $0.01)
//   6. copy: "other periods omitted", neutral share-basis refusal
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
// A MUTATED COPY BESIDE THE ORIGINAL, so its relative imports resolve; removed in a finally.
const loadMutant = async (file, src) => {
  const tmp = file.replace(/\.ts$/, `.mut-${process.pid}-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(tmp, src);
  try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
};

const V = await import("../lib/server/secEarningsView.ts");
const VAL = await import("../lib/server/secValuation.ts");
const C = await import("../lib/server/secFactCodec.ts");
const VIEW_FILE = "lib/server/secEarningsView.ts", VAL_FILE = "lib/server/secValuation.ts", CODEC_FILE = "lib/server/secFactCodec.ts";
const VS = fs.readFileSync(VIEW_FILE, "utf8"), VALS = fs.readFileSync(VAL_FILE, "utf8"), CS = fs.readFileSync(CODEC_FILE, "utf8");

const B = 1e9;
const cell = (key, val, label = key) => ({ key, label, val, derived: val === null ? null : "as-filed", derivedNote: null });
const rows = (o) => Object.entries(o).map(([k, v]) => cell(k, v));

console.log("\n1. gross profit (computed)");
{
  const spcx = rows({ revenue: 4.0 * B, costOfRevenue: 3.1 * B, grossProfit: null, operatingIncome: -0.143 * B });
  const out = V.withComputedGrossProfit(spcx).find((r) => r.key === "grossProfit");
  check("revenue - cost of revenue, labelled '(computed)'", Math.abs(out.val - 0.9 * B) < 1 && out.label === V.GROSS_PROFIT_COMPUTED_LABEL && out.derived === "computed", JSON.stringify(out));
  const filed = V.withComputedGrossProfit(rows({ revenue: 10, costOfRevenue: 4, grossProfit: 5 })).find((r) => r.key === "grossProfit");
  check("a FILED gross profit is never replaced", filed.val === 5 && filed.label === "grossProfit");
  check("no cost of revenue → stays empty", V.withComputedGrossProfit(rows({ revenue: 10, costOfRevenue: null, grossProfit: null })).find((r) => r.key === "grossProfit").val === null);
  const M = await loadMutant(VIEW_FILE, once(VS, "  if (!gp || gp.val !== null || rev === null || cost === null) return rows;", "  return rows; void gp; void rev; void cost;"));
  check("MUTATION: computation removed → GP stays 'Not reported' (caught)", M.withComputedGrossProfit(spcx).find((r) => r.key === "grossProfit").val === null);
}

console.log("\n2. AAPL: filed other income, no interest line");
{
  const aapl = rows({ operatingIncome: 35.7 * B, interestExpense: null, nonOperatingIncomeExpense: 0.572 * B, preTaxIncome: 36.27 * B });
  const i = V.withDerivedNonOperating(aapl).find((r) => r.key === "interestExpense");
  check("interest reads the hedged 'typically within other income / expense'", i.emptyText === V.INTEREST_WITHIN_FILED_OTHER, String(i.emptyText));
  const both = V.withDerivedNonOperating(rows({ operatingIncome: 1, interestExpense: 2, nonOperatingIncomeExpense: 3, preTaxIncome: 4 }));
  check("an interest line that IS filed is untouched", both.find((r) => r.key === "interestExpense").emptyText === undefined);
}

console.log("\n3. a large non-operating item (GOOGL Q2 FY2026)");
{
  const googl = rows({ revenue: 119.80 * B, operatingIncome: 40.77 * B, nonOperatingIncomeExpense: 97.98 * B, preTaxIncome: 138.75 * B, netIncome: 112.19 * B });
  const marked = V.withNonOperatingMarker(googl);
  check("marked on Other income and Net income: 'Includes a large non-operating gain; see the filing.'",
    marked.find((r) => r.key === "nonOperatingIncomeExpense").sub === "Includes a large non-operating gain; see the filing." &&
    marked.find((r) => r.key === "netIncome").sub === "Includes a large non-operating gain; see the filing.");
  const aapl = rows({ revenue: 94.0 * B, operatingIncome: 28.2 * B, nonOperatingIncomeExpense: 0.57 * B, netIncome: 23.4 * B });
  check("AAPL's 0.57B is not marked", V.largeNonOperating(aapl) === null);
  const lossy = rows({ revenue: 10 * B, operatingIncome: 1 * B, preTaxIncome: -4 * B, netIncome: -4 * B, nonOperatingIncomeExpense: null });
  check("derived from pre-tax less operating when untagged, and a loss says 'loss'", V.withNonOperatingMarker(lossy).find((r) => r.key === "netIncome").sub?.includes("non-operating loss"));
  const M = await loadMutant(VIEW_FILE, once(VS, "  if (!big) return rows;", "  return rows; void big;"));
  check("MUTATION: marker removed → GOOGL's quarter reads unmarked (caught)", M.withNonOperatingMarker(googl).find((r) => r.key === "netIncome").sub === undefined);
  const score = fs.readFileSync("lib/server/secEarningsScore.ts", "utf8");
  check("the score skips EPS growth when the view flags it, and says why",
    /isPct\(s\.epsYoY\) && !view\.largeNonOperating/.test(score) && /if \(view\.largeNonOperating && isPct\(s\.epsYoY\)\) return SCORE_LARGE_NON_OPERATING_EPS;/.test(score));
  check("the view sets largeNonOperating from the same rows the card shows",
    /largeNonOperating: largeNonOperating\(incomeRows\) !== null/.test(VS) && /incomeStatement: incomeRows,/.test(VS));
}

console.log("\n4. the balance-sheet date is never an opening balance (CHT)");
{
  const p = (e, s = null) => ({ e, s, fp: "FY", fy: Number(e.slice(0, 4)), a: null, f: null, v: [], d: "" });
  // CHT while its later periods were refused: newest instant is the 2020-01-01 opening balance.
  const cht = { instants: [p("2020-01-01"), p("2019-12-31"), p("2019-01-01")], quarters: [], years: [p("2019-12-31", "2019-01-01")] };
  check("picks 2019-12-31, never the 2020-01-01 opening balance", C.balanceSheetInstant(cht)?.e === "2019-12-31", C.balanceSheetInstant(cht)?.e);
  const now = { instants: [p("2024-12-31"), p("2020-01-01")], quarters: [], years: [p("2024-12-31", "2024-01-01")] };
  check("after the re-read: 2024-12-31", C.balanceSheetInstant(now)?.e === "2024-12-31");
  check("only an opening balance on file → no balance-sheet date at all",
    C.balanceSheetInstant({ instants: [p("2020-01-01")], quarters: [], years: [p("2019-12-31", "2019-01-01")] }) === null);
  const M = await loadMutant(CODEC_FILE, once(CS, "  return set.instants.find((i) => ends.has(i.e)) ?? null;", "  return set.instants[0] ?? null; void ends;"));
  check("MUTATION: newest instant regardless → 'as at 2020-01-01' again (caught)", M.balanceSheetInstant(cht)?.e === "2020-01-01");
  check("both callers use it (the card and the multiples)", /const bsAt = balanceSheetInstant\(set\);/.test(VS) && /const b = balanceSheetInstant\(set\);/.test(VALS));
}

console.log("\n5. P/E on near-zero EPS (AXTI)");
{
  const inputs = (eps) => ({ shares: null, eps: { val: eps, basis: "four-quarters", periodEnd: "2026-06-30" }, refusals: [] });
  const ax = VAL.peRatio(inputs(0.01), 75.90);
  check("AXTI $75.90 / $0.01 → 'Not meaningful: trailing EPS is close to zero ($0.01)', not 7590.0",
    ax?.ok === false && ax.why === "eps-near-zero" && ax.detail === "Not meaningful: trailing EPS is close to zero ($0.01)", JSON.stringify(ax));
  check("$0.05 EPS still gives a P/E", VAL.peRatio(inputs(0.05), 10)?.ok === true);
  const M = await loadMutant(VAL_FILE, once(VALS, "  if (inputs.eps.val > 0 && inputs.eps.val < PE_MIN_EPS) {", "  if (false) {"));
  check("MUTATION: floor removed → 7590.0 printed again (caught)", M.peRatio(inputs(0.01), 75.90)?.ok === true);
}

console.log("\n7. AVAV (COWORK #54): P/B on NCI-inclusive equity, EV/EBITDA reasons, derived liabilities");
{
  const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");
  const per = (e, s, vals) => ({ e, s, fp: s ? "Q1" : "Q1", fy: 2027, a: null, f: null, v: SEC_FIELD_KEYS.map((k) => vals[k] ?? null), d: "" });
  const bs = (vals) => per("2026-08-01", null, vals);
  const q = (vals) => per("2026-08-01", "2026-05-03", vals);
  const set = (bsVals, qVals = {}) => ({ symbol: "AVAV", quarters: [q(qVals)], years: [], instants: [bs(bsVals)] });
  const AVAV = set({ totalEquity: 4.40 * B, totalAssets: 5.73 * B });
  const r1 = VAL.bookEquityAt(AVAV, AVAV.instants[0]);
  check("AVAV: no parent equity, no NCI tagged → the NCI-inclusive $4.40B, flagged", r1.equity === 4.40 * B && r1.equityIncludesNci && !r1.equityOnlyInclNci, JSON.stringify(r1));
  const NCI = set({ totalEquity: 4.40 * B }, { netIncomeToNoncontrollingInterest: 5e6 });
  const r2 = VAL.bookEquityAt(NCI, NCI.instants[0]);
  check("NCI tagged and non-zero → still refused, by name", r2.equity === null && r2.equityOnlyInclNci);
  const ZERO = set({ totalEquity: 4.40 * B }, { netIncomeToNoncontrollingInterest: 0 });
  check("NCI tagged as 0 → the inclusive total is used", VAL.bookEquityAt(ZERO, ZERO.instants[0]).equity === 4.40 * B);
  const PARENT = set({ stockholdersEquity: 4.1 * B, totalEquity: 4.40 * B });
  check("parent equity present → parent wins", VAL.bookEquityAt(PARENT, PARENT.instants[0]).equity === 4.1 * B);
  const Mn = await loadMutant(VAL_FILE, once(VALS, "  return nciTagged\n", "  return false && nciTagged\n"));
  check("MUTATION: NCI test removed → an NCI filer gets a P/B on the inclusive total (caught)", Mn.bookEquityAt(NCI, NCI.instants[0]).equity === 4.40 * B);
  const Mp = await loadMutant(VAL_FILE, once(VALS, "  if (parent !== null) return { equity: parent, equityIncludesNci: false, equityOnlyInclNci: false };\n", ""));
  check("MUTATION: parent-first removed → the inclusive total replaces parent equity (caught)", Mp.bookEquityAt(PARENT, PARENT.instants[0]).equity === 4.40 * B);

  const inputs = { shares: { val: 1e8, asOf: "2026-08-01" }, eps: null, refusals: [] };
  const mi = (bsx, ebitda, ebitdaMissing = []) => ({ revenue: null, ebitda, ebitdaMissing, balanceSheet: bsx });
  const avavBs = { asOf: "2026-08-01", equity: 4.40 * B, equityIncludesNci: true, shortTermDebt: 0.02 * B, longTermDebt: 0.7 * B, cash: 0.5 * B };
  const pb = VAL.valuationMultiples(inputs, mi(avavBs, null, ["depreciation & amortization"]), 80.6).pb;
  check("P/B ≈ 8.06B / 4.40B = 1.8x, with the incl.-NCI note", pb.ok && Math.abs(pb.val - 8.06 / 4.40) < 0.01 && pb.note === VAL.PB_INCL_NCI_NOTE, JSON.stringify(pb));
  const refused = VAL.valuationMultiples(inputs, mi({ ...avavBs, equity: null, equityIncludesNci: false, equityOnlyInclNci: true }, null), 80.6).pb;
  check("refusal reads 'equity is tagged only including noncontrolling interests…', never 'no shareholders' equity'",
    refused.ok === false && refused.why === "equity-tagged-only-incl-nci" && !/no shareholders/.test(VAL.REFUSAL_WORDS[refused.why]));
  const neg = VAL.valuationMultiples(inputs, mi(avavBs, { vals: { operatingIncome: -1.2 * B, depreciationAndAmortization: 0.3 * B } }), 80.6).evEbitda;
  check("EBITDA ≤ 0 → 'EBITDA over the last twelve months is not positive…'", neg.ok === false && neg.why === "ebitda-is-zero-or-negative" && /^EBITDA over the last twelve months is not positive/.test(VAL.REFUSAL_WORDS[neg.why]));
  const miss = VAL.valuationMultiples(inputs, mi({ ...avavBs, longTermDebt: null }, null, ["depreciation & amortization"]), 80.6).evEbitda;
  check("a missing input is named: long-term debt, D&A (twelve months)",
    miss.ok === false && miss.detail === "not on file: long-term debt, depreciation & amortization (twelve months); it is not approximated", miss.detail);

  const liab = V.withDerivedLiabilities({ key: "totalLiabilities", label: "Total liabilities", val: null, derived: null, derivedNote: null }, AVAV.instants[0]);
  check("total liabilities derived = 5.73 - 4.40 = 1.33B, marked derived", Math.abs(liab.val - 1.33 * B) < 1 && liab.derived === "computed" && /accounting identity/.test(liab.derivedNote));
  const filedL = V.withDerivedLiabilities({ key: "totalLiabilities", label: "Total liabilities", val: 1 * B, derived: "as-filed", derivedNote: null }, AVAV.instants[0]);
  check("a filed total liabilities is never replaced", filedL.val === 1 * B && filedL.derived === "as-filed");
  const Ml = await loadMutant(VIEW_FILE, once(VS, "  if (assets === null || equity === null) return cellIn;\n", "  return cellIn; void assets; void equity;\n"));
  check("MUTATION: identity removed → 'Not found' again (caught)", Ml.withDerivedLiabilities({ key: "totalLiabilities", label: "x", val: null, derived: null, derivedNote: null }, AVAV.instants[0]).val === null);
  check("the balance sheet builds total liabilities through it", /totalLiabilities: withDerivedLiabilities\(view\(bsAt, "totalLiabilities"/.test(VS));
  const page = fs.readFileSync("app/stock/[symbol]/page.tsx", "utf8");
  check("the stock page shows a computed figure's note in the reason line", /f\?\.ok \? f\.note \?\? null : null/.test(page));
}

console.log("\n6. copy");
check("'N other periods omitted' (CHT's refused periods were its LATER ones)", /other period\$\{c\.refused\.length === 1/.test(VS) && !/earlier period\$\{/.test(VS));
check("share-basis refusal names no cause", /the share count on file differs by more than a fifth from the one behind the EPS, so these figures aren't comparable/.test(VALS) && !/a split, bonus issue or depositary-ratio change/.test(VALS));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
