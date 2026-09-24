// A FIRST-FILING COMPANY, AND THE PAGE GROWING UP ON ITS OWN (#552 COWORK #37).
//
// SPCX's first periodic report is its Q2 10-Q. Every earnings-page state below
// is DERIVED from the filings on each build (no stored flag, no list entry):
// this replays SPCX's filing sequence through the SHIPPED extractor, codec,
// view, score and cards (one transpiled unit, scripts/lib/render-cards.mjs),
// and every rule is paired with a MUTATION that must be caught.
//
//   A. Q2 10-Q only (first filing): the comparative quarter is tagged with the
//      CURRENT fy/fp (as filed) and the quarters are unlabelled; the prior-year
//      quarter is still found BY PERIOD DATES (revenue +91.9%), Growth &
//      Margins has its row, and the cash card is the six months, named.
//   B. + Q3 10-Q: Q3 cash flow derived (9M - 6M), the six-month wording gone,
//      a two-quarter margin trend with no gap, more score inputs.
//   C. + first 10-K: years, quarters labelled, twelve months of EPS.
//   D. Growth & Margins with no comparable row: one sentence, no empty table.
//
//   node scripts/check-new-listing.mjs
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";
import { once } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const M = await loadCards();

// ── the filings, as companyfacts rows (values are SPCX's where known) ──────
const Q2 = { accn: "0001628280-26-052535", form: "10-Q", fy: 2026, fp: "Q2", filed: "2026-08-04" };
const Q3 = { accn: "0001628280-26-099999", form: "10-Q", fy: 2026, fp: "Q3", filed: "2026-11-05" };
const K = { accn: "0001628280-27-011111", form: "10-K", fy: 2026, fp: "FY", filed: "2027-02-20" };
const r = (f, start, end, val) => ({ start, end, val, accn: f.accn, form: f.form, fy: f.fy, fp: f.fp, filed: f.filed });
const inst = (f, end, val) => ({ end, val, accn: f.accn, form: f.form, fy: f.fy, fp: f.fp, filed: f.filed });
function facts(filings) {
  const has = (f) => filings.includes(f);
  const usd = (rows) => ({ units: { USD: rows.filter(Boolean) } });
  const rev = [], cor = [], op = [], ni = [], eps = [], sh = [], ocf = [], capex = [];
  // Q2 10-Q: three months to 06-30 (current + comparative), six months YTD, both tagged fy2026 Q2.
  if (has(Q2)) {
    rev.push(r(Q2, "2026-04-01", "2026-06-30", 7_814e6), r(Q2, "2025-04-01", "2025-06-30", 4_071e6), r(Q2, "2026-01-01", "2026-06-30", 14_500e6), r(Q2, "2025-01-01", "2025-06-30", 7_900e6));
    cor.push(r(Q2, "2026-04-01", "2026-06-30", 3_495e6), r(Q2, "2025-04-01", "2025-06-30", 2_282e6));
    op.push(r(Q2, "2026-04-01", "2026-06-30", -143e6), r(Q2, "2025-04-01", "2025-06-30", -970e6));
    ni.push(r(Q2, "2026-04-01", "2026-06-30", -541e6), r(Q2, "2025-04-01", "2025-06-30", -1_008e6), r(Q2, "2026-01-01", "2026-06-30", -900e6), r(Q2, "2025-01-01", "2025-06-30", -1_700e6));
    eps.push(r(Q2, "2026-04-01", "2026-06-30", -0.09), r(Q2, "2025-04-01", "2025-06-30", -0.34));
    sh.push(r(Q2, "2026-04-01", "2026-06-30", 5_864e6), r(Q2, "2025-04-01", "2025-06-30", 2_929e6));
    ocf.push(r(Q2, "2026-01-01", "2026-06-30", 3_466e6), r(Q2, "2025-01-01", "2025-06-30", 1_900e6));
    capex.push(r(Q2, "2026-01-01", "2026-06-30", 6_000e6), r(Q2, "2025-01-01", "2025-06-30", 4_000e6));
  }
  if (has(Q3)) {
    rev.push(r(Q3, "2026-07-01", "2026-09-30", 8_200e6), r(Q3, "2025-07-01", "2025-09-30", 4_600e6), r(Q3, "2026-01-01", "2026-09-30", 22_700e6), r(Q3, "2025-01-01", "2025-09-30", 12_500e6));
    cor.push(r(Q3, "2026-07-01", "2026-09-30", 3_600e6), r(Q3, "2025-07-01", "2025-09-30", 2_500e6));
    op.push(r(Q3, "2026-07-01", "2026-09-30", 150e6), r(Q3, "2025-07-01", "2025-09-30", -700e6));
    ni.push(r(Q3, "2026-07-01", "2026-09-30", 100e6), r(Q3, "2025-07-01", "2025-09-30", -800e6), r(Q3, "2026-01-01", "2026-09-30", -800e6), r(Q3, "2025-01-01", "2025-09-30", -2_500e6));
    eps.push(r(Q3, "2026-07-01", "2026-09-30", 0.02), r(Q3, "2025-07-01", "2025-09-30", -0.27));
    sh.push(r(Q3, "2026-07-01", "2026-09-30", 5_900e6), r(Q3, "2025-07-01", "2025-09-30", 2_950e6));
    ocf.push(r(Q3, "2026-01-01", "2026-09-30", 5_466e6), r(Q3, "2025-01-01", "2025-09-30", 2_900e6));
    capex.push(r(Q3, "2026-01-01", "2026-09-30", 9_000e6), r(Q3, "2025-01-01", "2025-09-30", 6_100e6));
  }
  if (has(K)) {
    rev.push(r(K, "2026-01-01", "2026-12-31", 31_500e6), r(K, "2025-01-01", "2025-12-31", 18_000e6));
    cor.push(r(K, "2026-01-01", "2026-12-31", 14_000e6), r(K, "2025-01-01", "2025-12-31", 9_500e6));
    op.push(r(K, "2026-01-01", "2026-12-31", 400e6), r(K, "2025-01-01", "2025-12-31", -3_000e6));
    ni.push(r(K, "2026-01-01", "2026-12-31", -600e6), r(K, "2025-01-01", "2025-12-31", -3_300e6));
    eps.push(r(K, "2026-01-01", "2026-12-31", -0.11), r(K, "2025-01-01", "2025-12-31", -1.12));
    sh.push(r(K, "2026-01-01", "2026-12-31", 5_700e6), r(K, "2025-01-01", "2025-12-31", 2_950e6));
    ocf.push(r(K, "2026-01-01", "2026-12-31", 7_600e6), r(K, "2025-01-01", "2025-12-31", 4_100e6));
    capex.push(r(K, "2026-01-01", "2026-12-31", 12_200e6), r(K, "2025-01-01", "2025-12-31", 8_300e6));
  }
  return {
    cik: 1181412, entityName: "SPACE EXPLORATION TECHNOLOGIES CORP.",
    facts: {
      dei: {},
      "us-gaap": {
        Revenues: usd(rev), CostOfRevenue: usd(cor), OperatingIncomeLoss: usd(op), NetIncomeLoss: usd(ni),
        EarningsPerShareDiluted: { units: { "USD/shares": eps } },
        WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: sh } },
        NetCashProvidedByUsedInOperatingActivities: usd(ocf), PaymentsToAcquirePropertyPlantAndEquipment: usd(capex),
      },
    },
  };
}
const build = (M, filings) => {
  const ex = M.extractCompanyFacts("SPCX", facts(filings));
  const set = M.encodeFactSet(ex);
  const view = M.buildSecEarningsView(set);
  return { set, view, score: M.scoreFromSec(view, "SPCX", { status: "ready", set, cold: false }) };
};
const q = (set, end) => set.quarters.find((p) => p.e === end);
const val = (M, p, k) => (p ? M.valueOf(p, k) : null);
const text = (M, Card, view) => visibleText(html(React.createElement(M[Card], { view })));
const inputs = (s) => Object.keys(s.contributions ?? {}).length;

