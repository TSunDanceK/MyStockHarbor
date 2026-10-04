// The stock page chart's interactive readout (#553 COWORK #136).
//
// What must hold:
//   1. lib/chartReadout.ts: the readout for an index is that bar's own date,
//      close, change vs the previous close (signed, with a direction for the
//      colour), MA50 and MA200; with nothing picked it is the last bar,
//      labelled "Latest close" ("Latest price" for a partial bar, which is
//      not a close); ←/→ step one bar (from the latest), Home/End jump, Esc
//      returns to the latest; a pointer maps to the nearest bar in the plot.
//   2. StockPriceChart: the server render shows the latest readout ABOVE the
//      chart, no marker; the SVG is focusable, takes keys and pointers, is
//      border-box (CODE-C #74: the border ran 2 px past the column) and lets a
//      vertical swipe scroll the page; the readout reads the bars it is given
//      and the chart makes no request of its own; the credit stays.
// Each rule also gets a planted mutant. The browser half (phone widths, the
// strip not covering the chart, no request on hover, screenshots) is
// scripts/measure-chart-readout.mjs, which needs Chromium and is not in check-all.
//
//   node scripts/check-chart-readout.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = process.cwd();
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LIB = "lib/chartReadout.ts";
const CHART = "app/stock/[symbol]/StockPriceChart.tsx";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

