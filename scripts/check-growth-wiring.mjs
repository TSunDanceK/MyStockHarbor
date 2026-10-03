// A'S HALF OF THE GROWTH & MARGINS PICTURE (#563 COWORK #35a/#36, #552 COWORK
// #116): the view feeds C's picture what it needs, and the card draws it.
//
//   1. view.oneOffs carries EVERY period's one-off note, with the same words
//      the latest-period marker uses: ONDS as filed (latest Q2 FY2026) tags
//      Q1 FY2026, exactly as A's rule does when Q1 is the latest.
//   2. view.annual carries each year's net income as filed.
//   3. SecGrowthMarginsCard draws C's picture with those notes, so the profit
//      chart is on and Q1 FY2026 wears its "one-off" tag; the full table sits
//      under "See all the numbers"; the old single chart is gone.
//   4. Mutants: each rule broken once, and caught.
//
//   node scripts/check-growth-wiring.mjs
import fs from "node:fs";
import { loadCards, growthVisualsUnit, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  // A missing or doubled anchor is a broken mutant, never a caught one
  // (#552 COWORK #119): it is flagged here and failed below.
  if (n !== 1) throw Object.assign(new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`), { anchor: true });
  return src.replace(from, to);
};

const ONDS = JSON.parse(fs.readFileSync("data/sec/factset-fixture-ONDS.json", "utf8"));
const asOfQ1 = () => { const s = structuredClone(ONDS); s.quarters = s.quarters.slice(1); return s; };

/** ONDS with the newest fiscal year carrying a non-operating gain three times its revenue. */
const bigYear = (M) => {
  const s = structuredClone(ONDS);
  const k = (f) => M.SEC_FIELD_KEYS.indexOf(f);
  const y = s.years[0];
  y.v[k("nonOperatingIncomeExpense")] = 3 * Math.abs(y.v[k("revenue")]);
  return s;
};
/** ONDS with the newest quarter's revenue untagged: the rule cannot run on it. */
const noRevenue = (M) => {
  const s = structuredClone(ONDS);
  s.quarters[0].v[M.SEC_FIELD_KEYS.indexOf("revenue")] = null;
  return s;
};

async function measure(M) {
  const view = M.buildSecEarningsView(ONDS);
  const q1Note = M.buildSecEarningsView(asOfQ1()).largeNonOperatingNote;
  const markup = html(React.createElement(M.SecGrowthMarginsCard, { view }));
  const yearView = M.buildSecEarningsView(bigYear(M));
  const unView = M.buildSecEarningsView(noRevenue(M));
  const unLabel = unView.recentPeriods[0]?.label;
  const unMarkup = html(React.createElement(M.SecGrowthMarginsCard, { view: unView }));
  const unPic = M.buildGrowthVisuals(unView, { oneOffs: unView.oneOffs, unchecked: unView.oneOffUnchecked });
  return { view, q1Note, markup, text: visibleText(markup), yearView, unView, unLabel, unPic, unMarkup, M };
}

const RULES = {
  "view.oneOffs tags Q1 FY2026 on ONDS as filed, in the latest-period marker's own words":
    ({ view, q1Note }) => typeof q1Note === "string" && view.oneOffs["Q1 FY2026"] === q1Note,
  "a period the rule does not fire on carries no note":
    ({ view }) => Object.keys(view.oneOffs).every((k) => typeof view.oneOffs[k] === "string") && !("Q2 FY2026" in view.oneOffs && !view.largeNonOperating),
  "view.annual carries each year's net income as filed":
    ({ view }) => view.annual.length > 0 && view.annual.every((a) => a.netIncome && "val" in a.netIncome) && view.annual.some((a) => typeof a.netIncome.val === "number"),
  "the card draws the profit chart, with Q1 FY2026's one-off tag":
    ({ markup, text }) => /Profit \(\+\), above the line/.test(text) && /class="gvOneOff"[^>]*>\s*one-off/.test(markup),
  "the fiscal years are checked too: a year with a large non-operating gain carries its note (#552 COWORK #117)":
    ({ yearView }) => { const fy = yearView.annual.at(-1)?.label; return Boolean(fy && /large non-operating gain/.test(yearView.oneOffs[fy] ?? "")); },
  "a period the rule cannot run on is listed unchecked, never \"checked, none\"":
    ({ unView, unLabel }) => Boolean(unLabel) && unView.oneOffUnchecked.includes(unLabel) && !(unLabel in unView.oneOffs),
  "an unchecked period draws no profit bar and says why":
    ({ unPic, unLabel, M }) => { const p = unPic.quarters?.periods.find((x) => x.label === unLabel); return Boolean(p) && p.profit === null && p.oneOff === null && p.profitUnchecked === M.PROFIT_UNCHECKED; },
  "the card passes the unchecked list, so the page shows the reason":
    ({ unMarkup, M }) => visibleText(unMarkup).includes(M.PROFIT_UNCHECKED.replace(/’/g, "'").slice(0, 30)) || visibleText(unMarkup).includes(M.PROFIT_UNCHECKED.slice(0, 30)),
  "the full table sits under \"See all the numbers\"":
    ({ markup }) => /<details class="gvAll">[\s\S]*See all the numbers[\s\S]*<table class="historyTable">/.test(markup),
};

const real = await measure(await loadCards());
for (const [name, rule] of Object.entries(RULES)) check(name, rule(real));

const MUTANTS = [
  ["the card passes no notes (profit chart stays off)", (s) => once(s, "buildGrowthVisuals(view, { oneOffs: view.oneOffs, unchecked:", "buildGrowthVisuals(view, { unchecked:")],
  ["the notes computed for the latest period only", (s) => once(s, "oneOffRows.map(([label, rows]) => [label, largeNonOperatingNote(rows)]", "oneOffRows.slice(0, 1).map(([label, rows]) => [label, largeNonOperatingNote(rows)]")],
  ["annual net income dropped", (s) => once(s, "      ...marginsOf(p),\n      netIncome: view(p, \"netIncome\", \"Net income\"),\n", "      ...marginsOf(p),\n")],
  ["the rule treated as always runnable", (s) => once(s, "  return nonOp !== null && op !== null && rev !== null && rev > 0;\n}", "  return true || (nonOp !== null && op !== null && rev !== null && rev > 0);\n}")],
  ["the fiscal years left out of the check", (s) => once(s, "[...q, ...set.years].map((p) => [periodLabel(p)", "[...q].map((p) => [periodLabel(p)")],
  ["the builder ignores the unchecked list", (s) => s + once(growthVisualsUnit(), "const unchecked = new Set(opts.unchecked ?? []);", "const unchecked = new Set();")],
  ["the card drops the unchecked list", (s) => once(s, "{ oneOffs: view.oneOffs, unchecked: view.oneOffUnchecked }", "{ oneOffs: view.oneOffs }")],
  ["the table no longer collapsed", (s) => once(s, "<SeeAllTheNumbers>", "<>").replace("</SeeAllTheNumbers>", "</>")],
];
for (const [label, mutate] of MUTANTS) {
  let caught;
  let why = "";
  try {
    const m = await measure(await loadCards(mutate));
    caught = Object.values(RULES).some((r) => !r(m));
  } catch (e) {
    caught = !e?.anchor;
    if (e?.anchor) why = e.message;
  }
  check(`MUTATION: ${label} → caught`, caught, why);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
