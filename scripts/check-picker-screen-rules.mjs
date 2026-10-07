// THE #169 AUDIT'S FIXES (#553 COWORK #186 rulings, with COWORK #184 items 1 and 4).
//
// Runtime, on fixtures:
//   1. Buy Signals: buy score >= 3 (above MA200 and 2 more). Sell Signals: 2+
//      of the 5, one of them overbought or a bearish divergence.
//   2. ATR spike, alternative B: today's true range >= 2x the PRIOR ATR(14).
//   3. Earnings growth order (lib/epsGrowthView): % highest first, then the
//      small-base group (prior EPS under $0.50, #553 COWORK #195) by $ change, then no figure, A-Z.
//   4. Dividends (pickersSecFundamentals.dividendRead): a Q4 stated only in the
//      10-K is derived (NSC); a special is left out (PGR); a cut shows the
//      latest quarter x4, marked (FMC, LYB); the row is split-adjusted (BKNG);
//      payout on a loss reads A's "Loss"; an IFRS-only filer's "–" says why.
// Source:
//   5. the build uses rule B and gates the 20%-from-ATH pullback on MA200; the
//      page and the /pickers hub list through the shared rules; the growth
//      section carries its view; the grid's column and marks; the copy says
//      what each rule does.
// Every rule has a planted mutant.
//
//   node scripts/check-picker-screen-rules.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const RULES = "lib/pickerScreenRules.ts";
const VIEW = "lib/epsGrowthView.ts";
const FUND = "lib/server/pickersSecFundamentals.ts";
const BUILDER = "lib/server/pickersBuilder.ts";
const PAGE = "app/components/PickerResultPage.tsx";
const HUB = "app/pickers/PickersClient.tsx";
const GRID = "app/components/PickerResultsGrid.tsx";
const WHY = "lib/pickerCellWhy.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const tmp = [];
let seq = 0;
async function load(rel, src) {
  const f = path.join(path.dirname(path.join(ROOT, rel)), `.check-psr-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}
const { SEC_FIELDS } = await import(pathToFileURL(path.join(ROOT, "lib/server/secFields.ts")).href);
const DI = SEC_FIELDS.findIndex((f) => f.key === "dividendsDeclaredPerShare");
const EI = SEC_FIELDS.findIndex((f) => f.key === "epsDiluted");
const AAPL = JSON.parse(read("data/sec/factset-fixture-AAPL.json"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const close = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-6;

// ── 1-2 ─────────────────────────────────────────────────────────────────────
function ruleRules(R) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  want("buy: score 3 lists, 2 does not", R.qualifiesBuySignal(3) && !R.qualifiesBuySignal(2) && R.BUY_SIGNAL_MIN_SCORE === 3);
  want("sell: two plain states (below MA50 and MA200) do not list", !R.qualifiesSellSignal({}, 2));
  want("sell: a state plus overbought lists", R.qualifiesSellSignal({ overbought: true }, 2));
  want("sell: a divergence plus a state lists", R.qualifiesSellSignal({ bearishMacdDivergence: true }, 2) && R.qualifiesSellSignal({ bearishRsiDivergence: true }, 2));
  want("sell: one condition alone does not list", !R.qualifiesSellSignal({ overbought: true }, 1));
  const bars = (last) => [{ close: 10, high: 10.5, low: 9.5 }, { close: 10, high: 10.5, low: 9.5 }, last];
  const atr = [null, 1, 1];
  want("ATR B: a range of 2x the prior ATR fires", R.trueRangeSpike(bars({ close: 11, high: 11.5, low: 9.5 }), atr));
  want("ATR B: just under 2x does not", !R.trueRangeSpike(bars({ close: 10, high: 10.95, low: 9.0 }), atr));
  want("ATR B: a gap counts (true range uses the prior close)", R.trueRangeSpike(bars({ close: 12.2, high: 12.5, low: 12.0 }), atr));
  want("ATR B: against the PRIOR ATR, not today's", !R.trueRangeSpike(bars({ close: 11, high: 11.5, low: 9.5 }), [null, 1.2, 1]));
  want("ATR B: no prior ATR, no spike", !R.trueRangeSpike(bars({ close: 11, high: 12, low: 9 }), [null, null, 1]));
  return fails;
}

// ── 3 ───────────────────────────────────────────────────────────────────────
function viewRules(V) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const g = (eps, epsPrior) => V.epsGrowthView({ eps, epsPrior, label: "Q2 FY2026", priorLabel: "Q2 FY2025", basis: "quarter" }, Math.round(((eps - epsPrior) / epsPrior) * 100));
  const rows = [
    { symbol: "ZZZ" },
    { symbol: "SMB", epsGrowth: g(0.5, 0.07) },
    { symbol: "LOW", epsGrowth: g(1.2, 1.0) },
    { symbol: "SMA", epsGrowth: g(0.2, 0.01) }, // the larger %, the smaller $
    { symbol: "AAA" },
    { symbol: "TOP", epsGrowth: g(3, 1) },
  ];
  const order = [...rows].sort(V.compareEpsGrowth).map((r) => r.symbol).join();
  want("% highest first, then small bases by $ change, then no figure A-Z", order === "TOP,LOW,SMB,SMA,AAA,ZZZ");
  // #553 COWORK #195: the line is $0.50 -- $0.49 a year ago is a small base, $0.50 is ranked by %.
  want("a prior EPS under $0.50 is a small base ($0.49 is, $0.50 is not)", g(1, 0.49).small && !g(1, 0.5).small && g(0.5, 0.0999).small && V.SMALL_BASE_PRIOR_EPS === 0.5);
  want("a small base shows the $ change, not the %", V.epsGrowthText(g(0.5, 0.07)) === "+$0.43" && V.epsGrowthText(g(3, 1)) === "+200.0%");
  want("the tap names both periods and, for a small base, why dollars", /Q2 FY2026 vs Q2 FY2025/.test(V.epsGrowthTip(g(3, 1))) && /small base/i.test(V.epsGrowthTip(g(0.5, 0.07))));
  return fails;
}

// ── 4 ───────────────────────────────────────────────────────────────────────
function setDps(set, vals) { vals.forEach((v, i) => { set.quarters[i].v[DI] = v; }); return set; }
function dividendRules(F) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` (${detail})` : ""}`); };
  // AAPL's quarters: Q3 Q2 Q1 FY2026, Q4 FY2025 (ends with FY2025), Q3 Q2 Q1 FY2025, ...
  const base = setDps(clone(AAPL), [1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35]);
  // NSC: Q4 only inside the 10-K.
  const nsc = clone(base);
  nsc.quarters[3].v[DI] = null;
  nsc.years[0].v[DI] = 5.4;
  const q = F.quarterlyDps(nsc);
  want("a Q4 stated only in the 10-K is the year less Q1-Q3", close(q[3], 1.35), String(q[3]));
  const nr = F.dividendRead(nsc);
  want("...so four quarters are on file again (NSC's payout)", close(nr.four?.regular, 5.4), JSON.stringify(nr.four));
  // PGR: a special in Q4.
  const pgr = setDps(clone(AAPL), [0.1, 0.1, 0.1, 13.6, 0.1, 0.1, 0.1, 4.6]);
  const pr = F.dividendRead(pgr);
  want("a special is left out: regular four quarters", close(pr.four?.regular, 0.4) && close(pr.four?.special, 13.5), JSON.stringify(pr.four));
  want("...and out of the growth (regular against regular)", close(pr.growth, 0), String(pr.growth));
  const prow = F.buildSecPickerRow(pgr, "2026-09-23", {}, 0);
  want("...the row shows the regular figure and carries the special", close(prow.divPerShare, 0.4) && close(prow.div?.special, 13.5), JSON.stringify({ d: prow.divPerShare, div: prow.div }));
  // FMC as filed: a cut, and a Q4 of $1.74 (three quarters at the old $0.58)
  // that a median of all four, dragged down by the cut, would call a special.
  const fmc = setDps(clone(AAPL), [0.08, 0.08, 1.74, 0.58, 0.58, 0.58, 0.58, 0.58]);
  const fr = F.dividendRead(fmc);
  want("a cut: the latest quarter x4", close(fr.cut?.annualised, 0.32) && close(fr.cut?.ttm, 2.48), JSON.stringify(fr.cut));
  want("...and no special read into the old rate", close(fr.four?.special, 0), String(fr.four?.special));
  const frow = F.buildSecPickerRow(fmc, "2026-09-23", {}, 0);
  want("...the row shows it, marked", close(frow.divPerShare, 0.32) && close(frow.div?.cut?.ttm, 2.48), JSON.stringify({ d: frow.divPerShare, div: frow.div }));
  // A steady payer: nothing marked.
  const steady = F.buildSecPickerRow(base, "2026-09-23", {}, 0);
  want("a steady payer: four quarters, no mark", close(steady.divPerShare, 5.4) && steady.div === undefined, JSON.stringify(steady.div));
  // A raise is not a cut.
  const raise = F.dividendRead(setDps(clone(AAPL), [1.06, 1.06, 1.06, 1.02, 1.02, 1.02, 1.02, 0.98]));
  want("a raise is not a cut", raise.cut === null);
  // Payout on a loss: A's word.
  const lossRow = F.buildSecPickerRow(base, "2026-09-23", {}, 0);
  lossRow.eps = { ...(lossRow.eps ?? { basis: "four-quarters", periodEnd: base.quarters[0].e }), val: -2.85 };
  const why = F.secPickerWhy(lossRow, 100, F.applySecPickerRow(lossRow, 100), { peRatio: null, epsTtm: -2.85, payoutRatio: null, epsBasis: null, payoutBasis: null }, "Food");
  want("payout on a loss carries payLoss", why.payout === "payLoss", String(why.payout));
  want("...which reads A's \"Loss\"", F.secPickerWords(why).payout === "Loss", JSON.stringify(F.secPickerWords(why)));
  // IFRS-only, no dividend: the reason says so.
  const ifrs = setDps(clone(AAPL), [null, null, null, null, null, null, null, null]);
  ifrs.years.forEach((y) => { y.v[DI] = null; });
  ifrs.tx = ["dei", "ifrs-full"];
  const irow = F.buildSecPickerRow(ifrs, "2026-09-23", {}, 0);
  const iwhy = F.secPickerWhy(irow, 100, F.applySecPickerRow(irow, 100), null, "Mining");
  want("an IFRS-only filer's empty Div ($) says IFRS has no per-share tag", iwhy.dps === "divIfrs" && irow.div?.ifrs === true, JSON.stringify({ why: iwhy.dps, div: irow.div }));
  return fails;
}

