// THE EARNINGS SNAPSHOT TILE'S REDESIGN (#552 COWORK #134 / #135).
//
//   1. the latest report date sits in small print by the title;
//   2. "Next earnings" is gone from the tile (hidden, not removed);
//   3. a small annual chart: the last 4 fiscal years, Revenue and Net income
//      bars, Net margin % as a purple line with dots, a one-line legend, each
//      year's figures on a tap; a loss draws below zero; a year with no usable
//      revenue gets no bar and a reason; under 2 drawable years, a reason line;
//   4. the Revenue, Net income and Net margin tiles are gone; EPS, Gross and
//      Operating margin stay.
//
// Driven through the shipped snapshot builder and card (render-snapshot.mjs)
// on committed SEC fixtures: AAPL, a loss-maker (BYND), IFRS filers (AZN,
// KGC), AVAV, plus AAPL with its gross profit removed (the bank shape) and
// AAPL cut to too few years. A mutant per rule.
//
//   node scripts/check-snapshot-annual-chart.mjs
import fs from "node:fs";
import { loadSnapshot, once, html, visibleText, React } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const fixture = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));

function snap(S, symbol, set) {
  const view = S.buildSecEarningsView(set);
  const score = S.scoreFromSec(view, symbol, { status: "ready", set, cold: false });
  const reported = view.latestFiled ? { on: view.latestFiled, via: "filing", timing: null } : null;
  const snapshot = S.buildSecEarningsSnapshot({ symbol, view, score, reported, nextReport: { kind: "none", headline: "X is expected to report in roughly 22 to 30 days.", value: null, hedge: "An estimate from past reports." } });
  const markup = html(React.createElement(S.default, { snapshot, symbol }));
  return { view, snapshot, markup, text: visibleText(markup) };
}

/** AAPL with gross profit and cost of revenue blanked: a bank's shape (no gross margin). */
function bankShape(S) {
  const s = structuredClone(fixture("AAPL"));
  for (const k of ["grossProfit", "costOfRevenue"]) {
    const i = S.SEC_FIELD_KEYS.indexOf(k);
    if (i < 0) continue;
    for (const list of [s.quarters, s.years]) for (const p of list) if (Array.isArray(p.v)) p.v[i] = null;
  }
  return s;
}
/** AAPL with only two stored years: one year has a prior, so one row, under the bar. */
const tooFew = () => { const s = structuredClone(fixture("AAPL")); s.years = s.years.slice(0, 2); return s; };
/** BYND with its newest year's revenue removed: a year with no usable revenue. */
function noRevenueYear(S) {
  const s = structuredClone(fixture("BYND"));
  const i = S.SEC_FIELD_KEYS.indexOf("revenue");
  s.years[0].v[i] = null;
  return s;
}

const yearsOf = (markup) => [...markup.matchAll(/data-snapshot-year="([^"]+)"/g)].map((m) => m[1]);
const bars = (markup, kind) => (markup.match(new RegExp(`data-bar="${kind}"`, "g")) ?? []).length;

async function measure(S) {
  const out = {};
  for (const sym of ["AAPL", "BYND", "AZN", "KGC", "AVAV"]) out[sym] = snap(S, sym, fixture(sym));
  out.BANK = snap(S, "BANK", bankShape(S));
  out.FEW = snap(S, "FEW", tooFew());
  out.NOREV = snap(S, "NOREV", noRevenueYear(S));
  return out;
}