console.log("A. the first filing (Q2 10-Q only)");
const A = build(M, [Q2]);
check("both quarters are stored, and neither is labelled (no annual report to anchor the fiscal year)",
  A.set.quarters.length === 2 && A.set.quarters.every((p) => !p.fp), JSON.stringify(A.set.quarters.map((p) => [p.e, p.fp, p.fy])));
const yoy = A.view.snapshot.revenueYoY;
check("the comparative quarter (tagged fy2026 Q2, as filed) is matched by dates: revenue YoY +91.9%",
  typeof yoy === "number" && Math.abs(yoy - 91.94) < 0.1 && A.view.snapshot.comparedWith === "2025-06-30", JSON.stringify([yoy, A.view.snapshot.comparedWith]));
check("Growth & Margins has the quarter's row, with its margins", A.view.margins.length === 1 && A.view.margins[0].operating !== null
  && A.view.growth[0].comparedWith === "2025-06-30", JSON.stringify(A.view.margins));
check("the six months are stored as the year-to-date frame (Jan–Jun, OCF 3,466M), not as a quarter",
  A.set.yt?.s === "2026-01-01" && A.set.yt?.e === "2026-06-30" && val(M, A.set.yt, "operatingCashFlow") === 3_466e6
  && val(M, q(A.set, "2026-06-30"), "operatingCashFlow") === null);