// ── 5 ───────────────────────────────────────────────────────────────────────
function sourceRules(src) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const b = stripComments(src.builder, { file: BUILDER });
  const p = stripComments(src.page, { file: PAGE });
  const h = stripComments(src.hub, { file: HUB });
  const g = stripComments(src.grid, { file: GRID });
  const f = stripComments(src.fund, { file: FUND });
  want("the build flags ATR spikes with rule B", /const atrSpike = trueRangeSpike\(pts, atrArr\);/.test(b));
  want("20% from ATH needs the close above MA200", /if \(drawdownPct < 20\) return null;\s*const ma200Gate = lastNum\(movingAverage\(closes, 200\)\);\s*if \(typeof ma200Gate !== "number" \|\| !\(lastClose > ma200Gate\)\) return null;/.test(b));
  want("the page lists buy and sell through the shared rules", /const qualifies = qualifiesBuySignal\(score\);/.test(p) && /const qualifies = qualifiesSellSignal\(record, score\);/.test(p));
  want("the screener flags use the same rules", /if \(qualifiesBuySignal\(getBuySignalCount\(record\)\)\) setFlag\(record\.symbol, "hasBuySignal"\);/.test(p) && /if \(qualifiesSellSignal\(record, getSellSignalCount\(record\)\)\) setFlag\(record\.symbol, "hasSellSignal"\);/.test(p));
  want("the /pickers hub's top buy and sell use them too", (h.match(/qualifiesBuySignal\(/g) ?? []).length >= 2 && (h.match(/qualifiesSellSignal\(/g) ?? []).length >= 2 && !/buyCount > 0|sellCount > 0/.test(h));
  want("the growth section item carries its view, through takeTop", /epsGrowth: earningsGrowthFromSec \? \(strongEarningsGrowthCandidate as \{ view\?: EpsGrowthView \}\)\.view : undefined,/.test(b) && /trendSeries, epsGrowth, _score, score \}\) => \(\{/.test(b) && /trendSeries,\s*epsGrowth,\s*score:/.test(b));
  want("the page copies it onto the entry", /if \(item\.epsGrowth\) entry\.epsGrowth = item\.epsGrowth;/.test(p));
  want("the grid shows EPS growth on the growth page, sorting by the page's order", /const epsGrowthPage = \/strong-earnings-growth\/i\.test\(configHref\);/.test(g) && /tie: compareEpsGrowth,/.test(g) && g.includes("if (sortCol.tie) return compareForSort(sortCol.get(a, da), sortCol.get(b, db), sortCol.sortType, sort.dir) || sortCol.tie(a, b);"));
  want("a small base renders its own cell", /ownCell: \(e\) => !!e\.epsGrowth\?\.small,/.test(g) && /if \(col\.ownCell\?\.\(e\)\) return filled\(e, d, inert\);/.test(g));
  want("the Div ($) cell carries the cut / special mark", /const mark = dividendMark\(e\);/.test(g));
  want("the row is split-adjusted before anything is read", /const set = splitAdjusted\(filed\);\s*const inputs = valuationInputs\(set, today, filer\);/.test(f));
  want("Div ($) is the cut figure, else the regular four quarters", /const divPerShare = read\.cut \? read\.cut\.annualised : read\.four \? read\.four\.regular : dps \? dps\.vals\.dividendsDeclaredPerShare : null;/.test(f));
  want("the page ships the marks only beside a shown figure", /if \(row\.div\?\.cut && figures\.divPerShare !== null\) entry\.divCut = row\.div\.cut;/.test(p) && /if \(row\.div\?\.special && figures\.divPerShare !== null\) entry\.divSpecial = row\.div\.special;/.test(p));
  // The copy says what each rule does.
  want("ATR copy names the rule", /at least twice its 14-day ATR as of the session before/.test(src.atrPage));
  want("ATH copy names MA200", /still trading above its 200-day moving average/.test(src.athPage));
  want("Buy copy names the rule", /above its 200-day moving average and meets at least two more/.test(src.buyPage));
  want("Sell copy names the rule", /two or more of the five bearish conditions, at least one of them overbought or a bearish divergence/.test(src.sellPage));
  want("Weekly MA200 copy names the history it needs", /needs about 4 years of price history/.test(src.weeklyPage));
  want("the Dividends tab note names \"Loss\"", /dividends: `\$\{OWNER_LEAD\}; 'Loss' means earnings per share weren't positive, so there's no payout ratio\.`/.test(stripComments(src.why, { file: WHY })));
  return fails;
}

try {
  const rulesSrc = read(RULES), viewSrc = read(VIEW), fundSrc = read(FUND);
  console.log("\n1-2. Buy, Sell, ATR B");
  const r = ruleRules(await load(RULES, rulesSrc));
  check("buy >= 3; sell 2+ with a reading; true range >= 2x the prior ATR", r.length === 0, r.join("; "));
  console.log("\n3. Earnings growth order");
  const v = viewRules(await load(VIEW, viewSrc));
  check("% first, small bases by $, no figure A-Z", v.length === 0, v.join("; "));
  console.log("\n4. Dividends");
  const d = dividendRules(await load(FUND, fundSrc));
  check("Q4 derived, special out, cut marked, Loss, IFRS reason", d.length === 0, d.join("; "));
  console.log("\n5. Source and copy");
  const src = {
    builder: read(BUILDER), page: read(PAGE), hub: read(HUB), grid: read(GRID), fund: fundSrc, why: read(WHY),
    atrPage: read("app/atr-spike-stocks/page.tsx"), athPage: read("app/stocks-down-20-from-all-time-highs/page.tsx"),
    buyPage: read("app/top-stocks-with-buy-signals/page.tsx"), sellPage: read("app/top-stocks-with-sell-signals/page.tsx"),
    weeklyPage: read("app/stocks-near-weekly-200-day-moving-average/page.tsx"),
  };
  const s = sourceRules(src);
  check("wiring and copy", s.length === 0, s.join("; "));

  console.log("\n6. Planted mutants");
  const RUNTIME = [
    ["buy back to any score", RULES, rulesSrc, "export const BUY_SIGNAL_MIN_SCORE = 3;", "export const BUY_SIGNAL_MIN_SCORE = 1;", ruleRules],
    ["sell lists plain states", RULES, rulesSrc, "return sellScore >= 2 && !!(r.overbought || r.bearishRsiDivergence || r.bearishMacdDivergence);", "return sellScore >= 2;", ruleRules],
    ["ATR against today's ATR", RULES, rulesSrc, "const prevAtr = atr14[n - 2];", "const prevAtr = atr14[n - 1];", ruleRules],
    ["ATR ignores the gap", RULES, rulesSrc, "Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose))", "(h - l)", ruleRules],
    ["small bases ranked by %", VIEW, viewSrc, "(ga.small ? gb.change - ga.change : gb.pct - ga.pct)", "(gb.pct - ga.pct)", viewRules],
    ["small bases mixed into the ranking", VIEW, viewSrc, "(g === null ? 2 : g.small ? 1 : 0)", "(g === null ? 2 : 0)", viewRules],
    ["the small-base line back at $0.10", VIEW, viewSrc, "SMALL_BASE_PRIOR_EPS = 0.5;", "SMALL_BASE_PRIOR_EPS = 0.1;", viewRules],
    ["no Q4 derivation", FUND, fundSrc, `if (own !== null || q.fp !== "Q4" || q.fy == null) return own;`, "return own;", dividendRules],
    ["specials counted as regular", FUND, fundSrc, "if (top > 0 && x > SPECIAL_MULTIPLE * top) {", "if (false) {", dividendRules],
    ["specials against the median of all four", FUND, fundSrc, "const top = Math.max(...others);", "const top = median(v);", dividendRules],
    ["no cut", FUND, fundSrc, "if (before > 0 && now.quarters[0] < CUT_SHARE * before) cut =", "if (false) cut =", dividendRules],
    ["no Loss on payout", FUND, fundSrc, `ads ? "adsE" : loss ? "payLoss" :`, `ads ? "adsE" :`, dividendRules],
    ["no IFRS reason", FUND, fundSrc, `(row.div?.ifrs ? "divIfrs" : "noDiv")`, `"noDiv"`, dividendRules],
  ];
  for (const [label, rel, srcText, from, to, rules] of RUNTIME) {
    if (!srcText.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = rules(await load(rel, srcText.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const SOURCE = [
    ["the old ATR rule back", "builder", "const atrSpike = trueRangeSpike(pts, atrArr);", "const atrSpike = false;"],
    ["the ATH MA200 gate dropped", "builder", "  if (typeof ma200Gate !== \"number\" || !(lastClose > ma200Gate)) return null;\n", ""],
    ["the page lists any buy score", "page", "const qualifies = qualifiesBuySignal(score);", "const qualifies = score > 0;"],
    ["the hub keeps the old sell rule", "hub", ".filter((i) => i.qualifies)", ".filter((i) => i.sellCount > 0)"],
    ["takeTop drops the growth view", "builder", "        epsGrowth,\n        score:", "        score:"],
    ["the row not split-adjusted", "fund", "  const set = splitAdjusted(filed);\n", "  const set = filed;\n"],
    ["the cut mark shipped beside an empty cell", "page", "if (row.div?.cut && figures.divPerShare !== null) entry.divCut", "if (row.div?.cut) entry.divCut"],
    ["the ATR copy reverts", "atrPage", "at least twice its 14-day ATR as of the session before", "high"],
  ];
  for (const [label, which, from, to] of SOURCE) {
    if (!src[which].includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = sourceRules({ ...src, [which]: src[which].replace(from, to) });
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
