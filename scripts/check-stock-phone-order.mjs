// THE STOCK PAGE ON PHONES, MOST USEFUL FIRST (#563 COWORK #82).
//
// At 900px and below the sidebar stacks into the page's one column. Instead
// of dropping below the whole main column (Key levels and the Earnings
// snapshot used to sit at the very bottom), the sidebar and main column step
// aside (display: contents) and their sections are ordered by CSS:
//   chart · Price zones (#84) · Key levels · Price levels & signals · Earnings snapshot ·
//   valuation · price action · chart summary · company profile ·
//   change stock · explore · FAQ
// (The header and its performance strip sit above the layout, so first.)
//
// The rules read app/stock/[symbol]/StockSymbolPageClient.tsx (comments
// stripped):
//   - the phone order, from the ≤900px block's `order` values
//   - every section in the DOM once (no card rendered twice), each with an order
//   - the sidebar never sticky (owner ruling, #86: it scrolls with the page)
//   - desktop and tablet unchanged: no ordering or display: contents outside
//     the ≤900px block, and the desktop DOM order as it was
// Mutants: each rule broken once, caught.
//
// The rendered layout is measured in Chromium separately (not here: the suite
// runs without a browser).
//
//   node scripts/check-stock-phone-order.mjs
import fs from "node:fs";
import { stripComments } from "./lib/source-code.mjs";

const FILE = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const PHONE = ["chart", "confluence", "keylevels", "signals", "earnings", "valuation", "returns", "summary", "profile", "changestock", "explore", "faq"];
// The DOM order: the sidebar first (Key levels, Earnings), then the main column as on desktop,
// with the phone-only Change stock copy (hidden above 900px) just before Explore.
const DOM = ["confluence", "keylevels", "earnings", "chart", "returns", "signals", "valuation", "summary", "profile", "changestock", "explore", "faq"];
// What desktop shows in the main column, top to bottom (unchanged by #82).
const DESKTOP_MAIN = ["chart", "returns", "signals", "valuation", "summary", "profile", "explore", "faq"];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** The ≤900px block of the page's <style>, and the page's CSS outside it. */
function css(code) {
  code = [...code.matchAll(/<style>\{`([\s\S]*?)`\}<\/style>/g)].map((m) => m[1]).join("\n");
  const at = code.indexOf("@media (max-width: 900px) {");
  if (at < 0) return { phone: "", rest: code };
  let depth = 0, end = at;
  for (let i = code.indexOf("{", at); i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) { end = i + 1; break; }
  }
  return { phone: code.slice(at, end), rest: code.slice(0, at) + code.slice(end) };
}

function read(src) {
  const code = stripComments(src, { file: FILE });
  const { phone, rest } = css(code);
  const order = Object.fromEntries([...phone.matchAll(/\.sp-([a-z]+) \{ order: (\d+); \}/g)].map((m) => [m[1], Number(m[2])]));
  const dom = [...code.matchAll(/className="[^"]*\bsp-slot sp-([a-z]+)\b/g)].map((m) => m[1]);
  return {
    code, phone, rest, order, dom,
    phoneOrder: Object.keys(order).sort((a, b) => order[a] - order[b]),
    fallback: /\.stock-page-sidebar > \*, \.stock-page-main > \* \{ order: (\d+); min-width: 0; \}/.exec(phone)?.[1] ?? null,
  };
}

