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
import { splitAdjustSource } from "./lib/split-adjust-source.mjs";

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
const BASE = [FIELDS, strip("lib/server/secExtract.ts"), strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"), strip("lib/server/secFactCodec.ts"), splitAdjustSource()].join("\n");
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
// `yoy`: the period's operating margin against its year-earlier one, in points
// (#552 COWORK #187 §2) -- what the margin chip now counts.
const mr = (op, yoy = null) => ({ label: "x", gapAfter: false, gross: null, operating: op, net: null, operatingYoYpp: yoy });
const AXTI_GROWTH = [g(12, "loss-both"), g(15, "loss-both"), g(20, "loss-both"), g(30, "loss-both"), g(45, "turned-profitable")];
const AXTI_MARGINS = [mr(-30, 5), mr(-22, 8), mr(-15.5, 6), mr(-8, 7), mr(21.9, 30)];
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
  // THE REASON IS THE WORD'S TAP NOTE since #552 COWORK #124.
  check("the card carries the reason (as the word's note) and prints the latest words",
    /reason=\{l\.reason \?\? `Needs/.test(cards) && /l\.latestWords \?/.test(cards));
}

console.log("\n4. operating margin direction chip");
{
  const t = M.trendSummary(viewOf(AXTI_GROWTH, AXTI_MARGINS));
  const m = t.lines.find((l) => l.label === "Operating margin");
  check("AXTI: typical −15.5%, latest 21.9% → 'Improving' (a negative end takes improved/worsened)", m.value === -15.5 && m.move?.word === "Improving" && m.move?.tone === "good", JSON.stringify(m.move));
  check("the level itself stays untoned", m.tone === null);
  const pos = M.trendSummary(viewOf([], [mr(20, 1), mr(21, 2), mr(19, -1), mr(24, 4)])).lines.find((l) => l.label === "Operating margin");
  check("both positive, most periods up on the year → 'Widening', 3 of 4", pos.move?.word === "Widening" && pos.matched === 3 && pos.compared === 4, JSON.stringify([pos.move, pos.matched, pos.compared]));
  const flat = M.trendSummary(viewOf([], [mr(20, 0.2), mr(21, -0.1), mr(19, 0.3), mr(20.3, 0.1)])).lines.find((l) => l.label === "Operating margin");
  check("inside ±0.5pp → 'Steady'", flat.move?.word === "Steady", JSON.stringify(flat.move));
  const wild = M.trendSummary(viewOf([], [mr(-300, 50), mr(-250, 50), mr(-200, 50), mr(-20, 180)])).lines.find((l) => l.label === "Operating margin");
  check("a move that is not meaningful (below −100%) gets no chip", wild.move === null);
  const Mc = await build(VIEW, once(PRES, "      move: moveTone && m !== null", "      move: false && moveTone && m !== null"));
  check("MUTATION: no chip → AXTI's margin line has no direction (caught)", !Mc.trendSummary(viewOf(AXTI_GROWTH, AXTI_MARGINS)).lines.find((l) => l.label === "Operating margin").move);
  const cards = readCodeOnly("app/stock/[symbol]/earnings/SecEarningsCards.tsx");
  check("the card renders l.move on a level line", /l\.kind === "level"\s*\?\s*\(l\.move \? <ToneChip tone=\{l\.move\.tone\} word=\{l\.move\.word\} \/> : null\)/.test(cards));
}

console.log("\n5. the chip counts the periods that match it (#552 COWORK #187 §2)");
{
  const line = (t, label) => t.lines.find((l) => l.label === label);
  // TXN: revenue up in each of the last six quarters, down in the two before.
  const TXN = [-8, -3, 4, 6, 9, 11, 13, 14].map((r) => g(r, r));
  const txn = line(M.trendSummary(viewOf(TXN, [])), "Revenue growth");
  check("TXN: 'Growing 6 of 8', not 8 of 8", txn.chipTone === "good" && txn.matched === 6 && txn.compared === 8, JSON.stringify([txn.chipTone, txn.matched, txn.compared]));
  // ENPH: typical about flat, down three quarters running, latest -19.6%.
  const ENPH = [5, 4, 1, -1, 0.5, -8, -12, -19.6].map((r) => g(r, null));
  const enph = line(M.trendSummary(viewOf(ENPH, [])), "Revenue growth");
  check("ENPH: a 3/3 tie goes to the latest → 'Declining 3 of 8' (never 'Flat' beside −19.6%)", enph.chipTone === "weak" && enph.matched === 3 && enph.tone === "neutral", JSON.stringify([enph.chipTone, enph.matched, enph.tone]));
  // HSY: margin down on the year in six of eight quarters.
  const HSY = [mr(26, 1), mr(25, 0.8), mr(24, -1), mr(23, -2), mr(21, -3), mr(18, -4), mr(15, -6), mr(12.3, -9)];
  const hsy = line(M.trendSummary(viewOf([], HSY)), "Operating margin");
  check("HSY: 'Narrowing 6 of 8', not 'Widening 8 of 8'", hsy.move?.word === "Narrowing" && hsy.matched === 6 && hsy.compared === 8, JSON.stringify([hsy.move, hsy.matched]));
  const cards = readCodeOnly("app/stock/[symbol]/earnings/SecEarningsCards.tsx");
  check("the card prints matched of compared, and the chip from chipTone",
    /\$\{l\.matched\} of \$\{l\.compared\}/.test(cards) && /<ToneChip tone=\{l\.chipTone\} word=\{word\} \/>/.test(cards) && !/\$\{l\.counted\} of \$\{total\}/.test(cards));
  // "LATEST:" WHEN THE NEWEST PERIOD DISAGREES WITH THE MAJORITY (#552 COWORK #190).
  // TXN's margin: down on the year in five of eight quarters, the latest up 7.1pp.
  const TXN_M = [mr(38, -1), mr(36, -2), mr(34, -3), mr(33, -2), mr(33, -1), mr(35, 1), mr(37, 2), mr(42.3, 7.1)];
  const txnM = line(M.trendSummary(viewOf([], TXN_M)), "Operating margin");
  check("TXN margin: 'Narrowing 5 of 8' with 'Latest: widening'", txnM.move?.word === "Narrowing" && txnM.matched === 5 && txnM.latestChip?.word === "Latest: widening" && txnM.latestChip?.tone === "good", JSON.stringify([txnM.move, txnM.matched, txnM.latestChip]));
  const ENPHup = [5, 4, 1, -8, -12, -19.6, -6, 9].map((r) => g(r, null));
  const enphUp = line(M.trendSummary(viewOf(ENPHup, [])), "Revenue growth");
  check("a rate line: 'Declining' majority with a latest +9% adds 'Latest: growing'", enphUp.chipTone === "weak" && enphUp.latestChip?.word === "Latest: growing", JSON.stringify([enphUp.chipTone, enphUp.latestChip]));
  check("no second line when the latest agrees (TXN revenue, HSY margin)", txn.latestChip === null && hsy.latestChip === null);
  check("the card prints it under the count", /\{l\.latestChip \? \(\s*<div className="trendLatestWord" data-latest-word=""/.test(cards));
  const M5 = await build(VIEW, once(PRES, "latestChip: chip && latestTone && latestTone !== chip.tone ?", "latestChip: false && chip && latestTone && latestTone !== chip.tone ?"));
  check("MUTATION: no 'Latest:' line on a rate card → the +9% latest is unsaid (caught)", line(M5.trendSummary(viewOf(ENPHup, [])), "Revenue growth").latestChip === null);
  const M6 = await build(VIEW, once(PRES, "if (!moveTone || !t || t === moveTone || newest === null || newestDelta === null) return null;", "return null;"));
  check("MUTATION: no 'Latest:' line on the margin card → TXN reads only 'Narrowing' (caught)", line(M6.trendSummary(viewOf([], TXN_M)), "Operating margin").latestChip === null);
  // THE VIEW SUPPLIES THE MOVES, AND THE ANNUAL TABLE'S YoY IS IN THE
  // REPORTING CURRENCY (SONY: -2.6% converted vs -3.7% in yen).
  const V = readCodeOnly("lib/server/secEarningsView.ts");
  check("each margins row carries its operating move against marginsOf(prior)",
    /operatingYoYpp: \(\(\) => \{\s*const before = prior \? marginsOf\(prior\)\.operating : null;/.test(V));
  check("the annual rows' revenue and EPS YoY read home(), like the quarterly rows",
    /revenueYoY: yoy\(valueOf\(home\(p\), "revenue"\), valueOf\(home\(prior\), "revenue"\)\),\s*epsDiluted: view\(p, "epsDiluted"/.test(V) &&
      /epsYoY: yoy\(valueOf\(home\(p\), "epsDiluted"\), valueOf\(home\(prior\), "epsDiluted"\)\),\s*\.\.\.marginsOf\(p\),\s*netIncome/.test(V));
  // MUTATIONS
  const M1 = await build(VIEW, once(PRES, "chipTone: chip?.tone ?? null, matched: chip?.matched ?? null, compared: nums.length,", "chipTone: tone, matched: nums.length, compared: nums.length,"));
  const t1 = line(M1.trendSummary(viewOf(TXN, [])), "Revenue growth"), e1 = line(M1.trendSummary(viewOf(ENPH, [])), "Revenue growth");
  check("MUTATION: the old rule (median tone, every period counted) → TXN 8 of 8, ENPH Flat (caught)", t1.matched === 8 && e1.chipTone === "neutral");
  const M2 = await build(VIEW, once(PRES, "const tone = (latest && tied.includes(latest) ? latest : median && tied.includes(median) ? median : null)", "const tone = (median && tied.includes(median) ? median : null)"));
  check("MUTATION: ties ignore the latest → ENPH back to 'Flat' (caught)", line(M2.trendSummary(viewOf(ENPH, [])), "Revenue growth").chipTone === "neutral");
  const M3 = await build(VIEW, once(PRES, "? modalTone(deltas.map((d) => toneForMarginDelta(d)), toneForMarginDelta(newestDelta), null)", "? { tone: toneForMarginDelta(newestDelta), matched: deltas.length }"));
  check("MUTATION: the margin chip from the latest move alone, counting every period → HSY 8 of 8 (caught)", line(M3.trendSummary(viewOf([], HSY)), "Operating margin").matched === 8);
}

if (failures) { console.log(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
