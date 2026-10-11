// Stretch (z20): the picker column and the stock page's history line (#553 COWORK #141/#144).
//
// What must hold:
//   1. lib/stretch.ts: z20 = (close - SMA20) / population stdev of 20 closes;
//      the zone is |z| >= 2; a CASE is the first day of a run in today's zone,
//      the current run excluded, with 10 sessions after it; "back" means a
//      session's range reached that day's SMA20 within 10 sessions (the 10th
//      counts, the 11th does not); fewer than 5 cases reads "Too few past
//      cases to say"; outside the zone only the reading shows; the wording is
//      the ruled one, past tense, never "will".
//   2. The grid: a "Stretch (z20)" column on the oversold/overbought pages
//      only, from the row's stored closes (no new payload field, no fetch).
//   3. The chart: the line shows where the page passes its bars (not on SPX),
//      at --fs-read, with a closed tap note that states the survivorship limit.
// Each rule gets a planted mutant.
//
//   node scripts/check-stretch.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = process.cwd();
const LIB = "lib/stretch.ts";
const GRID = "app/components/PickerResultsGrid.tsx";
const CHART = "app/stock/[symbol]/StockPriceChart.tsx";
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
let seq = 0;
const tmp = [];
async function loadLib(src) {
  const f = path.join(ROOT, "lib", `.check-st-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return { mod: await import(pathToFileURL(f).href), file: f };
}
const TMP_DIR = path.join(ROOT, "scripts", `.check-st-render-${process.pid}`);
async function importChart(src, libFile = null) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  let js = ts.transpileModule(src, { fileName: "c.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText;
  if (libFile) js = js.replaceAll('"@/lib/stretch"', JSON.stringify(pathToFileURL(libFile).href));
  const out = path.join(TMP_DIR, `c-${++seq}.mjs`);
  fs.writeFileSync(out, js);
  return import(pathToFileURL(out).href);
}

// Closes around 100 with a small zig-zag (so the stdev is never 0), and dips:
// each dip drops 8 for `len` sessions, then returns. `back` controls whether a
// session within 10 reaches the SMA20 again (high set to the average's level).
function series(dips, { endInDip = false } = {}) {
  const bars = [];
  const push = (c, high = c + 0.3, low = c - 0.3) => bars.push({ close: c, high, low });
  for (let i = 0; i < 60; i++) push(100 + (i % 2 ? 0.5 : -0.5));
  for (const d of dips) {
    for (let k = 0; k < d.len; k++) push(92 + (k % 2 ? 0.2 : -0.2), d.backOn === k ? 101 : 92.5, 91.5);
    for (let i = 0; i < 40; i++) push(100 + (i % 2 ? 0.5 : -0.5));
  }
  if (endInDip) for (let k = 0; k < 2; k++) push(92 + (k % 2 ? 0.2 : -0.2), 92.5, 91.5);
  return bars;
}
const mirror = (bars) => bars.map((b) => ({ close: 200 - b.close, high: 200 - b.low, low: 200 - b.high }));

async function libRules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  // z20 against a by-hand computation.
  const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 3);
  const w = closes.slice(-20), m = w.reduce((a, b) => a + b, 0) / 20, sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
  want("z20 is (close - SMA20) / population stdev of 20 closes", Math.abs(L.latestStretch(closes) - (closes[29] - m) / sd) < 1e-9);
  want("fewer than 20 closes, or 20 equal ones: no reading", L.latestStretch(closes.slice(0, 19)) === null && L.latestStretch(Array(25).fill(5)) === null);

  // 6 past dips: 4 return on session 10 exactly, 2 on session 11 (too late); today in a dip.
  const s6 = series([{ len: 12, backOn: 10 }, { len: 12, backOn: 10 }, { len: 12, backOn: 11 }, { len: 12, backOn: 10 }, { len: 12, backOn: 11 }, { len: 12, backOn: 10 }], { endInDip: true });
  const h = L.stretchHistory(s6);
  want("today in the zone below: 6 past cases, the current run not counted", h.side === "below" && h.cases === 6);
  want("back within 10 sessions: the 10th counts, the 11th does not", h.back === 4);
  want("the line's ruled words", L.stretchLine("ABC", h).endsWith("The last 6 times ABC was this far below its 20-day average, it was back to it within 10 sessions 4 times.") && /^ABC closed \d+\.\d standard deviations below its 20-day average\./.test(L.stretchLine("ABC", h)));
  const hm = L.stretchHistory(mirror(s6));
  want("the mirror: above, the same counts, \"this far above\"", hm.side === "above" && hm.cases === 6 && hm.back === 4 && /this far above its 20-day average/.test(L.stretchLine("ABC", hm)));
  const s4 = series([{ len: 12, backOn: 3 }, { len: 12, backOn: 3 }, { len: 12, backOn: 3 }, { len: 12, backOn: 3 }], { endInDip: true });
  want("fewer than 5 cases: \"Too few past cases to say\", no ratio", L.stretchLine("ABC", L.stretchHistory(s4)).endsWith("Too few past cases to say.") && !/The last/.test(L.stretchLine("ABC", L.stretchHistory(s4))));
  const calm = series([{ len: 12, backOn: 3 }]);
  const hc = L.stretchHistory(calm);
  want("outside the zone: the reading only", hc.side === null && /^ABC closed [\d.]+ standard deviations (above|below) its 20-day average\.$/.test(L.stretchLine("ABC", hc)));
  // A dip too recent to have 10 sessions after it is not a case.
  // 4 complete dips, then a 5th entry with only 7 sessions after it (2 more dip bars, 4 calm, today's 1-bar dip).
  const four = series([{ len: 12, backOn: 3 }, { len: 12, backOn: 3 }, { len: 12, backOn: 3 }, { len: 12, backOn: 3 }]);
  const tail = series([{ len: 3, backOn: 0 }], { endInDip: true }).slice(60);
  const recent = [...four, ...tail.slice(0, 3), ...four.slice(-4), ...tail.slice(-2, -1)];
  const hr = L.stretchHistory(recent);
  want("a case needs 10 sessions after it", hr.cases === 4);
  // Today's run 13 sessions long (an accelerating fall): it is still today's case, not a past one.
  const fall = []; let c = 100;
  for (let k = 1; k <= 14; k++) { c -= 0.4 * 1.32 ** k; fall.push({ close: c, high: c + 0.2, low: c - 0.2 }); }
  const sixNoEnd = series([{ len: 12, backOn: 10 }, { len: 12, backOn: 10 }, { len: 12, backOn: 11 }, { len: 12, backOn: 10 }, { len: 12, backOn: 11 }, { len: 12, backOn: 10 }]);
  const hl = L.stretchHistory([...sixNoEnd, ...fall]);
  want("a long current run is not counted as a past case", hl.side === "below" && hl.cases === 6);
  // Today at about -1.65: inside 2, so the reading only.
  const near = [...four, ...tail.slice(0, 3), ...four.slice(-2), ...tail.slice(-2)];
  const hn = L.stretchHistory(near);
  want("|z| under 2 is outside the zone: the reading only", hn.z !== null && hn.z > -2 && hn.z < -1.5 && hn.side === null && /^ABC closed 1\.\d standard deviations below its 20-day average\.$/.test(L.stretchLine("ABC", hn)));
  want("never the word will", !/\bwill\b/i.test(raw(LIB).replace(/\/\/.*$/gm, "")) && !/\bwill\b/i.test(L.STRETCH_NOTE));
  want("the tap note states the survivorship limit", /only companies still listed/.test(L.STRETCH_NOTE));
  return fails;
}

function gridRules(src) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  want("a Stretch (z20) column, from the row's stored closes", /label: "Stretch \(z20\)"/.test(src) && /const stretch = latestStretch\(pts\.map\(\(p\) => p\.close\)/.test(src));
  want("only on the oversold/overbought pages", /const stretchPage = \/oversold\|overbought\/i\.test\(configHref\);/.test(src) &&
    /if \(stretchPage\) sets\.general\.splice\(sets\.general\.indexOf\(change\) \+ 1, 0, stretch\);/.test(src));
  want("the column set follows the page", /\}, \[isEarnings, displayTone, configHref(?:, hasFiledEarnings)?\]\);/.test(src));
  want("an empty cell says why", /stretch: "Not enough price history for a 20-day average"/.test(src));
  return fails;
}

async function chartRules(C, src) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const bars = series([{ len: 12, backOn: 10 }, { len: 12, backOn: 10 }, { len: 12, backOn: 10 }, { len: 12, backOn: 10 }, { len: 12, backOn: 10 }], { endInDip: true })
    .map((b, i) => ({ ...b, date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10) }));
  const data = bars.slice(-240).map(({ date, close }) => ({ date, close }));
  const nul = data.map(() => null);
  const html = renderToStaticMarkup(React.createElement(C.default, { symbol: "ABC", data, ma50: nul, ma200: nul, gapBars: bars })).replaceAll("<!-- -->", "");
  const spx = renderToStaticMarkup(React.createElement(C.default, { symbol: "SPX", data, ma50: nul, ma200: nul }));
  want("the stock page shows the line with its history", /data-chart-stretch/.test(html) && /The last 5 times ABC was this far below its 20-day average, it was back to it within 10 sessions 5 times\./.test(html));
  want("the SPX chart (no bars passed) has no line", !/data-chart-stretch/.test(spx));
  want("the line reads at --fs-read", /\.chart-stretch \{[^}]*font-size: var\(--fs-read\)/.test(html));
  want("the tap note is closed until asked for", !html.includes("only companies still listed") && /How is this counted\?/.test(html));
  want("no request code", !/\bfetch\(|useEffect|"use server"/.test(src));
  return fails;
}

try {
  const LIB_SRC = raw(LIB), GRID_SRC = raw(GRID), CHART_SRC = raw(CHART);
  console.log("\n=== lib/stretch.ts ===\n");
  const lf = await libRules((await loadLib(LIB_SRC)).mod);
  check("z20, zone, cases, back within 10, too few, reading only, wording, note", lf.length === 0, lf.join("; "));
  console.log("\n=== the grid column ===\n");
  const gf = gridRules(GRID_SRC);
  check("Stretch (z20) on oversold/overbought only, from stored closes", gf.length === 0, gf.join("; "));
  console.log("\n=== the stock page line ===\n");
  const cf = await chartRules(await importChart(CHART_SRC), CHART_SRC);
  check("line with history, not on SPX, --fs-read, note closed", cf.length === 0, cf.join("; "));

  console.log("\n=== Mutants ===\n");
  const LIB_MUTANTS = [
    ["sample stdev (n - 1)", /\/ n\);\n    sma\[i\] = m;/, "/ (n - 1));\n    sma[i] = m;"],
    ["the zone at 1.5", /export const STRETCH_ZONE = 2;/, "export const STRETCH_ZONE = 1.5;"],
    ["back within 9", /export const STRETCH_WITHIN = 10;/, "export const STRETCH_WITHIN = 9;"],
    ["the current run counted", /for \(let t = 1; t < runStart; t\+\+\)/, "for (let t = 1; t <= runStart; t++)"],
    ["every day in the zone a case (no re-arm)", /if \(!inZone\(t\) \|\| inZone\(t - 1\) \|\| /, "if (!inZone(t) || "],
    ["a ratio on 1 case", /export const MIN_CASES = 5;/, "export const MIN_CASES = 1;"],
    ["\"will\" in the line", /it was back to it within/, "it will be back to it within"],
    ["the survivorship sentence dropped", / Our study across all stocks covered only companies still listed today, which can make returns to the average look more common than they were, most of all for smaller companies\./, ""],
  ];
  for (const [label, from, to] of LIB_MUTANTS) {
    const m = LIB_SRC.replace(from, to);
    if (m === LIB_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const { mod, file } = await loadLib(m);
    let fails;
    try { fails = [...(await libRules(mod)), ...(await chartRules(await importChart(CHART_SRC, file), CHART_SRC))]; } catch (e) { fails = [`threw: ${e.message}`]; }
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
  const GRID_MUTANTS = [
    ["the column on every picker page", /const stretchPage = \/oversold\|overbought\/i\.test\(configHref\);/, "const stretchPage = true;"],
    ["the column from the live pool price", /const stretch = latestStretch\(pts\.map\(\(p\) => p\.close\)/, "const stretch = latestStretch([price ?? 0]"],
    ["the column set stuck on the first page", /\}, \[isEarnings, displayTone, configHref(?:, hasFiledEarnings)?\]\);/, "}, [isEarnings, displayTone]);"],
  ];
  for (const [label, from, to] of GRID_MUTANTS) {
    const m = GRID_SRC.replace(from, to);
    if (m === GRID_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const fails = gridRules(m);
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
  const CHART_MUTANTS = [
    ["the note open by default", /const \[stretchNote, setStretchNote\] = useState\(false\);/, "const [stretchNote, setStretchNote] = useState(true);"],
    ["the line at label size", /\.chart-stretch \{ margin: 0 0 8px; font-size: var\(--fs-read\)/, ".chart-stretch { margin: 0 0 8px; font-size: var(--fs-label)"],
  ];
  for (const [label, from, to] of CHART_MUTANTS) {
    const m = CHART_SRC.replace(from, to);
    if (m === CHART_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    let fails;
    try { fails = await chartRules(await importChart(m), m); } catch (e) { fails = [`threw: ${e.message}`]; }
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
