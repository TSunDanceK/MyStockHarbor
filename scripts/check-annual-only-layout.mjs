// THE ANNUAL-ONLY LAYOUT FOR 20-F / 40-F FILERS (#535 COWORK #15).
//
//   1. THE RULE, BY FILER TYPE: 20-F/40-F AND no stored quarter in 18 months.
//      Run on fixtures, plus a MUTATION that adds a recent quarter and must
//      switch the filer back to the quarterly layout (the ONON case), and a
//      source scan that no symbol list decides it.
//   2. IN ANNUAL MODE NO QUARTERLY-ONLY ELEMENT RENDERS: the view is anchored
//      on the fiscal year, the tables walk years, the recent-quarters card is
//      empty, the page gates the growth card and the reaction card, and both
//      pages carry the one note (20-F and 40-F wording).
//   3. US FILERS ARE UNCHANGED: AAPL's view is identical with and without the
//      option, and the rule returns null for a 10-K filer.
//   4. THE NEXT REPORT IS A MONTH, NEVER A DAY.
import fs from "node:fs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";
import { lift } from "./lib/earnings-plan.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const A = await lift(fs.readFileSync("lib/server/annualOnly.ts", "utf8").replace(/^import type[^;]+;$/gm, ""));
const M = await loadCards();
const fixture = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));
const AZN = fixture("AZN");
const KGC = fixture("KGC");
const AAPL = fixture("AAPL");
const newestQuarterEnd = AZN.quarters[0]?.e;

console.log("1. the rule, by filer type");
// AZN files 20-F and still stores quarters; 18 months past its newest one, it is annual-only.
const late = (() => { const d = new Date(`${newestQuarterEnd}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 19); return d.toISOString().slice(0, 10); })();
check("a 20-F filer with no quarter in 18 months is annual-only", A.annualOnlyForm("20-F", AZN, late) === "20-F", `newest quarter ${newestQuarterEnd}, today ${late}`);
check("...a 40-F filer with no quarters at all likewise (KGC)", A.annualOnlyForm("40-F", KGC, "2026-09-23") === "40-F");
check("a 10-K filer never is (AAPL)", A.annualOnlyForm("10-K", AAPL, late) === null);
check("a 20-F filer with a quarter inside 18 months is NOT (the ONON case)", A.annualOnlyForm("20-F", AZN, newestQuarterEnd) === null);
{
  // MUTATION: a recent 10-Q quarter arrives; the same filer must switch back.
  const withQuarter = structuredClone(KGC);
  withQuarter.quarters = [{ ...(KGC.years[0]), e: "2026-06-30", s: "2026-04-01", fp: "Q2" }, ...withQuarter.quarters];
  check("MUTATION: adding a recent quarter switches the filer back to quarterly", A.annualOnlyForm("40-F", withQuarter, "2026-09-23") === null);
}
check("no symbol list decides it: the module names no ticker",
  !/"(ASML|NVO|SAP|SONY|BABA|TSM|BMO|ONON|AZN|KGC)"/.test(readCodeOnly("lib/server/annualOnly.ts")));
check("the 18-month window is the ruled one", A.ANNUAL_ONLY_QUARTER_MONTHS === 18);

console.log("\n2. annual mode renders no quarterly-only element");
{
  const view = M.buildSecEarningsView(AZN, { annualForm: "20-F" });
  check("anchored on the fiscal year", view.basis === "year" && /^FY/.test(view.latestLabel), `${view.basis} ${view.latestLabel}`);
  check("the tables walk years", view.tableBasis === "year");
  check("the view says which form", view.annualFiler === "20-F");
  const recent = html(React.createElement(M.SecRecentPeriodsCard, { view }));
  check("the recent-quarters card renders nothing", recent === "" || recent == null, String(recent).slice(0, 60));
  const annual = visibleText(html(React.createElement(M.SecAnnualCard, { view, sole: true })));
  check("the five-year table is the main table and has rows", /FY\d{4}/.test(annual));
  const snap = visibleText(html(React.createElement(M.SecSnapshotCard, { view })));
  check("the snapshot is the fiscal year, not a quarter", /FY\d{4}/.test(snap) && !/\bQ[1-4] FY/.test(snap));
  const page = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
  check("the page gates the quarterly growth card on tableBasis", /secView\.tableBasis === "year" \? null : <SecGrowthMarginsCard/.test(page));
  check("the page hides the reaction card below three annual reactions",
    /const hidePriceReaction = annualForm !== null && reactionEvents\.length < ANNUAL_REACTION_MIN;/.test(page) && /data\.hidePriceReaction \? null : <PriceReactionCard/.test(page));
  check("the page prints the note and labels the score", /annualOnlyNote\(data\.annualForm\)/.test(page) && /basisNote=\{data\.annualForm \? "Based on full fiscal years\." : null\}/.test(page));
  const raw = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
  check("each hidden element carries the dated comment", (raw.match(/HIDDEN, NOT REMOVED, 2026-09-23/g) ?? []).length >= 2);
  check("the note's words, 20-F", A.annualOnlyNote("20-F") === "This company files its annual report with the SEC on Form 20-F. Its quarterly results are published outside the SEC's structured data, so this page shows full fiscal years.");
  check("...and 40-F", A.annualOnlyNote("40-F").includes("on Form 40-F."));
  const snapSrc = readCodeOnly("lib/server/secEarningsSnapshot.ts");
  check("the stock page's tile applies the same rule", /annualOnlyForm\(registrantFor\(clean\)\?\.annualForm, cold\.set,/.test(snapSrc) && /buildSecEarningsView\(cold\.set, \{ annualForm \}\)/.test(snapSrc));
}

console.log("\n3. US filers unchanged");
{
  const a = M.buildSecEarningsView(AAPL);
  const b = M.buildSecEarningsView(AAPL, { annualForm: null });
  check("AAPL's view is identical with and without the option", JSON.stringify(a) === JSON.stringify(b));
  check("...and stays quarterly", a.basis === "quarter" && a.tableBasis === "quarter" && a.annualFiler === null);
}

console.log("\n4. the next report is a month, never a day");
{
  const o = A.annualNextReportOutlook("KGC", KGC, "40-F");
  check("a month in the headline", /around (January|February|March|April|May|June|July|August|September|October|November|December)\./.test(o.headline) || o.kind === "no-estimate", o.headline);
  check("no day in the headline or hedge", !/\d{4}-\d{2}-\d{2}|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(`${o.headline} ${o.hedge ?? ""}`));
  check("hedged", /may differ/.test(o.hedge ?? "") || o.kind === "no-estimate");
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nThe annual-only layout switches by rule and hides every quarterly-only element.");
