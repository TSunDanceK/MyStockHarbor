// NO SENTENCE IN A VALUE COLUMN (#552 COWORK #137 §1).
//
// AAPL's Interest expense row printed "Not tagged separately; typically within
// other income / expense" in its value column, where it overlapped the label
// at desktop card width. A blank figure now reads a short word ("Not
// reported"), the sentence its tap note, like Other operating expense and
// noncontrolling interest. This renders every card that takes the view, on
// every committed fixture, and fails on any value cell whose visible text is
// more than three words. Plus AAPL's interest row by name, and mutants.
//
//   node scripts/check-income-row-values.mjs
import fs from "node:fs";
import { loadCards, html, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const FIXTURES = fs.readdirSync("data/sec").filter((f) => /^factset-fixture-.+\.json$/.test(f)).map((f) => f.slice(16, -5));
const CARDS = ["SecIncomeStatementCard", "SecBalanceSheetCard", "SecCashQualityCard", "SecAnnualCard", "SecRecentPeriodsCard"];
const VALUE_CELL = /white-space:nowrap;font-variant-numeric:tabular-nums">([\s\S]*?)<\/div><\/div>/g;
const visible = (s) => s.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

function scan(M) {
  const bad = [];
  for (const sym of FIXTURES) {
    const view = M.buildSecEarningsView(JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${sym}.json`, "utf8")));
    for (const card of CARDS) {
      if (!M[card]) continue;
      let markup = "";
      try { markup = html(React.createElement(M[card], { view })); } catch { continue; }
      for (const m of markup.matchAll(VALUE_CELL)) {
        const t = visible(m[1]);
        if (t.split(" ").length > 3) bad.push(`${sym} ${card}: "${t}"`);
      }
    }
  }
  return bad;
}
function aaplInterest(M) {
  const view = M.buildSecEarningsView(JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8")));
  const h = html(React.createElement(M.SecIncomeStatementCard, { view }));
  const i = h.indexOf(">Interest expense<");
  return i < 0 ? null : h.slice(i, h.indexOf("</div></div>", i));
}
const RULES = {
  "no value cell on any card, on any fixture, prints a sentence": (M) => scan(M).length === 0,
  "AAPL's Interest expense reads a dotted 'Not reported', the sentence in its tap note": (M) => {
    const row = aaplInterest(M);
    return Boolean(row) && />Not reported</.test(row) && /data-estimate-note="Not tagged separately; typically within other income \/ expense/.test(row);
  },
  "an unmapped reason sentence still reads 'Not reported', the sentence its note": (M) => {
    const h = html(React.createElement(M.CellValue, { cell: { val: null }, empty: "Some reason sentence with many words" }));
    return />Not reported</.test(h) && /data-estimate-note="Some reason sentence with many words"/.test(h);
  },
};
const M0 = await loadCards();
const bad0 = scan(M0);
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(M0)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok, name.startsWith("no value") && bad0.length ? bad0.slice(0, 3).join("; ") : "");
}
const MUTANTS = [
  ["the interest sentence back in the value column", (s) => once("[INTEREST_WITHIN_FILED_OTHER]: NOT_REPORTED,", "")(once("const sentence = !EMPTY_SHORT[empty] && isSentence(empty);", "const sentence = false;")(s))],
  ["the sentence guard removed", once("const sentence = !EMPTY_SHORT[empty] && isSentence(empty);", "const sentence = false;")],
];
for (const [label, mutate] of MUTANTS) {
  let bites = false;
  try {
    const Mm = await loadCards(mutate);
    bites = Object.values(RULES).some((r) => { try { return !r(Mm); } catch { return true; } });
  } catch { bites = true; }
  check(`MUTATION: ${label} → caught`, bites);
}
console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
