// THE STOCK CHART'S LINE | CANDLES SWITCH (#553 COWORK #165).
//
// Runtime, on lib/chartCandles.ts:
//   - green when close >= open, red otherwise; a missing open uses the
//     previous close (and the readout says "O —"); high/low hold the body;
//   - today's partial bar is marked partial;
//   - the fit rule: every session when each gets >= 3 px, else only the
//     latest that fit, with "Last N sessions shown in candle view";
//   - the default is Line; a stored "candles" restores; storage that throws
//     falls back to Line, and a failing write is swallowed.
// Source (StockPriceChart): Line on the server and until the stored choice is
// read; a real button group with aria-pressed; candles drawn per bar (flat
// day still a body, partial hollow); MA50, MA200, the last-price dot and the
// gap zones drawn in both modes; the OHLC readout line in candle mode; the
// footer's fit words; no fetch added. Every rule has a planted mutant.
//
//   node scripts/check-chart-candles.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const LIB = "lib/chartCandles.ts";
const CHART = "app/stock/[symbol]/StockPriceChart.tsx";
const HOOK = "lib/useChartMode.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const tmp = [];
let seq = 0;
async function loadLib(src) {
  const f = path.join(ROOT, "lib", `.check-ccd-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

function libRules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const bars = [
    { date: "2026-09-28", open: 100, high: 104, low: 99, close: 103 },
    { date: "2026-09-29", open: 103, high: 103.5, low: 98, close: 99 },
    { date: "2026-09-30", open: 11.24, high: 11.24, low: 11.24, close: 11.24 },
    { date: "2026-10-01", close: 101, high: 102, low: 100 },
    { date: "2026-10-02", open: 100, high: 101, low: 99.5, close: 100.5, label: "today so far (IEX), 14:05 ET" },
  ];
  const up = L.candleOf(bars, 0), down = L.candleOf(bars, 1), flat = L.candleOf(bars, 2), noOpen = L.candleOf(bars, 3), part = L.candleOf(bars, 4);
  want("an up day is green (close >= open)", up.up === true && up.open === 100 && up.close === 103);
  want("a down day is red", down.up === false);
  want("a flat bar counts as up (close = open) and keeps its single price", flat.up === true && flat.high === flat.low);
  want("no stored open: the previous close stands in, and it is said", noOpen.openMissing && noOpen.open === 11.24 && L.candleWords(noOpen).startsWith("O — ·"));
  want("high and low always hold the body", noOpen.low <= Math.min(noOpen.open, noOpen.close) && noOpen.high >= Math.max(noOpen.open, noOpen.close));
  want("today's partial bar is marked partial", part.partial === true && up.partial === false);
  want("the OHLC words", L.candleWords(up) === "O 100.00 · H 104.00 · L 99.00 · C 103.00");
  want("every session fits at >= 3 px: all shown", L.candleFit(822, 240) === 240);
  want("a phone (~290 px of plot): only the latest that fit at 3 px", L.candleFit(290, 240) === 96 && L.candleFitWords(96, 240) === "Last 96 sessions shown in candle view" && L.candleFitWords(240, 240) === null);
  want("an unmeasured plot (server render) shows everything", L.candleFit(0, 240) === 240);
  want("the default is Line", L.CHART_MODE_DEFAULT === "line" && L.readChartMode(null) === "line" && L.readChartMode({ getItem: () => null }) === "line");
  want("a stored choice is restored", L.readChartMode({ getItem: (k) => (k === L.CHART_MODE_KEY ? "candles" : null) }) === "candles");
  want("storage that throws falls back to Line; a failing write is swallowed", L.readChartMode({ getItem: () => { throw new Error("blocked"); } }) === "line" && (() => { try { L.writeChartMode({ setItem: () => { throw new Error("quota"); } }, "candles"); return true; } catch { return false; } })());
  return fails;
}

function chartRules(raw, hookRaw = read(HOOK)) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const c = stripComments(raw, { file: CHART });
  const h = stripComments(hookRaw, { file: HOOK });
  want("Line on the server and until the stored choice is read", /const \[mode, setMode\] = useState<ChartMode>\("line"\);/.test(h) && /if \(stored === "candles"\) setMode\("candles"\);/.test(h) && /const \{ mode, chooseMode \} = useChartMode\(Boolean\(gapBars\)\);/.test(c));
  want("the choice is remembered (try/catch around storage)", /try \{ stored = readChartMode\(window\.localStorage\); \} catch \{ stored = "line"; \}/.test(h) && /try \{ writeChartMode\(window\.localStorage, next\); \} catch \{\}/.test(h));
  want("the hooks read no network", !/\bfetch\(|XMLHttpRequest|"use server"/.test(h));
  want("a real button group with aria-pressed on each half", /role="group" aria-label="Chart style"/.test(c) && /aria-pressed=\{mode === m\} onClick=\{\(\) => chooseMode\(m\)\}/.test(c) && /\{m === "line" \? "Line" : "Candles"\}/.test(c));
  want("one candle per bar: wick, body coloured by close vs open", /const colour = c\.up \? UP : DOWN;/.test(c) && /<line x1=\{x\(i\)\} x2=\{x\(i\)\} y1=\{y\(c\.high\)\} y2=\{y\(c\.low\)\}/.test(c));
  want("a flat day still draws a visible body", /const bodyH = Math\.max\(1\.5 \* pxPerUnit, Math\.abs\(y\(c\.open\) - y\(c\.close\)\)\);/.test(c));
  want("today's partial bar drawn hollow", /fill=\{c\.partial \? "none" : colour\}/.test(c));
  want("candle view shows only the sessions that fit, and says so", /const shownCount = candles \? candleFit\(plotPx, fullSeries\.length\) : fullSeries\.length;/.test(c) && /\{fitWords \? <> · <span data-chart-fit>\{fitWords\}<\/span><\/> : null\}/.test(c));
  // Overlays in both modes: drawn outside the candles/line choice.
  const draw = c.slice(c.indexOf("{candles ? ("), c.indexOf("</svg>"));
  const choiceEnd = draw.indexOf("data-chart-line />");
  const after = draw.slice(choiceEnd);
  want("MA50, MA200 and the last-price dot drawn in both modes", /\{ma50Path \? \(/.test(after) && /\{ma200Path \? \(/.test(after) && /<circle\s+cx=\{x\(series\.length - 1\)\}/.test(after));
  want("the gap zones drawn in both modes", c.indexOf("{zones.map((z) => (") < c.indexOf("{candles ? ("));
  want("the OHLC line in the readout in candle mode", /\{candles && at >= 0 \? <span data-chart-ohlc>\{candleWords\(candleOf\(series, at\)\)\}<\/span> : null\}/.test(c));
  want("no fetch added", !/fetch\(/.test(c));
  return fails;
}

try {
  const libSrc = read(LIB), chartSrc = read(CHART);
  console.log("\n1. The candle arithmetic");
  const l = libRules(await loadLib(libSrc));
  check("colour, missing open, partial, fit rule, default Line, storage", l.length === 0, l.join("; "));
  console.log("\n2. The chart's wiring");
  const w = chartRules(chartSrc);
  check("default Line, button group, candles, overlays in both modes, readout, fit words", w.length === 0, w.join("; "));

  console.log("\n3. Planted mutants");
  const LM = [
    ["colour by close vs previous close", "return { open, high, low, close, up: close >= open,", "return { open, high, low, close, up: close >= (num(prev) ? prev : open),"],
    ["the partial bar not marked", "partial: Boolean(b.label),", "partial: false,"],
    ["the fit rule at 1 px (hairline candles)", "export const CANDLE_MIN_PX = 3;", "export const CANDLE_MIN_PX = 1;"],
    ["the default Candles", 'export const CHART_MODE_DEFAULT: ChartMode = "line";', 'export const CHART_MODE_DEFAULT: ChartMode = "candles";'],
    ["storage errors not caught", '  try {\n    return storage?.getItem(CHART_MODE_KEY) === "candles" ? "candles" : CHART_MODE_DEFAULT;\n  } catch {\n    return CHART_MODE_DEFAULT;\n  }', '  return storage?.getItem(CHART_MODE_KEY) === "candles" ? "candles" : CHART_MODE_DEFAULT;'],
  ];
  for (const [label, from, to] of LM) {
    if (!libSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = libRules(await loadLib(libSrc.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const CM = [
    ["the partial bar drawn filled", 'fill={c.partial ? "none" : colour}', "fill={colour}"],
    ["a flat day drawn as nothing", "const bodyH = Math.max(1.5 * pxPerUnit, Math.abs(y(c.open) - y(c.close)));", "const bodyH = Math.abs(y(c.open) - y(c.close));"],
    ["every session squeezed in (no fit rule)", "const shownCount = candles ? candleFit(plotPx, fullSeries.length) : fullSeries.length;", "const shownCount = fullSeries.length;"],
    ["the MAs drawn only in line mode", "        {ma50Path ? (", "        {!candles && ma50Path ? ("],
    ["the OHLC readout dropped", "{candles && at >= 0 ? <span data-chart-ohlc>{candleWords(candleOf(series, at))}</span> : null}", ""],
    ["aria-pressed dropped from the switch", "aria-pressed={mode === m} onClick={() => chooseMode(m)}", "onClick={() => chooseMode(m)}"],
  ];
  {
    const hookSrc = read(HOOK);
    const from = 'const [mode, setMode] = useState<ChartMode>("line");';
    const f = hookSrc.includes(from) ? chartRules(chartSrc, hookSrc.replace(from, 'const [mode, setMode] = useState<ChartMode>("candles");')) : ["anchor"];
    check('mutant "the chart opens on Candles" is caught', hookSrc.includes(from) && f.length > 0, f[0] ?? "no rule failed");
  }
  for (const [label, from, to] of CM) {
    if (!chartSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = chartRules(chartSrc.replace(from, to));
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
