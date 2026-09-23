// A REVENUE LINE THE FILINGS TAG ONLY IN PART REFUSES ITS RATIOS BY NAME.
//
// #535 COWORK #8 ruling 4 (CODE #11). Net margin > 100% on 25 filers; the rule
// (secEarningsView.revenueLineIncomplete) is operating income > revenue, or
// pre-tax income > revenue where operating income is not tagged. Pinned on the
// newest-quarter figures measured for each (relay 35862576405), written into a
// real fact-set fixture's newest quarter:
//   KEPT     NTNX, AFRM, BLFS (tax valuation-allowance release), ZM (a gain
//            below the operating line) — their margins stand.
//   REFUSED  UDR, MET (operating income > revenue), SOFI (no operating line;
//            pre-tax > revenue) — "Not meaningful — …" in the margins table,
//            on the stock-page tile, and on P/S.
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
const WORDS = "Not meaningful — this filer's revenue line is incomplete in its tagged data";
const base = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
// Millions, newest period, as measured: revenue, operating, pre-tax, tax, net.
const CASES = {
  NTNX: [757.1, 70.0, 82.7, -1186.9, 1269.6, "kept"],
  AFRM: [387.5, 147.3, 169.1, -1447.5, 1616.6, "kept"],
  BLFS: [28.5, 1.7, 2.8, -42.4, 45.1, "kept"],
  ZM: [1277.2, 314.3, 1995.0, 452.5, 1542.4, "kept"],
  UDR: [2.5, 229.8, 203.4, 0.5, 189.8, "refused"],
  MET: [724.0, 1604.0, 1035.0, 256.0, 736.0, "refused"],
  SOFI: [153.6, null, 204.3, 47.7, 156.6, "refused"],
};
const withFigures = (mod, [rev, op, pre, tax, ni]) => {
  const set = structuredClone(base);
  const i = (k) => mod.SEC_FIELD_KEYS.indexOf(k);
  // Every period gets the same shape, so the table rows, the tile and the
  // twelve months behind P/S all see it.
  for (const p of set.quarters) {
    p.v[i("revenue")] = rev * 1e6; p.v[i("operatingIncome")] = op === null ? null : op * 1e6;
    p.v[i("preTaxIncome")] = pre * 1e6; p.v[i("incomeTaxExpense")] = tax * 1e6; p.v[i("netIncome")] = ni * 1e6;
    p.v[i("grossProfit")] = null; p.v[i("costOfRevenue")] = null;
  }
  return set;
};

for (const [sym, c] of Object.entries(CASES)) {
  const refused = c[5] === "refused";
  const set = withFigures(M, c);
  const view = M.buildSecEarningsView(set);
  const table = visibleText(html(React.createElement(M.SecGrowthMarginsCard ?? M.SecMarginsCard, { view })));
  const newest = view.margins.at(-1);
  check(`${sym}: margins ${refused ? "refused" : "kept"}`, newest.marginsRefused === refused && (refused ? newest.net === null : newest.net !== null),
    JSON.stringify(newest));
  check(`${sym}: the table ${refused ? "says Not meaningful" : "prints the margin"}`, refused ? table.includes("Not meaningful") : !table.includes("Not meaningful"));
  const score = S.scoreFromSec(S.buildSecEarningsView(set), sym, { status: "ready", set, cold: false });
  const snap = S.buildSecEarningsSnapshot({ symbol: sym, view: S.buildSecEarningsView(set), score, reported: null, nextReport: { kind: "none" } });
  check(`${sym}: the tile's net-margin reason ${refused ? "names it" : "is clear"}`, refused ? snap.marginReasons.net === WORDS : snap.marginReasons.net === null, snap.marginReasons.net ?? "null");
  const mi = M.multipleInputs(set);
  const vi = M.valuationInputs(set, "2026-09-23", { annualForm: null });
  const ps = M.valuationMultiples(vi, mi, 100)?.ps;
  check(`${sym}: P/S input ${refused ? "flagged incomplete" : "clean"}`, mi.revenueIncomplete === refused);
  if (ps && (ps.ok || ps.why !== "no-cover-share-count")) {
    check(`${sym}: P/S ${refused ? "refused by name" : "not refused for revenue"}`,
      refused ? ps.ok === false && ps.why === "revenue-line-incomplete" : !(ps.ok === false && ps.why === "revenue-line-incomplete"), JSON.stringify(ps));
  }
}
{
  const set = withFigures(M, CASES.UDR);
  const mi = M.multipleInputs(set);
  const cap = { ok: true, val: 1e9 };
  // valuationMultiples needs a market cap; drive the P/S branch directly.
  const src = fs.readFileSync("lib/server/secValuation.ts", "utf8");
  check("P/S refuses with the named reason when the revenue line is incomplete",
    /m\.revenueIncomplete\s*\?\s*\{ ok: false, why: "revenue-line-incomplete" \}/.test(src) && mi.revenueIncomplete === true);
  check("…and its words are the margin's words", /"revenue-line-incomplete":\s*\n\s*"not meaningful — this filer's revenue line is incomplete in its tagged data"/.test(src));
  void cap;
}
// The predicate lives in secFields since #6-B (one rule for the extractor's
// fallback and the pages' refusal).
const mut = await loadCards((s) => s.replace("if (op != null) return op > rev;", "if (op != null) return false;"));
check("MUTATION \"operating-line test removed\" breaks the UDR refusal",
  mut.buildSecEarningsView(withFigures(mut, CASES.UDR)).margins.at(-1).marginsRefused === false);

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nIncomplete revenue lines are refused by name.\n");
process.exit(failures ? 1 : 0);