const RULES = {
  "1. the latest report date is small print by the title": (m) =>
    /data-snapshot-reported="">Latest report \d{1,2} \w{3,4} \d{4} · Filed with the SEC</.test(m.AAPL.markup),
  "2. no 'Next earnings', headline or hedge in the tile": (m) =>
    Object.values(m).every((r) => !/Next earnings/i.test(r.text) && !r.text.includes("expected to report in roughly") && !r.text.includes("An estimate from past reports")),
  "3a. the chart shows the last 4 fiscal years, oldest first, labelled '22-style": (m) => {
    const y = yearsOf(m.AAPL.markup);
    const want = m.AAPL.view.annual.slice(-4).map((a) => a.label);
    return y.length === 4 && y.join() === want.join() && /data-snapshot-year="FY\d{4}"[^>]*><span[^>]*>'\d{2}</.test(m.AAPL.markup.replace(/<button[^>]*>/g, "<span>"))
      || (y.length === 4 && y.join() === want.join() && m.AAPL.snapshot.annualChart.years.every((x) => /^'\d{2}$/.test(x.short)));
  },
  "3b. revenue and net income bars per drawable year, in the growth palette": (m) =>
    bars(m.AAPL.markup, "revenue") === 4 && bars(m.AAPL.markup, "profit") === 4 &&
    /data-bar="revenue"[^>]*fill="#3987e5"/.test(m.AAPL.markup) && /data-bar="profit"[^>]*fill="#0ca30c"/.test(m.AAPL.markup),
  "3c. net margin: purple dots joined by a purple line, newest value labelled": (m) => {
    const dots = (m.AAPL.markup.match(/<circle data-margin-dot=""[^>]*fill="#9085e9"/g) ?? []).length;
    const last = m.AAPL.snapshot.annualChart.years.at(-1).netMargin;
    return dots === 4 && /<path [^>]*stroke="#9085e9"/.test(m.AAPL.markup) &&
      new RegExp(`data-margin-latest=""[^>]*>${last.toFixed(1)}%<`).test(m.AAPL.markup);
  },
  "3d. a one-line legend: Revenue · Net income · Net margin %": (m) =>
    /data-snapshot-legend="">.*Revenue.*Net income.*Net margin %/.test(m.AAPL.markup.replace(/\n/g, "")),
  "3e. each year's figures open on a tap (ReasonedValue), in A's words": (m) => {
    const y = m.AAPL.snapshot.annualChart.years.at(-1);
    return m.AAPL.markup.includes(`${y.label}: Revenue ${y.revenueText} · Net income ${y.netIncomeText}`.replace(/'/g, "&#x27;"));
  },
  "3f. a loss year draws below zero in the loss red, with a negative margin": (m) => {
    const years = m.BYND.snapshot.annualChart.years;
    const losses = years.filter((y) => y.netIncome !== null && y.netIncome < 0).length;
    return losses > 0 && bars(m.BYND.markup, "loss") === losses && /data-bar="loss"[^>]*fill="#d03b3b"/.test(m.BYND.markup) &&
      years.filter((y) => y.netIncome !== null && y.netIncome < 0).every((y) => y.netMargin === null || y.netMargin < 0);
  },
  "3g. a year with no usable revenue: no revenue bar, a short reason, never a value": (m) => {
    const y = m.NOREV.snapshot.annualChart.years.at(-1);
    return y.revenue === null && y.revenueGap && bars(m.NOREV.markup, "revenue") === 3 && m.NOREV.text.includes(y.revenueGap.words);
  },
  "3h. under 2 drawable years: a hedged reason line, no chart": (m) =>
    /data-snapshot-chart-reason="">Not enough filed annual figures to chart yet/.test(m.FEW.markup) && !/data-snapshot-chart=""/.test(m.FEW.markup),
  "3i. IFRS filers (AZN, KGC) and AVAV chart too": (m) =>
    ["AZN", "KGC", "AVAV"].every((s) => /data-snapshot-chart=""/.test(m[s].markup) && bars(m[s].markup, "revenue") >= 2),
  "4. the Revenue, Net income and Net margin tiles are gone; EPS, Gross and Operating margin stay": (m) =>
    Object.entries(m).filter(([k]) => k !== "FEW").every(([, r]) => {
      const tiles = [...r.text.matchAll(/(EPS \(diluted[^)]*\)|Gross margin|Operating margin|Net margin|Revenue|Net income)/g)].map((x) => x[1]);
      return tiles.some((t) => t.startsWith("EPS")) && tiles.includes("Gross margin") && tiles.includes("Operating margin");
    }) && !/>Net margin<\/div><div[^>]*>/.test(m.AAPL.markup.replace(/data-snapshot-legend=""[\s\S]*?<\/div>/, "")),
  "4b. the bank shape (no gross margin) says why, and still charts": (m) =>
    /data-snapshot-chart=""/.test(m.BANK.markup) && m.BANK.snapshot.marginReasons.gross !== null && m.BANK.text.includes(m.BANK.snapshot.marginReasons.gross),
};

const S = await loadSnapshot();
const M = await measure(S);
console.log("\n=== the redesigned tile, on SEC fixtures ===");
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(M)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}

console.log("\n=== mutants: each must break a rule ===");
const MUTANTS = [
  ["the report date back in the retired row", once("{snapshot.available && snapshot.reportedOn ? (", "{false ? (")],
  ["'Next earnings' shown again", once("const SHOW_NEXT_REPORT_IN_TILE = false;", "const SHOW_NEXT_REPORT_IN_TILE = true;")],
  ["five years, not four", once("export const SNAPSHOT_CHART_YEARS = 4;", "export const SNAPSHOT_CHART_YEARS = 5;")],
  ["a loss drawn in the profit green", once("y.netIncome < 0 ? C.loss : C.profit", "C.profit")],
  ["an incomplete revenue line drawn anyway", once("const revenue = a.marginsRefused ? null : revenueVal;", "const revenue = revenueVal ?? 1;")],
  ["the margin line in another colour", once("<path key={d} d={d} fill=\"none\" stroke={C.margin}", "<path key={d} d={d} fill=\"none\" stroke={C.sales}")],
  ["no reason line when too few years", once("reason: drawable < 2", "reason: drawable < 0")],
  ["the charted tiles shown again", once("const SHOW_CHARTED_METRIC_TILES = false;", "const SHOW_CHARTED_METRIC_TILES = true;")],
  ["the year's tap note dropped", once("<ReasonedValue text={y.short} reason={yearNote(y)} />", "<span>{y.short}</span>")],
];
for (const [label, mutate] of MUTANTS) {
  let bites = false;
  try {
    const Sm = await loadSnapshot(mutate);
    const Mm = await measure(Sm);
    bites = Object.values(RULES).some((r) => { try { return !r(Mm); } catch { return true; } });
  } catch { bites = true; }
  check(`MUTATION: ${label} → caught`, bites);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