const RULES = {
  "phones: chart, Price zones, Key levels, signals, Earnings, valuation, price action, summary, profile, change stock, explore, FAQ": (r) =>
    JSON.stringify(r.phoneOrder) === JSON.stringify(PHONE) && new Set(Object.values(r.order)).size === PHONE.length &&
    /\.stock-page-sidebar, \.stock-page-main \{ display: contents; \}/.test(r.phone) &&
    /\.stock-page-layout \{ grid-template-columns: minmax\(0, 1fr\) !important; gap: 0; \}/.test(r.phone),
  "anything unlisted (a new section, the hidden analyst block) falls after the profile, before change stock": (r) =>
    r.fallback !== null && Number(r.fallback) > r.order.profile && Number(r.fallback) < r.order.changestock,
  "each section in the DOM once, each ordered; no card rendered twice": (r) =>
    PHONE.every((k) => r.dom.filter((d) => d === k).length === 1 && Number.isFinite(r.order[k])) && r.dom.length === PHONE.length &&
    (r.code.match(/<KeyLevelsCard\b/g) ?? []).length === 1 && (r.code.match(/<ConfluenceCard\b/g) ?? []).length === 1 && (r.code.match(/<LatestEarningsCard\b/g) ?? []).length === 1 &&
    (r.code.match(/<LevelsSignals\b/g) ?? []).length === 1 && (r.code.match(/<StockPriceChart\b/g) ?? []).length === 1 &&
    // The two Change stock cards were already a pair, one shown per width; still two, never both shown.
    (r.code.match(/<StockTickerJump\b/g) ?? []).length === 2 &&
    /\.mobile-change-stock \{ display: none; \}/.test(r.rest) && /\.sidebar-change-stock \{ display: none !important; \}/.test(r.phone),
  "desktop and tablet unchanged: no ordering or display: contents above 900px, the DOM order as it was": (r) =>
    !/display: contents|\border:|\.sp-[a-z]+ \{/.test(r.rest) &&
    JSON.stringify(r.dom) === JSON.stringify(DOM) &&
    JSON.stringify(r.dom.filter((d) => DESKTOP_MAIN.includes(d))) === JSON.stringify(DESKTOP_MAIN) &&
    // The sidebar keeps Key levels then Earnings, after the desktop Change stock.
    /<aside className="stock-page-sidebar">[\s{}]*<div className="sidebar-change-stock"[\s\S]*?sp-confluence[\s\S]*?sp-keylevels[\s\S]*?sp-earnings[\s\S]*?<\/aside>/.test(r.code),
  "the sidebar scrolls with the page: never sticky, at any width (owner ruling, #86)": (r) =>
    /\.stock-page-sidebar \{\s*display: flex;\s*flex-direction: column;\s*gap: 16px;\s*\}/.test(r.rest) &&
    !/position:\s*sticky/.test(r.rest + r.phone),
};

const src = fs.readFileSync(FILE, "utf8");
console.log("=== Rules ===");
const base = read(src);
for (const [label, rule] of Object.entries(RULES)) check(label, rule(base), label.startsWith("phones") ? base.phoneOrder.join(" → ") : "");

const swap = (s, a, b) => s.replace(a, "\u0000").replace(b, a).replace("\u0000", b);
const MUTANTS = [
  ["phones: chart, Price zones, Key levels, signals, Earnings, valuation, price action, summary, profile, change stock, explore, FAQ", (s) => swap(s, ".sp-chart { order: 10; }", ".sp-keylevels { order: 20; }").replace(".sp-keylevels { order: 20; }", ".sp-keylevels { order: 10; }").replace(".sp-chart { order: 10; }", ".sp-chart { order: 20; }")],
  ["phones: chart, Price zones, Key levels, signals, Earnings, valuation, price action, summary, profile, change stock, explore, FAQ", (s) => s.replace(".sp-signals { order: 30; }", ".sp-signals { order: 45; }")],
  ["phones: chart, Price zones, Key levels, signals, Earnings, valuation, price action, summary, profile, change stock, explore, FAQ", (s) => s.replace(".stock-page-sidebar, .stock-page-main { display: contents; }", "")],
  ["anything unlisted (a new section, the hidden analyst block) falls after the profile, before change stock", (s) => s.replace("{ order: 85; min-width: 0; }", "{ order: 0; min-width: 0; }")],
  ["each section in the DOM once, each ordered; no card rendered twice", (s) => s.replace(".sp-earnings { order: 40; }", "")],
  ["each section in the DOM once, each ordered; no card rendered twice", (s) => s.replace('<div className="sp-slot sp-earnings" data-reading-owner="a">', '<div className="sp-slot sp-earnings" data-reading-owner="a">\n<KeyLevelsCard bars={history} />')],
  ["desktop and tablet unchanged: no ordering or display: contents above 900px, the DOM order as it was", (s) => swap(s, 'className="sp-slot sp-returns"', 'className="sp-slot sp-signals"')],
  ["desktop and tablet unchanged: no ordering or display: contents above 900px, the DOM order as it was", (s) => s.replace("        @media (max-width: 900px) {", "        .stock-page-main { display: contents; }\n        @media (max-width: 900px) {")],
  ["desktop and tablet unchanged: no ordering or display: contents above 900px, the DOM order as it was", (s) => s.replace("        .mobile-change-stock { display: none; }", "        .mobile-change-stock { display: none; }\n        .sp-chart { order: 3; }")],
  ["the sidebar scrolls with the page: never sticky, at any width (owner ruling, #86)", (s) => s.replace("          gap: 16px;\n        }", "          gap: 16px;\n          position: sticky;\n          top: 20px;\n        }")],
  ["the sidebar scrolls with the page: never sticky, at any width (owner ruling, #86)", (s) => s.replace("          .stock-page-sidebar, .stock-page-main { display: contents; }", "          .stock-page-sidebar, .stock-page-main { display: contents; }\n          .sp-earnings { position: sticky; top: 0; }")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [label, mutate] of MUTANTS) {
  const m = mutate(src);
  if (m === src) { check(`mutant bites: ${label}`, false, "the mutation did not apply"); continue; }
  check(`mutant bites: ${label}`, !RULES[label](read(m)));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
