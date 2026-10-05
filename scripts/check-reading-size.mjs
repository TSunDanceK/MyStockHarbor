// THE READING-SIZE TOKENS, HELD IN check-all (#563 COWORK #100/#101).
//
// The browser measure (scripts/measure-reading-size.mjs) needs Chromium, so it
// can't run in check-all. This holds what can be read from the source:
//   - the tokens exist in rem: --fs-read 1rem with --lh-read 1.65,
//     --fs-label 0.8125rem, --fs-fine 0.75rem;
//   - nothing sets html's font-size to a fixed px value (that would break a
//     reader's browser text-size setting);
//   - the stock and SPX pages' own files size text in rem or the tokens only:
//     no numeric (px) fontSize, no "Npx" font size, and nothing under 0.75rem;
//   - the valuation figures' method notes are behind a tap (owner ruling, #104).
// A mutant each.
//
//   node scripts/check-reading-size.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const GLOBALS = "app/globals.css";
/** The files on /stock/[symbol] and /markets/spx that C sizes (and B's, CSS-only, per #100). */
export const SCOPE = [
  "app/stock/[symbol]/StockSymbolPageClient.tsx", "app/stock/[symbol]/ConfluenceCard.tsx", "app/stock/[symbol]/KeyLevelsCard.tsx",
  "app/stock/[symbol]/TapNote.tsx", "app/stock/[symbol]/LevelsSignals.tsx", "app/stock/[symbol]/PerformanceStrip.tsx",
  "app/stock/[symbol]/StockPriceChart.tsx", "app/stock/[symbol]/StockTickerJump.tsx", "app/stock/[symbol]/HeaderStripParts.tsx",
  "app/markets/spx/page.tsx", "app/markets/spx/SPXChartClient.tsx", "app/markets/spx/LevelsGlanceCard.tsx", "app/markets/spx/MarketMoodCard.tsx",
  "app/components/ReturnsToggleCard.tsx", "app/components/ReturnsBarChart.tsx", "app/components/ShareButton.tsx", "app/components/RelatedStocks.tsx",
  // A's: the earnings page and A's SEC panels on the stock page (#552 COWORK #153).
  "app/stock/[symbol]/earnings/page.tsx", "app/stock/[symbol]/earnings/SecEarningsCards.tsx", "app/stock/[symbol]/earnings/GrowthVisuals.tsx",
  "app/stock/[symbol]/earnings/EarningsSymbolPicker.tsx", "app/stock/[symbol]/earnings/NextReportCard.tsx", "app/stock/[symbol]/earnings/ReactionCharts.tsx",
  "app/stock/[symbol]/ColdFill.tsx", "app/components/LatestEarningsCard.tsx", "app/components/CompanyProfile.tsx",
  "app/components/DilutionHistory.tsx", "app/components/EstimateKey.tsx",
  // C's strength badge (#563 COWORK #105).
  "app/stock/[symbol]/StrengthBadge.tsx",
  // C's Performance card (#563 COWORK #111).
  "lib/ta/performanceCard.ts", "app/stock/[symbol]/PerformanceCard.tsx",
];
const read = (f) => fs.readFileSync(f, "utf8");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(css|tsx?)$/.test(e.name) ? [path.join(d, e.name)] : []));

