// AXTI'S CARDS, SITE-WIDE (#552 COWORK #47).
//
//   1. Other income (net), derived: where no non-operating total is tagged and
//      both ends are filed, the row is pre-tax − operating income, marked
//      derived; the untagged interest row says it is included there. Never
//      "Not captured" when both ends are filed. MUTATION: the fallback removed
//      → "Not captured" comes back → caught.
//   2. The chains carry the COWORK #47 tags, ranked to fill blanks only.
//   3. EPS growth refused for year-earlier losses says so in words, with
//      "Latest: turned profitable" (the snapshot's words) on a crossing.
//      MUTATION: the reason removed → "needs 3, has 0" comes back → caught.
//   4. Operating margin gets a direction chip (latest vs typical, ±0.5pp, the
//      Growth & Margins verbs). MUTATION: no chip → caught.
//
//   node scripts/check-nonop-trend.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const FIELDS = readCodeOnly("lib/server/secFields.ts");
const BASE = [FIELDS, strip("lib/server/secExtract.ts"), strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"), strip("lib/server/secFactCodec.ts")].join("\n");
const VIEW = strip("lib/server/secEarningsView.ts");
const PRES = strip("lib/server/secPresentation.ts");
const build = (view = VIEW, pres = PRES) => lift([BASE, view, pres].join("\n"), "", "nonop-trend");
const M = await build();

console.log("1. other income (net), derived");
const row = (key, label, val) => ({ key, label, val, derived: val === null ? null : "as-filed", derivedNote: null, perShare: false });
const AXTI = () => [
  row("operatingIncome", "Operating income (EBIT)", 10_400_000),
  row("interestExpense", "Interest expense", null),
  row("nonOperatingIncomeExpense", "Other income / expense", null),
  row("preTaxIncome", "Pre-tax income", 15_100_000),
];
const emptyWords = (c) => c.emptyText ?? (c.val === null ? "Not captured from this filing" : null);
{
  const out = M.withDerivedNonOperating(AXTI());
  const o = out.find((r) => r.key === "nonOperatingIncomeExpense");
  const i = out.find((r) => r.key === "interestExpense");
  check("AXTI: 'Other income (net)' = pre-tax − operating = +$4.7M, marked derived",
    o.label === "Other income (net)" && Math.abs(o.val - 4_700_000) < 1 && o.derived === "computed" && /pre-tax income less operating income/.test(o.derivedNote), JSON.stringify(o));
  check("…the untagged interest row says where it went, not 'Not captured'", emptyWords(i) === "Included in other income (net) below", emptyWords(i));
  check("no row reads 'Not captured' when both ends are filed", !out.some((r) => emptyWords(r) === "Not captured from this filing"));
  const withInt = AXTI().map((r) => r.key === "interestExpense" ? row("interestExpense", "Interest expense", 900_000) : r);
  const w = M.withDerivedNonOperating(withInt).find((r) => r.key === "nonOperatingIncomeExpense");
  check("interest filed: the derived line is labelled 'Non-operating items (net)' and says it includes that interest",
    w.label === "Non-operating items (net)" && /including the interest expense above/.test(w.derivedNote), w.label);
  const tagged = AXTI().map((r) => r.key === "nonOperatingIncomeExpense" ? row("nonOperatingIncomeExpense", "Other income / expense", 4_000_000) : r);
  check("a tagged figure is never replaced", M.withDerivedNonOperating(tagged).find((r) => r.key === "nonOperatingIncomeExpense").val === 4_000_000);
  const noPre = AXTI().map((r) => r.key === "preTaxIncome" ? row("preTaxIncome", "Pre-tax income", null) : r);
  check("one end missing → nothing derived (the card keeps 'Not captured')", M.withDerivedNonOperating(noPre).find((r) => r.key === "nonOperatingIncomeExpense").val === null);
  const Mm = await build(once(VIEW, "  if (!nonOp || nonOp.val !== null || pre === null || op === null) return rows;", "  return rows;"));
  const mo = Mm.withDerivedNonOperating(AXTI());
  check("MUTATION: the derived fallback removed → 'Not captured' is back on AXTI (caught)",
    mo.some((r) => emptyWords(r) === "Not captured from this filing"));
  const view = readCodeOnly("lib/server/secEarningsView.ts");
  check("the income statement is built through it", /const incomeRows = withNonOperatingMarker\(withDerivedNonOperating\(withComputedGrossProfit\(PL\.map/.test(view) && /incomeStatement: incomeRows,/.test(view));
  const cards = readCodeOnly("app/stock/[symbol]/earnings/SecEarningsCards.tsx");
  check("the card prints the view's own empty words first", /empty=\{c\.emptyText \?\?/.test(cards));
}

console.log("\n2. the chains");
{
  const chainOf = (key) => (FIELDS.match(new RegExp(`\\{ key: "${key}", chain: \\[([^\\]]+)\\]`)) ?? [])[1] ?? "";
  const nonOp = chainOf("nonOperatingIncomeExpense"), interest = chainOf("interestExpense");
  check("Other income / expense: the total first, then OtherNonoperatingIncomeExpense",
    /^"NonoperatingIncomeExpense", "OtherNonoperatingIncomeExpense"$/.test(nonOp), nonOp);
  check("Interest expense: InterestExpenseNonoperating added after the tags that already win cells",
    /^"InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating", "InterestIncomeExpenseNet"$/.test(interest), interest);
  check("interest INCOME tags are not read as an expense (sign)", !/InvestmentIncomeInterest|InterestIncomeOther|InterestIncomeExpenseNonoperatingNet/.test(interest));
}

console.log("\n3. EPS growth, refused for year-earlier losses");
const viewOf = (growth, margins) => ({ tableBasis: "quarter", basis: "quarter", growth, margins, incomeStatement: [], incomeStatementComplete: false });
const g = (rev, eps) => ({ revenueYoY: rev, epsYoY: eps });
const mr = (op) => ({ label: "x", gapAfter: false, gross: null, operating: op, net: null });
const AXTI_GROWTH = [g(12, "loss-both"), g(15, "loss-both"), g(20, "loss-both"), g(30, "loss-both"), g(45, "turned-profitable")];
const AXTI_MARGINS = [mr(-30), mr(-22), mr(-15.5), mr(-8), mr(21.9)];
{
  const t = M.trendSummary(viewOf(AXTI_GROWTH, AXTI_MARGINS));
  const eps = t.lines.find((l) => l.label === "EPS growth");
  check("the reason in words", eps.value === null && eps.reason === "Not measured: EPS was a loss in the year-earlier quarters, so a % change isn't meaningful.", eps.reason);
  check("'Latest: turned profitable' (the snapshot's words)", eps.latestWords === "Latest: turned profitable", eps.latestWords);
  const thin = M.trendSummary(viewOf([g(5, null), g(6, 3)], [])).lines.find((l) => l.label === "EPS growth");
  check("too few periods on file still says so, as a sentence", thin.reason === "Not measured: needs 3 comparable quarters, has 1.", thin.reason);
  const Mr = await build(VIEW, once(PRES, "      const reason = crossed.length > 0", "      const reason = null && crossed.length > 0"));
  const r = Mr.trendSummary(viewOf(AXTI_GROWTH, AXTI_MARGINS)).lines.find((l) => l.label === "EPS growth");
  check("MUTATION: the loss reason removed → AXTI reads 'needs 3 … has 0' again (caught)", /has 0\.$/.test(r.reason ?? ""), r.reason);
  const cards = readCodeOnly("app/stock/[symbol]/earnings/SecEarningsCards.tsx");
  check("the card prints the reason and the latest words", /\(l\.reason \?\? `needs/.test(cards) && /l\.latestWords \?/.test(cards));
}

console.log("\n4. operating margin direction chip");
{
  const t = M.trendSummary(viewOf(AXTI_GROWTH, AXTI_MARGINS));
  const m = t.lines.find((l) => l.label === "Operating margin");
  check("AXTI: typical −15.5%, latest 21.9% → 'Improving' (a negative end takes improved/worsened)", m.value === -15.5 && m.move?.word === "Improving" && m.move?.tone === "good", JSON.stringify(m.move));
  check("the level itself stays untoned", m.tone === null);
  const pos = M.trendSummary(viewOf([], [mr(20), mr(21), mr(19), mr(24)])).lines.find((l) => l.label === "Operating margin");
  check("both positive, up 4pp → 'Widening'", pos.move?.word === "Widening", JSON.stringify(pos.move));
  const flat = M.trendSummary(viewOf([], [mr(20), mr(21), mr(19), mr(20.3)])).lines.find((l) => l.label === "Operating margin");
  check("inside ±0.5pp → 'Steady'", flat.move?.word === "Steady", JSON.stringify(flat.move));
  const wild = M.trendSummary(viewOf([], [mr(-300), mr(-250), mr(-200), mr(-20)])).lines.find((l) => l.label === "Operating margin");
  check("a move that is not meaningful (below −100%) gets no chip", wild.move === null);
  const Mc = await build(VIEW, once(PRES, "      move: moveTone && m !== null", "      move: false && moveTone && m !== null"));
  check("MUTATION: no chip → AXTI's margin line has no direction (caught)", !Mc.trendSummary(viewOf(AXTI_GROWTH, AXTI_MARGINS)).lines.find((l) => l.label === "Operating margin").move);
  const cards = readCodeOnly("app/stock/[symbol]/earnings/SecEarningsCards.tsx");
  check("the card renders l.move on a level line", /l\.kind === "level"\s*\?\s*\(l\.move \? <ToneChip tone=\{l\.move\.tone\} word=\{l\.move\.word\} \/> : null\)/.test(cards));
}

if (failures) { console.log(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
