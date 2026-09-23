// A BLANK EPS SAYS WHY, WHERE THE FILING SAYS MORE THAN "NOT CAPTURED".
//
// #535 COWORK #11, EPS ruling A. The reason must be true for each filer:
//   class  "EPS is reported per share class in the filing" — only filers whose
//          own 10-Q carries EPS dimensioned by StatementClassOfStockAxis
//          (BRK, V, ARES, BKR, COKE, HSY, JEF, KKR, WMG)
//   units  "EPS is not reported per share for this filer's units" — MLPs whose
//          10-Q carries per-unit figures (CQP, MPLX, PAA, SUN, WES)
//   else   the existing words, unchanged.
// Measured by relay write-spotcheck-census-5 (2026-09-23). Pinned here:
//   1. the list's shape — every entry cited, kinds only class/units;
//   2. a listed filer's blank EPS reads its reason on the tile, in the income
//      statement, the annual table and the recent-periods table;
//   3. an unlisted filer keeps the old words; a derived Q4 keeps its own;
//   4. a listed filer WITH an EPS figure shows the figure, not the reason.
import fs from "node:fs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";
import { loadSnapshot } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const M = await loadCards();
const S = await loadSnapshot();
const CLASS = "EPS is reported per share class in the filing";
const UNITS = "EPS is not reported per share for this filer's units";

console.log("1. the list");
const list = M.EPS_FILED_OTHERWISE;
check("the list exists and is non-empty", list && Object.keys(list).length > 0);
for (const [sym, e] of Object.entries(list ?? {})) {
  check(`${sym}: kind is class or units, and cited`, (e.kind === "class" || e.kind === "units") && /^10-Q .+: \S+/.test(e.evidence), JSON.stringify(e));
}
check("the MLPs are units", ["CQP", "MPLX", "PAA", "SUN", "WES"].every((s) => list[s]?.kind === "units"));
check("BRK (both spellings) and V are class", ["BRK-B", "BRK.B", "V"].every((s) => list[s]?.kind === "class"));
check("ATHS and FWONK are NOT listed (no per-share figure in their filings)", !list.ATHS && !list.FWONK);
check("epsBlankReason names the words", M.epsBlankReason("brk.b") === CLASS && M.epsBlankReason("MPLX") === UNITS && M.epsBlankReason("AAPL") === null);

// ── A real fact set with EPS removed from every period ──────────────────────
const base = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
const blankEps = (mod, symbol, keepEps = false) => {
  const set = structuredClone(base);
  set.symbol = symbol;
  const i = (k) => mod.SEC_FIELD_KEYS.indexOf(k);
  if (!keepEps) for (const p of [...set.quarters, ...set.years]) { p.v[i("epsBasic")] = null; p.v[i("epsDiluted")] = null; }
  return set;
};
const render = (name, view) => visibleText(html(React.createElement(M[name], { view })));
const renderRaw = (name, view) => html(React.createElement(M[name], { view }));

console.log("\n2. a listed filer's blank EPS says why, everywhere EPS renders");
for (const [sym, words, short] of [["BRK.B", CLASS, "Per share class"], ["MPLX", UNITS, "Per unit"]]) {
  const set = blankEps(M, sym);
  const view = M.buildSecEarningsView(set);
  check(`${sym}: view.epsReason`, view.epsReason === words, String(view.epsReason));
  const q4 = /^Q4 /.test(view.latestLabel);
  if (!q4) {
    check(`${sym}: income statement names it`, render("SecIncomeStatementCard", view).includes(words));
    check(`${sym}: snapshot card names it`, render("SecSnapshotCard", view).includes(words));
    const score = S.scoreFromSec(S.buildSecEarningsView(set), sym, { status: "ready", set, cold: false });
    const snap = S.buildSecEarningsSnapshot({ symbol: sym, view: S.buildSecEarningsView(set), score, reported: null, nextReport: { kind: "none" } });
    check(`${sym}: stock-page tile names it`, snap.eps.emptyReason === words, String(snap.eps.emptyReason));
  }
  const annual = renderRaw("SecAnnualCard", view);
  check(`${sym}: annual table prints the short form with the full reason on hover`, annual.includes(`>${short}<`) && annual.includes(words.replace(/'/g, "&#x27;")));
  if (M.SecRecentPeriodsCard && view.tableBasis !== "year") {
    const recent = renderRaw("SecRecentPeriodsCard", view);
    check(`${sym}: recent-periods table names it on non-Q4 rows`, recent.includes(`>${short}<`));
  }
}

console.log("\n3. an unlisted filer and a derived Q4 keep their words");
{
  const view = M.buildSecEarningsView(blankEps(M, "AAPL"));
  check("AAPL: no named reason", view.epsReason === null);
  const text = render("SecIncomeStatementCard", view) + render("SecAnnualCard", view);
  check("AAPL: neither sentence appears", !text.includes(CLASS) && !text.includes(UNITS));
  const src = fs.readFileSync("app/stock/[symbol]/earnings/SecEarningsCards.tsx", "utf8");
  check("a Q4 row never takes the named reason", /view\.epsReason && !\/\^Q4 \/\.test\(label\) \? view\.epsReason : NOT_REPORTED/.test(src));
  const snapSrc = fs.readFileSync("lib/server/secEarningsSnapshot.ts", "utf8");
  check("the tile's derived Q4 keeps q4NotFiled", /derivedQ4 \? EMPTY_REASONS\.q4NotFiled : view\.epsReason/.test(snapSrc));
}

console.log("\n4. a listed filer that has an EPS figure shows the figure");
{
  const view = M.buildSecEarningsView(blankEps(M, "BRK.B", true));
  const text = render("SecIncomeStatementCard", view) + render("SecAnnualCard", view);
  check("no reason sentence where EPS is present", !text.includes(CLASS));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA blank EPS says why.");