/** Every font size written in a source: numeric style values, "Npx"/"Nrem" strings, CSS declarations and SVG attributes. */
export function sizesIn(src) {
  const out = [];
  for (const m of src.matchAll(/fontSize:\s*([^,}\n]+)/g)) out.push(m[1].trim());
  for (const m of src.matchAll(/font-size:\s*([^;"`}\n]+)/g)) out.push(m[1].trim());
  for (const m of src.matchAll(/fontSize=(\{[^}]*\}|"[^"]*")/g)) out.push(m[1].trim());
  return out;
}
/** A size that is a bare number, a px length, or a rem under 0.75. */
export function badSize(v) {
  if (/var\(--fs-(read|label|fine)\)/.test(v) || /^inherit|^"inherit"/.test(v)) return null;
  const nums = [...v.matchAll(/(?<![\w.$-])(\d+(?:\.\d+)?)(px|rem)?(?![\w.%])/g)];
  for (const [, n, unit] of nums) {
    if (unit === "px" || (!unit && !/^\{?\s*["'`]/.test(v) && /^\{?\s*[\d(]|\?\s*\d|:\s*\d/.test(v))) return `${v} (px)`;
    if (unit === "rem" && Number(n) < 0.75) return `${v} (under 0.75rem)`;
  }
  return null;
}

const RULES = {
  "the tokens are rem: --fs-read 1rem / 1.65, --fs-label 0.8125rem, --fs-fine 0.75rem": ({ globals }) =>
    /--fs-read: 1rem;/.test(globals) && /--lh-read: 1\.65;/.test(globals) && /--fs-label: 0\.8125rem;/.test(globals) && /--fs-fine: 0\.75rem;/.test(globals),
  "nothing sets html's font-size to a fixed px value": ({ all }) =>
    all.every(([, src]) => !/(^|[\s,}])html\s*\{[^}]*font-size:\s*\d+(\.\d+)?px/m.test(src) && !/documentElement\.style\.fontSize\s*=\s*["'`]\d+px/.test(src)),
  "the stock and SPX pages' files size text in rem or the tokens only, nothing under 0.75rem": ({ scope }) =>
    scope.every(([, src]) => sizesIn(src).every((v) => badSize(v) === null)),
  // OWNER RULING (#563 COWORK #104): explanations go behind a tap, not as small text on the page.
  "the valuation figures' method notes sit behind a 'How it's calculated' tap, at --fs-read when open": ({ scope }) => {
    const page = scope.find(([f]) => f.endsWith("StockSymbolPageClient.tsx"))[1];
    return /\{item\.value != null && item\.reason \? \(\s*<details className="valuationHow"[^>]*>\s*<summary[^>]*>How it&apos;s calculated<\/summary>\s*<div style=\{\{[^}]*fontSize: "var\(--fs-read\)"[^}]*\}\}>\{item\.reason\}<\/div>\s*<\/details>/.test(page) &&
      !/<div data-fine-print[^>]*>\{item\.reason\}<\/div>/.test(page);
  },
  // OWNER RULING (#552 COWORK #157 §2): A's explanations go behind a tap and open at
  // --fs-read: the snapshot's source sentence, the dilution card's basis sentence and the
  // valuation panel's "How these are calculated". Credits and as-of stamps stay fine print.
  "A's panel explanations sit behind a tap, at --fs-read when open, and are not fine print": ({ scope }) => {
    const src = (f) => scope.find(([p]) => p.endsWith(f))[1];
    // A <details> whose summary's named style is at --fs-label, opening on the named body style.
    const tap = (src, summary, body) => new RegExp(`<details [^>]*>\\s*<summary style=\\{${summary}\\}>[^<]+</summary>\\s*<div style=\\{${body}\\}>`).test(src)
      && new RegExp(`const ${summary}: CSSProperties = \\{[^}]*fontSize: "var\\(--fs-label\\)"`).test(src);
    const card = src("LatestEarningsCard.tsx"), dil = src("DilutionHistory.tsx"), val = src("StockSymbolPageClient.tsx");
    return tap(card, "earningsHowSummaryStyle", "earningsHowBodyStyle") && /<div style=\{earningsHowBodyStyle\}>\{snapshot\.sourceNote\}<\/div>/.test(card)
      && /const earningsHowBodyStyle: CSSProperties = \{[^}]*fontSize: "var\(--fs-read\)"/.test(card) && !/data-fine-print[^>]*>\{snapshot\.sourceNote\}/.test(card)
      && tap(dil, "howSummaryStyle", "howBodyStyle") && /const howBodyStyle: CSSProperties = \{[^}]*fontSize: "var\(--fs-read\)"/.test(dil)
      && /<details data-share-how=""/.test(dil) && !/<div style=\{sourceStyle\} data-fine-print/.test(dil)
      && /<details data-valuation-how=""[^>]*>\s*<summary[^>]*fontSize: "var\(--fs-label\)"[^>]*>How these are calculated<\/summary>\s*<div style=\{\{[^}]*fontSize: "var\(--fs-read\)"[^}]*\}\}>\{valuation\.sourceNote\}<\/div>/.test(val);
  },
};

const load = (over = {}) => ({
  globals: over[GLOBALS] ?? read(GLOBALS),
  all: walk("app").map((f) => [f, over[f] ?? read(f)]),
  scope: SCOPE.map((f) => [f, stripComments(over[f] ?? read(f), { file: f })]),
});
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };

console.log("=== Rules ===");
const base = load();
for (const [label, rule] of Object.entries(RULES)) {
  const ok = run(rule, base);
  const detail = ok || !label.startsWith("the stock") ? "" : base.scope.flatMap(([f, src]) => sizesIn(src).filter(badSize).map((v) => `${f}: ${v}`)).slice(0, 5).join("; ");
  check(label, ok, detail);
}

const R = Object.keys(RULES);
const MUTANTS = [
  [R[0], GLOBALS, (s) => s.replace("--fs-read: 1rem;", "--fs-read: 16px;")],
  [R[1], GLOBALS, (s) => `${s}\nhtml { font-size: 15px; }\n`],
  [R[2], "app/markets/spx/MarketMoodCard.tsx", (s) => s.replace('fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(241,245,249,0.72)"', 'fontSize: 14, lineHeight: "var(--lh-read)", color: "rgba(241,245,249,0.72)"')],
  [R[2], "app/stock/[symbol]/StockPriceChart.tsx", (s) => s.replace('fontSize="0.75rem"', 'fontSize="0.625rem"')],
  [R[3], "app/stock/[symbol]/StockSymbolPageClient.tsx", (s) => s.replace(/<details className="valuationHow"[\s\S]*?<\/details>/, '<div data-fine-print style={{ marginTop: 4, fontSize: "var(--fs-fine)" }}>{item.reason}</div>')],
  // A's explanations behind a tap (#552 COWORK #157 §2): back to fine print in each panel.
  [R[R.length - 1], "app/components/LatestEarningsCard.tsx", (s) => s.replace('fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(226,232,240,0.85)" };\nconst', 'fontSize: "var(--fs-fine)", lineHeight: "var(--lh-read)", color: "rgba(226,232,240,0.85)" };\nconst').replace("const earningsHowBodyStyle: CSSProperties = { marginTop: 6, fontSize: \"var(--fs-read)\"", "const earningsHowBodyStyle: CSSProperties = { marginTop: 6, fontSize: \"var(--fs-fine)\"")],
  [R[R.length - 1], "app/components/DilutionHistory.tsx", (s) => s.replace(/<details data-share-how=""[\s\S]*?<div style=\{howBodyStyle\}>/, '<div style={howBodyStyle} data-fine-print=""><div>')],
  [R[R.length - 1], "app/stock/[symbol]/StockSymbolPageClient.tsx", (s) => s.replace('<div style={{ marginTop: 6, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(226,232,240,0.85)" }}>{valuation.sourceNote}</div>', '<div style={{ marginTop: 6, fontSize: "var(--fs-fine)" }}>{valuation.sourceNote}</div>')],
  // A's (#552 COWORK #153): the earnings page's labels and the tile's chart.
  [R[2], "app/stock/[symbol]/earnings/page.tsx", (s) => s.replace(".metricLabel { font-size: var(--fs-label);", ".metricLabel { font-size: 9.5px;")],
  [R[2], "app/components/LatestEarningsCard.tsx", (s) => s.replace('const chartGapStyle: CSSProperties = { marginTop: 2, fontSize: "var(--fs-fine)"', "const chartGapStyle: CSSProperties = { marginTop: 2, fontSize: 9")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [label, file, mutate] of MUTANTS) {
  const src = read(file), mut = mutate(src);
  if (mut === src) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  check(`mutant bites: ${label}`, !run(RULES[label], load({ [file]: mut })));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
