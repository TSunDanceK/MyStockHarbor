// THE CAPEX PAGE'S "WHY FOLLOW THE MONEY?" CARD (#563 COWORK #110): rules, then mutants.
//
// app/bottlenecks/capex/WhyFollowMoney.tsx is transpiled and rendered; the page
// (app/bottlenecks/capex/page.tsx) is read as source. Rules: directly under
// "Where the money is going" (so right after it in the phone's stacked order);
// the old "Reading this page" card folded in and gone; the copy hedged, with no
// advice words and no numbers of its own; "How to use this page" closed, behind
// a tap; reading sizes from the tokens and the fine print tagged; no fetch.
// A mutant each.
//
//   node scripts/check-capex-why.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stripComments } from "./lib/source-code.mjs";

const CARD = "app/bottlenecks/capex/WhyFollowMoney.tsx", PAGE = "app/bottlenecks/capex/page.tsx";
const read = (f) => fs.readFileSync(f, "utf8");

let n = 0;
async function load(src) {
  const js = ts.transpileModule(src.replace(/^import type[^;]+;$/gm, ""), { fileName: "w.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText;
  const tmp = `scripts/.check-capex-why-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
// "sell to" / "sells to" describes a supplier, not advice.
const ADVICE = /\b(buy|buying|sell(?!s? to\b)|selling|should|must|recommend(?!ation\b)\w*|consider|opportunit\w*|bargain|undervalued|overvalued|cheap|target|upside|downside|will)\b/i;

const RULES = {
  "directly under 'Where the money is going', before 'Who is spending most'; same place in the phone's stacked order": ({ page }) => {
    const where = page.indexOf('<div className="cardEyebrow">Where the money is going</div>'), why = page.indexOf("<WhyFollowMoney />"), next = page.indexOf('<div className="cardEyebrow">Who is spending most</div>');
    const between = page.slice(where, why);
    return where > 0 && why > where && next > why && /<\/section>\s*\) : null\}\s*$/.test(between.replace(/\{\s*\}\s*$/, "")) &&
      (page.match(/<WhyFollowMoney \/>/g) ?? []).length === 1 && /^import WhyFollowMoney from "\.\/WhyFollowMoney";$/m.test(page) &&
      !/\.capexWhy\s*\{[^}]*order/.test(page);
  },
  "the old 'What it means · Reading this page' card is folded in and removed": ({ page, M }) =>
    !/Reading this page|What it means/.test(page) && /free cash flow/.test(M.WHY_LINES.join(" ")) &&
    /share of revenue/.test(M.HOW_STEPS.map((s) => s.join("")).join(" ")) && /not linked/.test(M.HOW_STEPS.map((s) => s.join("")).join(" ")),
  "the copy: the three lines up front, the five steps, the fine print; hedged, no advice, no numbers": ({ M, html }) => {
    const t = text(html);
    return M.WHY_LINES.length === 3 && M.HOW_STEPS.length === 5 && /^Capital spending \(capex\) is a company's bet on future demand\./.test(M.WHY_LINES[0]) &&
      M.WHY_LINES.every((l) => t.includes(l)) && M.HOW_STEPS.every(([a, b]) => t.includes(`${a}${b}`.replace(/\s+/g, " ").trim()) || t.includes(a)) &&
      M.WHY_FINE === "Filed and published figures only. Not a forecast or a recommendation." && t.includes(M.WHY_FINE) &&
      /\bmay\b/.test(M.WHY_LINES.join(" ")) && !ADVICE.test(t) && !/\d/.test(t) &&
      /<div class="cardEyebrow"[^>]*>Why it matters<\/div>/.test(html) && /<h3[^>]*>Why follow the money\?<\/h3>/.test(html);
  },
  "'How to use this page' is closed, behind a tap": ({ html }) =>
    /<details class="capexWhyHow"(?![^>]*\bopen\b)[^>]*><summary[^>]*>How to use this page<\/summary><ol/.test(html),
  "reading sizes from the tokens; the fine print tagged at --fs-fine; nothing in px": ({ card, html }) =>
    /const readStyle: CSSProperties = \{[^}]*fontSize: "var\(--fs-read\)", lineHeight: "var\(--lh-read\)"/.test(card) &&
    /const summaryStyle: CSSProperties = \{[^}]*fontSize: "var\(--fs-read\)"/.test(card) &&
    /<p data-fine-print="true" style="[^"]*font-size:var\(--fs-fine\)[^"]*">Filed and published figures only/.test(html) &&
    !/fontSize:\s*\d/.test(card) && (html.match(/font-size:var\(--fs-read\)/g) ?? []).length >= 5,
  "no fetch, no data of its own": ({ card }) => !/\bfetch\(|redis|@\/lib\/server|import\(/i.test(card) && !/^import (?!type )/m.test(card),
};

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const measure = async (cardSrc, pageSrc) => {
  const M = await load(cardSrc);
  return { M, html: renderToStaticMarkup(React.createElement(M.default)), card: stripComments(cardSrc, { file: CARD }), page: stripComments(pageSrc, { file: PAGE }) };
};
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };

const cardSrc = read(CARD), pageSrc = read(PAGE);
console.log("=== Rules ===");
const base = await measure(cardSrc, pageSrc);
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));

const R = Object.keys(RULES);
const find = (start) => { const r = R.find((x) => x.startsWith(start)); if (!r) throw new Error(`no rule ${start}`); return r; };
const OLD_CARD = `      <section className="capexCard">\n        <div className="cardEyebrow">What it means</div>\n        <h3>Reading this page</h3>\n      </section>\n    </aside>`;
// [rule, "c" (card) or "p" (page), mutation]
const MUTANTS = [
  ["directly under", "p", (s) => s.replace("      <WhyFollowMoney />\n", "").replace("    </aside>", "      <WhyFollowMoney />\n    </aside>")],
  ["directly under", "p", (s) => s.replace(".capexSide { display: grid;", ".capexWhy { order: 9; } .capexSide { display: grid;")],
  ["the old 'What it means", "p", (s) => s.replace("    </aside>", OLD_CARD)],
  ["the old 'What it means", "c", (s) => s.replace(" while weighing on the spender's free cash flow.", ".")],
  ["the copy:", "c", (s) => s.replace("may see it in their own sales.", "will see it in their own sales.")],
  ["the copy:", "c", (s) => s.replace("as a separate view of where government money goes.", "as a separate view of where government money goes; buy the leaders.")],
  ["the copy:", "c", (s) => s.replace("since the first year shown,", "since 2021,")],
  ["the copy:", "c", (s) => s.replace('export const WHY_FINE = "Filed and published figures only. Not a forecast or a recommendation.";', 'export const WHY_FINE = "Filed and published figures only.";')],
  ["'How to use this page' is closed", "c", (s) => s.replace('<details className="capexWhyHow"', '<details open className="capexWhyHow"')],
  ["reading sizes", "c", (s) => s.replace('const readStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: "var(--fs-read)",', 'const readStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: 14,')],
  ["reading sizes", "c", (s) => s.replace("<p data-fine-print style={fineStyle}>", "<p style={fineStyle}>")],
  ["no fetch", "c", (s) => s.replace("export default function WhyFollowMoney() {", "export async function peek() { return fetch(\"/x\"); }\nexport default function WhyFollowMoney() {")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [start, where, mutate] of MUTANTS) {
  const label = find(start), src = where === "c" ? cardSrc : pageSrc, mut = mutate(src);
  if (mut === src) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  let m;
  try { m = await measure(where === "c" ? mut : cardSrc, where === "p" ? mut : pageSrc); } catch { m = null; }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
