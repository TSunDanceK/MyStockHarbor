// The stock page chart's fair value gap zones (#553 COWORK #140 step 2; ruled in #144).
//
// What must hold:
//   1. lib/chartGaps.ts: the ruled defaults (>= 0.5x ATR, 250 bars), the nearest
//      2 above and 2 below; a zone older than the chart's window starts at its
//      left edge; completed sessions only (a partial "today so far" bar neither
//      forms nor fills a gap); none -> "No unfilled gaps in the last 12 months";
//      "In a bullish gap (from 14 Mar)" for a point inside a zone.
//   2. The chart: the toggle is OFF by default (no zone drawn on the server
//      render); with none it is shown DISABLED with the reason, never hidden;
//      the tap note is closed until asked for and reads at --fs-read; a chart
//      not given the bars (the SPX page) has no toggle; no request code; the
//      credit stays.
// Each rule gets a planted mutant. Clicking the toggle, the widened scale and
// phone widths are scripts/measure-chart-readout.mjs (Chromium, not in check-all).
//
//   node scripts/check-chart-gaps.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = process.cwd();
const LIB = "lib/chartGaps.ts";
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
  const f = path.join(ROOT, "lib", `.check-cg-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return { mod: await import(pathToFileURL(f).href), file: f };
}
const TMP_DIR = path.join(ROOT, "scripts", `.check-cg-render-${process.pid}`);
async function importChart(src, libFile = null) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  let js = ts.transpileModule(src, {
    fileName: "StockPriceChart.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
  }).outputText;
  if (libFile) js = js.replaceAll('"@/lib/chartGaps"', JSON.stringify(pathToFileURL(libFile).href));
  const out = path.join(TMP_DIR, `StockPriceChart-${++seq}.mjs`);
  fs.writeFileSync(out, js);
  return import(pathToFileURL(out).href);
}

// Weekday bars: flat segments (range level +/- 1) joined by upward jumps of 5,
// each leaving a bullish gap [L+1, L+4] that nothing later re-enters.
function staircase(levels, perSegment = 60) {
  const out = [];
  const d = new Date(Date.UTC(2025, 9, 1));
  const push = (high, low, close) => {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    out.push({ date: d.toISOString().slice(0, 10), high, low, close });
    d.setUTCDate(d.getUTCDate() + 1);
  };
  levels.forEach((L, k) => {
    if (k > 0) push(L + 1, levels[k - 1] + 1.5, L); // the middle candle: the jump
    for (let i = 0; i < perSegment; i++) push(L + 1, L - 1, L);
  });
  return out;
}
const STAIRS = staircase([100, 105, 110, 115]); // gaps [101,104], [106,109], [111,114]
const lastDates = (bars, n) => bars.slice(-n).map((b) => b.date);
const flat = Array.from({ length: 260 }, (_, i) => ({ date: new Date(Date.UTC(2025, 9, 1 + i)).toISOString().slice(0, 10), high: 101, low: 99, close: 100 }));

async function libRules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const g = L.chartGapZones(STAIRS, lastDates(STAIRS, 240));
  want("three gaps below the price: the nearest two are shown, nearest first by edge", g.zones.length === 2 && g.zones.every((z) => z.kind === "bullish") &&
    g.zones.map((z) => z.lower).sort((a, b) => a - b).join() === "106,111" && g.reason === null);
  const mid = STAIRS.findIndex((b) => b.low === 111.5); // the jump into the 115 segment (its low: 110 + 1.5)
  const z115 = g.zones.find((z) => z.lower === 111);
  want("a zone starts at its middle candle, dated \"d Mon\"", Boolean(z115) && mid > 0 && STAIRS.slice(-240)[z115.startIndex].date === STAIRS[mid].date && /^\d{1,2} [A-Z][a-z]{2}$/.test(z115.from));
  const short = L.chartGapZones(STAIRS, lastDates(STAIRS, 30));
  want("a zone older than the chart's window starts at its left edge", short.zones.length === 2 && short.zones.every((z) => z.startIndex === 0));
  // A bar dipping into the top gap fills it -- unless it is today's partial bar.
  const dip = { date: "2026-12-31", high: 116, low: 113, close: 115 };
  const filled = L.chartGapZones([...STAIRS, dip], lastDates([...STAIRS, dip], 240));
  const partial = L.chartGapZones([...STAIRS, { ...dip, label: "today so far (IEX), 14:05 ET" }], lastDates(STAIRS, 240));
  want("a completed bar entering a zone removes it", !filled.zones.some((z) => z.lower === 111));
  want("today's partial bar neither fills nor forms a gap", partial.zones.some((z) => z.lower === 111) && partial.zones.length === 2);
  const none = L.chartGapZones(flat, lastDates(flat, 240));
  want("none: no zones and the reason \"No unfilled gaps in the last 12 months\"", none.zones.length === 0 && none.reason === "No unfilled gaps in the last 12 months");
  want("bars without highs and lows count as none, not as gaps", L.chartGapZones(STAIRS.map(({ date, close }) => ({ date, close })), lastDates(STAIRS, 240)).zones.length === 0);
  const z = { kind: "bullish", lower: 10, upper: 12, startIndex: 5, from: "14 Mar" };
  want("the readout words: \"In a bullish gap (from 14 Mar)\"", L.inGapWords(z) === "In a bullish gap (from 14 Mar)");
  want("a point is in a zone only after its start and between its edges", L.zoneAt([z], 6, 11) === z && L.zoneAt([z], 4, 11) === null && L.zoneAt([z], 6, 12.5) === null);
  return fails;
}

async function chartRules(C, src, libSrc) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const data = STAIRS.slice(-240).map(({ date, close }) => ({ date, close }));
  const nul = data.map(() => null);
  const credit = React.createElement("a", { href: "#credit" }, "credit");
  const on = renderToStaticMarkup(React.createElement(C.default, { symbol: "ABC", data, ma50: nul, ma200: nul, credit, gapBars: STAIRS }));
  const none = renderToStaticMarkup(React.createElement(C.default, { symbol: "ABC", data: flat.slice(-240).map(({ date, close }) => ({ date, close })), ma50: nul, ma200: nul, gapBars: flat }));
  const spx = renderToStaticMarkup(React.createElement(C.default, { symbol: "SPX", data, ma50: nul, ma200: nul }));
  const toggle = /<button[^>]*class="chart-gap-toggle"[^>]*>/.exec(on)?.[0] ?? "";
  want("the toggle is off by default: pressed false, no zone drawn", /data-chart-gaps="off"/.test(on) && /aria-pressed="false"/.test(toggle) && !/disabled/.test(toggle) && !/data-chart-gap="/.test(on) && />Show gaps</.test(on));
  const noneToggle = /<button[^>]*class="chart-gap-toggle"[^>]*>/.exec(none)?.[0] ?? "";
  want("with none: shown, disabled, with the reason beside it", /data-chart-gaps="none"/.test(none) && /disabled=""/.test(noneToggle) && none.includes("No unfilled gaps in the last 12 months"));
  want("the tap note is closed until asked for", !on.includes("market moved too fast") && /aria-expanded="false"/.test(on) && />What is a gap\?</.test(on));
  want("the tap note's words are the ruled ones", C.GAP_NOTE === "A price gap left when the market moved too fast for candles to overlap. Some traders watch whether price returns to it. A description, not a forecast.");
  want("the note reads at --fs-read / --lh-read", /\.chart-gap-note \{[^}]*font-size: var\(--fs-read\); line-height: var\(--lh-read\)/.test(on));
  want("a chart without the bars (the SPX page) has no toggle", !spx.includes(`class="chart-gap-row"`) && !spx.includes(">Show gaps<"));
  want("the credit stays", on.includes('href="#credit"'));
  want("no request code in the chart or the zones", !/\bfetch\(|useEffect|"use server"|XMLHttpRequest/.test(src + libSrc));
  want("a shown zone widens the scale", /for \(const z of zones\) vals\.push\(z\.lower, z\.upper\);/.test(src));
  return fails;
}

try {
  const LIB_SRC = raw(LIB);
  const CHART_SRC = raw(CHART);
  console.log("\n=== lib/chartGaps.ts ===\n");
  const lf = await libRules((await loadLib(LIB_SRC)).mod);
  check("nearest 2+2, window edge, partial bar, none + reason, readout words", lf.length === 0, lf.join("; "));
  console.log("\n=== StockPriceChart ===\n");
  const cf = await chartRules(await importChart(CHART_SRC), CHART_SRC, LIB_SRC);
  check("off by default, disabled with the reason, note closed, SPX untouched, credit", cf.length === 0, cf.join("; "));

  console.log("\n=== Mutants ===\n");
  const LIB_MUTANTS = [
    ["three a side", /export const PER_SIDE = 2;/, "export const PER_SIDE = 3;"],
    ["an older zone dropped instead of starting at the edge", /g\.date < first \? 0 : -1/, "-1"],
    ["the partial bar counted", /\.filter\(\(b\) => !b\.label && /, ".filter((b) => "],
    ["no reason when none", /reason: zones\.length \? null : NO_GAPS_REASON/, "reason: null"],
    ["zoneAt ignores the start", /index >= z\.startIndex && /, ""],
  ];
  for (const [label, from, to] of LIB_MUTANTS) {
    const m = LIB_SRC.replace(from, to);
    if (m === LIB_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const { mod, file } = await loadLib(m);
    const fails = [...(await libRules(mod)), ...(await chartRules(await importChart(CHART_SRC, file), CHART_SRC, m))];
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
  const CHART_MUTANTS = [
    ["the toggle on by default", /useState\(false\);\n  const \[gapNote/, "useState(true);\n  const [gapNote"],
    ["with none, the toggle hidden", /disabled=\{!gaps\.zones\.length\}/, "hidden={!gaps.zones.length}"],
    ["the note open by default", /const \[gapNote, setGapNote\] = useState\(false\);/, "const [gapNote, setGapNote] = useState(true);"],
    ["the note at label size", /\.chart-gap-note \{ margin: 0 0 8px; font-size: var\(--fs-read\); line-height: var\(--lh-read\)/, ".chart-gap-note { margin: 0 0 8px; font-size: var(--fs-label); line-height: 1.4"],
    ["the toggle on every chart (SPX too)", /\{gapBars \? \(<>/, "{true ? (<>"],
    ["the scale not widened", /for \(const z of zones\) vals\.push\(z\.lower, z\.upper\);/, ""],
  ];
  for (const [label, from, to] of CHART_MUTANTS) {
    const m = CHART_SRC.replace(from, to);
    if (m === CHART_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    let fails;
    try { fails = await chartRules(await importChart(m), m, LIB_SRC); } catch (e) { fails = [`threw: ${e.message}`]; }
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