const cA = A.view.cashQuality;
check("the cash card is the six months, named, with its own net income",
  cA.basis === "year-to-date" && cA.period === "Six months to 30 Jun 2026" && cA.operatingCashFlow.val === 3_466e6
  && cA.netIncome.val === -900e6 && cA.accruals === 3_466e6 + 900e6 && cA.freeCashFlow === 3_466e6 - 6_000e6, JSON.stringify([cA.basis, cA.period, cA.accruals]));
const tA = text(M, "SecCashQualityCard", A.view);
check("the card says six months, and never 'do not carry a cash-flow statement'",
  /cash-flow statement for the six months to 30 Jun 2026 only/.test(tA) && !/do not carry a cash-flow statement/.test(tA), tA.slice(0, 240));
check("the score reads more than one input (revenue growth, profitability, cash conversion)", inputs(A.score) >= 3,
  JSON.stringify(A.score.contributions));
{
  const Mm = await loadCards(once("return byLabel ?? quarters.find((c) => sameSpanOneYearEarlier(c, p)) ?? null;", "return byLabel;"));
  const Am = build(Mm, [Q2]);
  check("MUTATION: date matching removed → YoY lost and Growth & Margins empty", Am.view.snapshot.revenueYoY === null && Am.view.margins.length === 0);
}
{
  const Mm = await loadCards(once("const cashFrom = ytd ?? (", "const cashFrom = ("));
  check("MUTATION: the year-to-date fallback removed → no operating cash flow on the card",
    build(Mm, [Q2]).view.cashQuality.operatingCashFlow.val === null);
}

console.log("\nB. + the Q3 10-Q");
const B = build(M, [Q2, Q3]);
check("Q3 operating cash flow is derived (9M - 6M = 2,000M)", val(M, q(B.set, "2026-09-30"), "operatingCashFlow") === 2_000e6);
check("no year-to-date frame once the quarter's own cash flow exists; the card is the quarter",
  B.set.yt === undefined && B.view.cashQuality.basis === "quarter" && !/six months/i.test(text(M, "SecCashQualityCard", B.view)));
check("a two-quarter margin trend, and Q3 follows Q2 with no gap badge",
  B.view.margins.length === 2 && B.view.margins.every((m) => !m.gapAfter), JSON.stringify(B.view.margins.map((m) => [m.label, m.gapAfter])));
check("more score inputs than the first filing (the margin trend joins)", inputs(B.score) > inputs(A.score),
  `${inputs(A.score)} → ${inputs(B.score)}`);
{
  const Mm = await loadCards(once("return gap >= 0 && gap <= 4 &&", "return false &&"));
  check("MUTATION: date adjacency removed → Q3 and Q2 marked as a gap", build(Mm, [Q2, Q3]).view.margins.some((m) => m.gapAfter));
  const Mx = await loadCards(once("const ytdFrame = newestQ && newestQ.values[ocfAt] == null", "const ytdFrame = newestQ"));
  check("MUTATION: the frame kept even where the quarter has cash flow → caught (an established set would change)",
    build(Mx, [Q2, Q3]).set.yt !== undefined);
}

console.log("\nC. + the first 10-K");
const Cc = build(M, [Q2, Q3, K]);
check("the five-year history starts (FY2026 and FY2025)", Cc.set.years.length >= 2);
check("quarters are labelled once a year-end is on file", Cc.set.quarters.every((p) => p.fp), JSON.stringify(Cc.set.quarters.map((p) => p.fp)));
const eps = M.ttmEpsFromSet(Cc.set, {}, "2027-03-01");
check("twelve months of EPS exist (so a P/E can be computed)", eps !== null && eps.val === -0.11, JSON.stringify(eps));

console.log("\nD. Growth & Margins with nothing comparable");
{
  const bare = { ...A.view, margins: [], growth: [] };
  const t = text(M, "SecGrowthMarginsCard", bare);
  check("one plain sentence, no table", t.includes(M.GROWTH_MARGINS_EMPTY("quarter")) && !html(React.createElement(M.SecGrowthMarginsCard, { view: bare })).includes("<table"), t);
  const Mm = await loadCards(once("if (view.margins.length === 0) return <GrowthMarginsEmpty", "if (false) return <GrowthMarginsEmpty"));
  check("MUTATION: the empty state removed → an empty table renders again",
    html(React.createElement(Mm.SecGrowthMarginsCard, { view: bare })).includes("<table"));
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
