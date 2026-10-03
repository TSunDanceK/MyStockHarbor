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
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";

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

const ONDS = JSON.parse(fs.readFileSync("data/sec/factset-fixture-ONDS.json", "utf8"));
const asOfQ1 = () => { const s = structuredClone(ONDS); s.quarters = s.quarters.slice(1); return s; };

async function measure(M) {
  const view = M.buildSecEarningsView(ONDS);
  const q1Note = M.buildSecEarningsView(asOfQ1()).largeNonOperatingNote;
  const markup = html(React.createElement(M.SecGrowthMarginsCard, { view }));
  return { view, q1Note, markup, text: visibleText(markup) };
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
  "the full table sits under \"See all the numbers\"":
    ({ markup }) => /<details class="gvAll">[\s\S]*See all the numbers[\s\S]*<table class="historyTable">/.test(markup),
};

const real = await measure(await loadCards());
for (const [name, rule] of Object.entries(RULES)) check(name, rule(real));

const MUTANTS = [
  ["the card passes no notes (profit chart stays off)", (s) => once(s, "buildGrowthVisuals(view, { oneOffs: view.oneOffs })", "buildGrowthVisuals(view)")],
  ["the notes computed for the latest period only", (s) => once(s, "q.map((p) => [periodLabel(p), largeNonOperatingNote(", "q.slice(0, 1).map((p) => [periodLabel(p), largeNonOperatingNote(")],
  ["annual net income dropped", (s) => once(s, "      ...marginsOf(p),\n      netIncome: view(p, \"netIncome\", \"Net income\"),\n", "      ...marginsOf(p),\n")],
  ["the table no longer collapsed", (s) => once(s, "<SeeAllTheNumbers>", "<>").replace("</SeeAllTheNumbers>", "</>")],
];
for (const [label, mutate] of MUTANTS) {
  let caught;
  try {
    const m = await measure(await loadCards(mutate));
    caught = Object.values(RULES).some((r) => !r(m));
  } catch { caught = true; }
  check(`MUTATION: ${label} → caught`, caught);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