let seq = 0;
const tmpLibs = [];
async function loadLib(src) {
  const tmp = path.join(ROOT, "lib", `.check-cr-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(tmp, src);
  tmpLibs.push(tmp);
  return { mod: await import(pathToFileURL(tmp).href), file: tmp };
}
const TMP_DIR = path.join(ROOT, "scripts", `.check-cr-render-${process.pid}`);
/** The chart, transpiled; `libFile` swaps in a (mutant) readout helper. */
async function importChart(src, libFile = null) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  let js = ts.transpileModule(src, {
    fileName: "StockPriceChart.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
  }).outputText;
  if (libFile) js = js.replaceAll('"@/lib/chartReadout"', JSON.stringify(pathToFileURL(libFile).href));
  const out = path.join(TMP_DIR, `StockPriceChart-${++seq}.mjs`);
  fs.writeFileSync(out, js);
  return import(pathToFileURL(out).href);
}

// 30 weekday bars from 1 Sep 2026; closes wander so changes go both ways.
function bars(n = 30) {
  const out = [];
  const d = new Date(Date.UTC(2026, 8, 1));
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const i = out.length;
      out.push({ date: d.toISOString().slice(0, 10), close: 100 + ((i * 7) % 11) - (i % 3) * 1.25 });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const withMas = (data) => data.map((p, i) => ({ ...p, ma50: i >= 10 ? 100 + i / 4 : null, ma200: i >= 20 ? 95 + i / 8 : null }));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

// ── 1. The pure readout ───────────────────────────────────────────────────
async function libRules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const s = withMas(bars());
  const n = s.length;

  // Every index: the readout is that bar's values, not a neighbour's.
  let allMatch = true;
  for (let i = 0; i < n; i++) {
    const r = L.chartReadout(s, i);
    const p = s[i];
    const prev = s[i - 1]?.close;
    const d = prev === undefined ? null : p.close - prev;
    const dirOk = d === null ? r.change === null : r.change?.dir === (Number(d.toFixed(2)) > 0 ? "up" : Number(d.toFixed(2)) < 0 ? "down" : "flat");
    const changeOk = d === null || r.change?.text === `${d > 0 ? "+" : d < 0 ? "-" : ""}${Math.abs(d).toFixed(2)} (${d > 0 ? "+" : d < 0 ? "-" : ""}${Math.abs((d / prev) * 100).toFixed(2)}%)`;
    if (!(r.index === i && r.date === dayText(p.date) && r.close === p.close.toFixed(2) && dirOk && changeOk &&
      r.ma50 === (p.ma50 === null ? null : p.ma50.toFixed(2)) && r.ma200 === (p.ma200 === null ? null : p.ma200.toFixed(2)))) { allMatch = false; break; }
  }
  want("each index reads its own bar: date, close, change vs the previous close, MA50, MA200", allMatch);

  const latest = L.chartReadout(s, null);
  want("nothing picked: the last bar, labelled \"Latest close\"", latest.index === n - 1 && latest.isLatest && latest.heading === "Latest close" && latest.close === s[n - 1].close.toFixed(2));
  const mid = L.chartReadout(s, 5);
  want("a picked earlier bar is labelled \"Close\", not latest", mid.heading === "Close" && !mid.isLatest);
  want("the first bar has no previous close", L.chartReadout(s, 0).change === null);
  want("an MA not yet computable reads null (shown n/a)", L.chartReadout(s, 3).ma50 === null && L.chartReadout(s, 3).ma200 === null);
  const partial = s.map((p, i) => (i === n - 1 ? { ...p, label: "today so far (IEX), 14:05 ET" } : p));
  const pr = L.chartReadout(partial, null);
  want("a partial last bar is \"Latest price\" with its label, never a close", pr.heading === "Latest price" && pr.date.endsWith(", today so far (IEX), 14:05 ET"));
  const up = L.chartReadout([{ date: "2026-10-01", close: 100, ma50: null, ma200: null }, { date: "2026-10-02", close: 101.5, ma50: null, ma200: null }], 1);
  const down = L.chartReadout([{ date: "2026-10-01", close: 100, ma50: null, ma200: null }, { date: "2026-10-02", close: 98, ma50: null, ma200: null }], 1);
  const flat = L.chartReadout([{ date: "2026-10-01", close: 100, ma50: null, ma200: null }, { date: "2026-10-02", close: 100.001, ma50: null, ma200: null }], 1);
  want("up: \"+1.50 (+1.50%)\", dir up", up.change?.text === "+1.50 (+1.50%)" && up.change.dir === "up");
  want("down: \"-2.00 (-2.00%)\", dir down", down.change?.text === "-2.00 (-2.00%)" && down.change.dir === "down");
  want("a change that rounds to 0.00 is flat, not up", flat.change?.dir === "flat" && flat.change.text === "0.00 (0.00%)");
  want("an index past either end is clamped", L.chartReadout(s, 99).index === n - 1 && L.chartReadout(s, -4).index === 0);
  want("an empty series has no readout", L.chartReadout([], null) === null);

  want("← from the latest steps to the bar before it", L.stepIndex(null, "ArrowLeft", n) === n - 2);
  want("← / → step one bar", L.stepIndex(10, "ArrowLeft", n) === 9 && L.stepIndex(10, "ArrowRight", n) === 11);
  want("← stops at the first bar, → at the last", L.stepIndex(0, "ArrowLeft", n) === 0 && L.stepIndex(n - 1, "ArrowRight", n) === n - 1);
  want("Home / End jump to the ends", L.stepIndex(10, "Home", n) === 0 && L.stepIndex(10, "End", n) === n - 1);
  want("Esc returns to the latest (nothing picked)", L.stepIndex(10, "Escape", n) === null);
  want("other keys are not the chart's (Tab still moves focus)", L.stepIndex(10, "Tab", n) === undefined && L.stepIndex(10, "a", n) === undefined);

  const box = { width: 920, padL: 38, padR: 60 };
  const fx = (i) => (box.padL + (i * (box.width - box.padL - box.padR)) / (n - 1)) / box.width;
  let exact = true;
  for (let i = 0; i < n; i++) if (L.indexAtFraction(fx(i), n, box) !== i) exact = false;
  want("a pointer over a bar's x picks that bar", exact);
  want("a pointer in the margins picks the end bars", L.indexAtFraction(0, n, box) === 0 && L.indexAtFraction(1, n, box) === n - 1);
  return fails;
}

// ── 2. The chart ──────────────────────────────────────────────────────────
async function chartRules(C, src) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const s = bars(40);
  const data = s.map(({ date, close }) => ({ date, close }));
  const ma50 = data.map((_, i) => (i >= 10 ? 100 + i / 4 : null));
  const ma200 = data.map(() => null);
  const credit = React.createElement("a", { href: "#credit" }, "credit");
  const html = renderToStaticMarkup(React.createElement(C.default, { symbol: "ABC", data, ma50, ma200, credit })).replaceAll("<!-- -->", "");
  const last = data[data.length - 1];
  const readoutAt = html.indexOf("data-chart-readout=");
  const svgAt = html.indexOf("<svg");
  want("the server render shows the latest readout", /data-chart-readout="latest"/.test(html) && html.includes("Latest close") && html.includes(dayText(last.date)) && html.includes(`>${last.close.toFixed(2)}<`));
  want("the readout's MA50 is the last bar's, MA200 n/a on a short history", html.includes(`MA50 ${ma50[ma50.length - 1].toFixed(2)} · MA200 n/a`));
  const d = last.close - data[data.length - 2].close;
  want("the readout's change is vs the previous close, coloured by direction", html.includes(`${d > 0 ? "+" : "-"}${Math.abs(d).toFixed(2)}`) && html.includes(`data-chart-change="${d > 0 ? "up" : "down"}"`) && /vs previous close/.test(html));
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  want("the readout sits above the chart (a strip, not a floating tooltip)", readoutAt >= 0 && svgAt > readoutAt && !/\.chart-readout[^{]*\{[^}]*position:\s*(absolute|fixed)/.test(css) && !/data-chart-readout[^>]*position:/.test(html));
  want("phone: three fixed lines, so scrubbing never moves the chart; one line from 640 px of column", /\.chart-readout \{[^}]*grid-auto-rows: 20px; height: 60px;/.test(css) && /@container \(min-width: 640px\) \{\s*\.chart-readout \{[^}]*height: 20px;/.test(css) && /\.chart-readout-wrap \{ container-type: inline-size; \}/.test(css));
  want("no marker until a bar is picked", !html.includes("data-chart-marker"));
  const svg = /<svg[^>]*>/.exec(html)?.[0] ?? "";
  want("the chart is focusable and says how to step", /tabindex="0"/i.test(svg) && /aria-label="[^"]*Arrow keys[^"]*"/.test(svg));
  want("box-sizing: border-box on the chart (CODE-C #74)", /box-sizing:\s*border-box/.test(svg));
  want("a vertical swipe still scrolls the page (touch-action: pan-y)", /touch-action:\s*pan-y/.test(svg));
  want("the credit stays", html.includes('href="#credit"'));
  want("keys, pointer move, touch capture and leave are wired", /onKeyDown=\{onKeyDown\}/.test(src) && /onPointerMove=\{pick\}/.test(src) && /setPointerCapture/.test(src) && /onPointerLeave=/.test(src));
  want("leaving or blurring returns to the latest", /onPointerLeave=\{\(e\) => \{ if \(e\.pointerType === "mouse"\) setPicked\(null\); \}\}/.test(src) && /onBlur=\{\(\) => setPicked\(null\)\}/.test(src));
  want("the readout reads the bars it was given: no fetch, no action, no effect", !/\bfetch\(|useEffect|"use server"|Action"|XMLHttpRequest|navigator\.sendBeacon/.test(src));
  want("the readout comes from lib/chartReadout", /chartReadout\(series, picked\)/.test(src));
  return fails;
}

async function run() {
  const LIB_SRC = raw(LIB);
  const CHART_SRC = raw(CHART);

  console.log("\n=== 1. lib/chartReadout.ts ===\n");
  const L = (await loadLib(LIB_SRC)).mod;
  const lf = await libRules(L);
  check("the readout, stepping and pointer mapping", lf.length === 0, lf.join("; "));

  console.log("\n=== 2. StockPriceChart ===\n");
  const cf = await chartRules(await importChart(CHART_SRC), CHART_SRC);
  check("latest readout above the chart, focusable, border-box, pan-y, no request, credit", cf.length === 0, cf.join("; "));

  console.log("\n=== 3. Mutants ===\n");
  const LIB_MUTANTS = [
    ["the readout shows the next bar", /const bar = series\[i\];/, "const bar = series[Math.min(series.length - 1, i + 1)];"],
    ["change vs the first bar, not the previous close", /const prev = i > 0 \? series\[i - 1\]\.close : null;/, "const prev = i > 0 ? series[0].close : null;"],
    ["MA50 and MA200 swapped", /ma50: num\(bar\.ma50\) \? money\(bar\.ma50\) : null,\n    ma200: num\(bar\.ma200\) \? money\(bar\.ma200\) : null,/, "ma50: num(bar.ma200) ? money(bar.ma200) : null,\n    ma200: num(bar.ma50) ? money(bar.ma50) : null,"],
    ["nothing picked shows the first bar", /if \(picked === null \|\| !Number\.isFinite\(picked\)\) return n - 1;/, "if (picked === null || !Number.isFinite(picked)) return 0;"],
    ["the latest label dropped", /heading: isLatest \? \(bar\.label \? "Latest price" : "Latest close"\) : "Close",/, 'heading: "Close",'],
    ["a partial bar called a close", /bar\.label \? "Latest price" : "Latest close"/, '"Latest close"'],
    ["a down day signed +", /const sign = dir === "up" \? "\+" : dir === "down" \? "-" : "";/, 'const sign = dir === "flat" ? "" : "+";'],
    ["0.00 coloured up", /const dir = Number\(d\.toFixed\(2\)\) > 0/, "const dir = d >= 0"],
    ["the date read in local time", /const day = utcDay\(bar\.date\) \?\? bar\.date;/, "const day = bar.date;"],
    ["← steps the wrong way", /case "ArrowLeft": return Math\.max\(0, at - 1\);/, 'case "ArrowLeft": return Math.min(n - 1, at + 1);'],
    ["Esc ignored", /case "Escape": return null;/, ""],
    ["← runs off the start", /case "ArrowLeft": return Math\.max\(0, at - 1\);/, 'case "ArrowLeft": return at - 1;'],
    ["the pointer ignores the left padding", /const t = \(vx - box\.padL\) \/ \(box\.width - box\.padL - box\.padR\);/, "const t = vx / box.width;"],
  ];
  for (const [label, from, to] of LIB_MUTANTS) {
    const m = LIB_SRC.replace(from, to);
    if (m === LIB_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const { mod, file } = await loadLib(m);
    const fails = [...(await libRules(mod)), ...(await chartRules(await importChart(CHART_SRC, file), CHART_SRC))];
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
  const CHART_MUTANTS = [
    ["box-sizing dropped (CODE-C #74 back)", /\s*boxSizing: "border-box",/, ""],
    ["touch-action dropped (a sideways drag scrolls instead)", /\s*touchAction: "pan-y",/, ""],
    ["the chart not focusable", /\s*tabIndex=\{0\}/, ""],
    ["keys not wired", /\s*onKeyDown=\{onKeyDown\}/, ""],
    ["hover not wired", /\s*onPointerMove=\{pick\}/, ""],
    ["the mouse leaves and the readout sticks", /onPointerLeave=\{\(e\) => \{ if \(e\.pointerType === "mouse"\) setPicked\(null\); \}\}/, "onPointerLeave={() => {}}"],
    ["the readout floats over the chart", /\.chart-readout \{ display: grid;/, ".chart-readout { position: absolute; display: grid;"],
    ["the phone strip's height follows its text (the chart jumps)", /grid-auto-rows: 20px; height: 60px;/, ""],
    ["the readout below the chart", /(\s*\{readout \? \([\s\S]*?\) : null\})(\s*<span aria-live="polite"[\s\S]*?<\/span>)(\s*<svg[\s\S]*?<\/svg>)/, "$2$3$1"],
    ["the readout fetches on hover", /const pick = \(e: React\.PointerEvent<SVGSVGElement>\) => \{/, 'const pick = (e: React.PointerEvent<SVGSVGElement>) => { void fetch("/api/quote");'],
    ["the credit dropped", /\{credit \? <> · \{credit\}<\/> : null\}/, ""],
    ["a marker drawn with nothing picked", /\{picked !== null && at >= 0 \? \(/, "{at >= 0 ? ("],
    ["the readout ignores the pick", /const readout = chartReadout\(series, picked\);/, "const readout = chartReadout(series, null);"],
  ];
  for (const [label, from, to] of CHART_MUTANTS) {
    const m = CHART_SRC.replace(from, to);
    if (m === CHART_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const fails = await chartRules(await importChart(m), m);
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
}

try {
  await run();
} finally {
  for (const f of tmpLibs) fs.rmSync(f, { force: true });
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
