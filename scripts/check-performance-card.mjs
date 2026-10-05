// THE STOCK PAGE'S "PERFORMANCE VS THE S&P 500" CARD (#563 COWORK #111): rules, then mutants.
//
// lib/ta/performanceCard.ts and app/stock/[symbol]/PerformanceCard.tsx are
// transpiled into one module with their imports (sessionBar, keyLevels,
// performance, TapNote) and rendered with fixtures: all gains, mixed, a loss
// row, a missing 5Y (a young listing, from the real strip), and a stock level
// with the S&P 500. The page's wiring is read from its source.
//
// Rules: the bar's direction from the zero line; the S&P 500 tick on the same
// scale; the shared square-root scale; the "x of 6" count; a missing period is
// "—" with its reason in the tap note, never 0; the vs chip; the best/weakest
// tags; the note (price only, the as-of end, the tick, the scale); the credit
// and stamp as fine print; no advice; placement (left column under Key levels,
// above Latest earnings; before the chart on a phone); the figures are the
// strip's, never recomputed; no transform and no ReasonedValue; token sizes.
// A mutant each.
//
//   node scripts/check-performance-card.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stripComments } from "./lib/source-code.mjs";

const SESS = "lib/ta/sessionBar.ts", KL = "lib/ta/keyLevels.ts", PERF = "lib/ta/performance.ts", TAP = "app/stock/[symbol]/TapNote.tsx";
const LIB = "lib/ta/performanceCard.ts", CARD = "app/stock/[symbol]/PerformanceCard.tsx", CLIENT = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const read = (f) => fs.readFileSync(f, "utf8");
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");

let n = 0;
async function load(lib, card) {
  const unit = `import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";\n${[read(SESS), read(KL), read(PERF), read(TAP), lib].map(strip).join("\n")}\n${strip(card).replace("export default function PerformanceCard", "export function PerformanceCard")}\n`;
  const js = ts.transpileModule(unit, { fileName: "p.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText;
  const tmp = `scripts/.check-performance-card-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

// ── fixtures ────────────────────────────────────────────────────────────────
const KEYS = ["1M", "3M", "YTD", "1Y", "3Y", "5Y"];
/** A strip as lib/ta/performance.ts hands it down: [pct, spyPct] per period (null = missing). */
const hand = (pairs, extra = {}) => ({
  asOf: "2026-10-02", asOfWords: "Fri 2 Oct 2026", end: 100, live: null, benchmark: true,
  chips: pairs.map(([pct, spy], i) => ({
    key: KEYS[i], pct, reason: pct === null ? "Prices on file start Mon 4 Mar 2024, after the start of this period (Thu 2 Oct 2021)." : null,
    from: pct === null ? null : { date: "2026-01-02", close: 90 }, spyPct: pct === null ? null : spy, spyReason: null,
    diffPts: pct === null || spy === null ? null : pct - spy, note: "",
  })),
  ...extra,
});
const GAINS = hand([[4, 2], [9, 5], [12, 10], [29, 15.8], [60, 40], [136, 90]]);
const MIXED = hand([[-3.5, 1.2], [6, 4], [-8, 9], [20, 15], [45, 50], [80, 85]]);
const LEVEL = hand([[2, 2], [5, 5], [7, 7], [10, 10], [30, 30], [70, 70]]);
const EQUAL = hand([[5, 1], [5, 1], [5, 1], [5, 1], [5, 1], [5, 1]]);
// A young listing: bars from Mar 2024 only, through the real strip (5Y missing).
function bars(from, to, f) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), i = 0; t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push({ date: d.toISOString().slice(0, 10), close: f(i++), open: 1, high: 1, low: 1 });
  }
  return out;
}
const near = (a, b, tol = 1e-9) => typeof a === "number" && Math.abs(a - b) <= tol;
const ADVICE = /\b(buy|sell|outperform|should|recommend|will|target|cheap|bargain|undervalued)\b/i;
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

async function measure(M, src) {
  const young = M.performanceStrip(bars("2024-03-04", "2026-10-02", (i) => 50 + i * 0.05), bars("2021-03-01", "2026-10-02", (i) => 400 + i * 0.05));
  const cards = { gains: M.performanceCard(GAINS), mixed: M.performanceCard(MIXED), level: M.performanceCard(LEVEL), equal: M.performanceCard(EQUAL), young: M.performanceCard(young) };
  const render = (s, credit) => renderToStaticMarkup(React.createElement(M.PerformanceCard, { strip: s, credit }));
  const noteHtml = (c) => renderToStaticMarkup(React.createElement("div", null, c.note.map((t) => React.createElement("p", { key: t }, t))));
  return { M, young, cards, html: { gains: render(GAINS, React.createElement("a", { href: "#" }, "Market data from Tiingo.com")), mixed: render(MIXED), young: render(young) }, noteHtml, ...src };
}
const row = (c, k) => c.rows.find((r) => r.key === k);

const RULES = {
  "the bar: green to the right of the zero line for a gain, red to the left for a loss": ({ cards, html }) =>
    cards.gains.rows.every((r) => r.barTo > 50 && r.tone === "up") && row(cards.mixed, "1M").barTo < 50 && row(cards.mixed, "1M").tone === "down" &&
    /data-key="1M" data-tone="down"[\s\S]*?class="pcBar" style="[^"]*left:[\d.]+%;width:[\d.]+%[^"]*background:#f87171/.test(html.mixed) &&
    /data-key="3M" data-tone="up"[\s\S]*?class="pcBar" style="[^"]*left:50%;[^"]*background:#4ade80/.test(html.mixed),
  "the S&P 500 tick on the same scale: the bar runs past it when ahead, stops short when behind": ({ M, cards }) => {
    const g = cards.gains, m = cards.mixed;
    return g.rows.every((r) => near(r.tick, M.trackPos(r.spyPct, g.maxAbs)) && r.barTo > r.tick) &&
      near(row(m, "YTD").tick, M.trackPos(9, m.maxAbs)) && row(m, "YTD").barTo < row(m, "YTD").tick &&
      cards.level.rows.every((r) => near(r.barTo, r.tick));
  },
  "the scale: square root, shared by all six rows, the sign kept; the widest reaches the track's end": ({ M, cards }) => {
    const g = cards.gains;
    return g.maxAbs === 136 && near(row(g, "5Y").barTo, 98) && near((row(g, "1M").barTo - 50) / (row(g, "5Y").barTo - 50), Math.sqrt(4 / 136)) &&
      near(M.trackPos(-25, 100), 50 - 24) && M.trackPos(0, 100) === 50 && M.signedSqrt(-9) === -3;
  },
  "every row's track has the same width (fixed label and value columns; the chip on its own line), so the shared scale lines up": ({ card }) =>
    /gridTemplateColumns: `2\.75rem minmax\(0, 1fr\) \$\{valueRem\}rem`/.test(card) && !/gridTemplateColumns:[^,}]*auto/.test(card) && /gridColumn: "2 \/ 4"/.test(card) &&
    /const valueRem = Math\.max\(5\.25, Math\.max\(\.\.\.card\.rows\.map\(\(r\) => rowPctWords\(r\)\.length\)\) \* 0\.7 \+ 0\.35\);/.test(card),
  "the summary counts the rows: 'Ahead of the S&P 500 in x of 6 periods'": ({ cards, html }) =>
    cards.gains.summary === "Ahead of the S&P 500 in 6 of 6 periods" && cards.mixed.summary === "Ahead of the S&P 500 in 2 of 6 periods" &&
    cards.level.summary === "Ahead of the S&P 500 in 0 of 6 periods" && cards.equal.summary === "Ahead of the S&P 500 in 6 of 6 periods" && cards.young.summary === "Ahead of the S&P 500 in 4 of 4 periods" &&
    html.gains.includes(">Ahead of the S&amp;P 500 in 6 of 6 periods<"),
  "a missing period is '—' with its reason in the tap note, never 0": ({ young, cards, html }) => {
    const r = row(cards.young, "5Y");
    return young.chips.find((c) => c.key === "5Y").pct === null && young.chips.find((c) => c.key === "3Y").pct === null && r.pct === null && r.barTo === null && r.tick === null && r.vs === null &&
      ((li) => />—</.test(li) && !/pcBar|pcTick|pcVs/.test(li))(/<li class="pcRow" data-key="5Y"[\s\S]*?<\/li>/.exec(html.young)[0]) &&
      cards.young.note.some((t) => /^5Y: Prices on file start /.test(t));
  },
  "the vs chip: '+13.2 pts vs S&P' green, '−4.1 pts vs S&P' red, 'level with S&P' when level": ({ cards, html }) =>
    row(cards.gains, "1Y").vsWords === "+13.2 pts vs S&P" && row(cards.mixed, "1M").vsWords === "−4.7 pts vs S&P" && row(cards.mixed, "1M").vs === "behind" &&
    cards.level.rows.every((r) => r.vs === "level" && r.vsWords === "level with S&P") &&
    /class="pcVs" style="[^"]*color:#86efac[^"]*">\+13\.2 pts vs S&amp;P</.test(html.gains) && /class="pcVs" style="[^"]*color:#fca5a5[^"]*">−4\.7 pts vs S&amp;P</.test(html.mixed),
  "tags: 'best' on the highest return, 'weakest' on the lowest; none when all are equal": ({ cards }) =>
    row(cards.gains, "5Y").tag === "best" && row(cards.gains, "1M").tag === "weakest" && row(cards.mixed, "YTD").tag === "weakest" &&
    cards.gains.rows.filter((r) => r.tag).length === 2 && cards.equal.rows.every((r) => r.tag === null),
  "the note: price change only, the as-of end, the S&P tick, the scale": ({ M, cards }) => {
    const t = cards.gains.note.join(" ");
    return t.includes(M.PRICE_ONLY) && /to the close on Fri 2 Oct 2026\./.test(t) && /The thin tick on each bar is the S&P 500 \(SPY\) over the same dates\./.test(t) &&
      t.includes(M.SCALE_NOTE) && /square-root scale shared by all six rows/.test(M.SCALE_NOTE);
  },
  "the stamp and the Tiingo credit as fine print; the title opens the note": ({ html }) =>
    /<p class="pcStamp" data-fine-print="true" style="[^"]*font-size:var\(--fs-fine\)[^"]*">To the close on Fri 2 Oct 2026 · price change only · <a href="#">Market data from Tiingo\.com<\/a><\/p>/.test(html.gains) &&
    /<h2[^>]*><button[^>]*class="tapNoteBtn"[^>]*>Performance vs the S&amp;P 500<\/button><\/h2>/.test(html.gains) && !/Tiingo/.test(html.mixed),
  "no advice or forecast words": ({ cards, html }) =>
    !ADVICE.test([text(html.gains), text(html.mixed), text(html.young), ...Object.values(cards).flatMap((c) => c.note)].join(" ")),
  "placement: left column under Key levels and above Latest earnings; before the chart on a phone": ({ client }) => {
    const side = client.slice(client.indexOf('<aside className="stock-page-sidebar">'), client.indexOf("</aside>"));
    const kl = side.indexOf('<div className="sp-slot sp-keylevels">'), pc = side.indexOf('<div className="sp-slot sp-performance">'), ea = side.indexOf('<div className="sp-slot sp-earnings"');
    return kl > 0 && pc > kl && ea > pc && (client.match(/<PerformanceCard\b/g) ?? []).length === 1 &&
      /<PerformanceCard strip=\{performance\} credit=\{historyProvider === "tiingo" \? historyCredit : undefined\} \/>/.test(side) &&
      /\.sp-performance \{ order: (\d+); \}/.test(client) && Number(/\.sp-performance \{ order: (\d+); \}/.exec(client)[1]) < Number(/\.sp-chart \{ order: (\d+); \}/.exec(client)[1]);
  },
  "the figures are the strip's, never recomputed": ({ lib }) =>
    /from "\.\/performance";/.test(lib) && !/closeOnOrBefore|monthsBefore|\.close\b|pctChange|\(to - from\)/.test(lib) &&
    /diffPts: diff,/.test(lib) && /const diff = strip\.benchmark \? c\.diffPts : null;/.test(lib),
  "no transform and no ReasonedValue in the card; sizes are tokens or rem": ({ card }) =>
    !/transform|translate\(|scale\(|will-change|ReasonedValue|EstimatedValue/.test(card) && !/fontSize:\s*\d/.test(card) && !/font-size:\s*\d+px/.test(card),
};

let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };
const code = (f, s) => stripComments(s, { file: f });
const SRC = { lib: read(LIB), card: read(CARD), client: read(CLIENT) };
const meas = async (s) => measure(await load(s.lib, s.card), { lib: code(LIB, s.lib), card: code(CARD, s.card), client: code(CLIENT, s.client) });

console.log("=== Rules ===");
const base = await meas(SRC);
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));

const R = Object.keys(RULES);
const find = (start) => { const r = R.find((x) => x.startsWith(start)); if (!r) throw new Error(`no rule ${start}`); return r; };
const MUTANTS = [
  ["the bar:", "lib", (s) => s.replace("return 50 + (signedSqrt(v) / Math.sqrt(maxAbs)) * 48;", "return 50 + (Math.sqrt(Math.abs(v)) / Math.sqrt(maxAbs)) * 48;")],
  ["the bar:", "card", (s) => s.replace('background: r.tone === "down" ? C.down : r.tone === "up" ? C.up : C.flat', 'background: r.tone === "down" ? C.up : r.tone === "up" ? C.down : C.flat')],
  ["the S&P 500 tick", "lib", (s) => s.replace("tick: strip.benchmark && c.spyPct !== null && c.pct !== null ? trackPos(c.spyPct, maxAbs) : null,", "tick: strip.benchmark && c.spyPct !== null && c.pct !== null ? 50 + c.spyPct / maxAbs * 48 : null,")],
  ["the scale:", "lib", (s) => s.replace("export const signedSqrt = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));", "export const signedSqrt = (v: number) => v;")],
  ["the scale:", "lib", (s) => s.replace("const vals = strip.chips.flatMap((c) => [c.pct, strip.benchmark ? c.spyPct : null])", "const vals = strip.chips.slice(0, 1).flatMap((c) => [c.pct, strip.benchmark ? c.spyPct : null])")],
  ["every row's track", "card", (s) => s.replace("gridTemplateColumns: `2.75rem minmax(0, 1fr) ${valueRem}rem`", "gridTemplateColumns: `2.75rem minmax(0, 1fr) auto`")],
  ["the summary counts", "lib", (s) => s.replace("const ahead = compared.filter((r) => r.vs === \"ahead\").length;", "const ahead = compared.filter((r) => r.vs !== \"behind\").length;")],
  ["the summary counts", "lib", (s) => s.replace("of ${compared.length} period", "of 6 period")],
  ["a missing period", "lib", (s) => s.replace("export const rowPctWords = (r: PerfRow) => (r.pct === null ? \"—\" : pctWords(r.pct));", "export const rowPctWords = (r: PerfRow) => pctWords(r.pct ?? 0);")],
  ["a missing period", "lib", (s) => s.replace("    ...rows.filter((r) => r.reason).map((r) => `${r.key}: ${r.reason}`),\n", "")],
  ["the vs chip", "lib", (s) => s.replace('return `${diff > 0 ? "+" : "−"}${d.toFixed(1)} pts vs S&P`;', 'return `${d.toFixed(1)} pts vs S&P`;')],
  ["the vs chip", "card", (s) => s.replace('ahead: { fg: "#86efac", bg: "rgba(34,197,94,0.12)" }, behind: { fg: "#fca5a5"', 'ahead: { fg: "#fca5a5", bg: "rgba(34,197,94,0.12)" }, behind: { fg: "#86efac"')],
  ["tags:", "lib", (s) => s.replace("b.pct! > a.pct! ? b : a)) : null;\n  const worst", "b.pct! < a.pct! ? b : a)) : null;\n  const worst")],
  ["the note:", "lib", (s) => s.replace("    SCALE_NOTE,\n", "")],
  ["the note:", "lib", (s) => s.replace("    PRICE_ONLY,\n", "")],
  ["the stamp and", "card", (s) => s.replace('<p className="pcStamp" data-fine-print style={noteStyle}>', '<p className="pcStamp" style={noteStyle}>')],
  ["the stamp and", "card", (s) => s.replace("<h2 style={titleStyle}><NoteButton note={note}>{strip.benchmark ? \"Performance vs the S&P 500\" : \"Performance\"}</NoteButton></h2>", "<h2 style={titleStyle}>{strip.benchmark ? \"Performance vs the S&P 500\" : \"Performance\"}</h2>")],
  ["no advice", "lib", (s) => s.replace("did better than the S&P 500 over that period", "will likely keep beating the S&P 500")],
  ["placement:", "client", (s) => s.replace(".sp-performance { order: 5; }", ".sp-performance { order: 35; }")],
  ["placement:", "client", (s) => {
    const block = /\n {14}\{\/\* Performance vs the S&P 500[\s\S]*?\) : null\}\n/.exec(s)[0];
    return s.replace(block, "\n").replace("\n              {/* Price zones (#563", `${block}              {/* Price zones (#563`);
  }],
  ["the figures are the strip's", "lib", (s) => s.replace("const diff = strip.benchmark ? c.diffPts : null;", "const diff = strip.benchmark && c.pct !== null && c.spyPct !== null ? c.pct - c.spyPct + 0.5 : null;")],
  ["no transform", "card", (s) => s.replace('<div className="pcTrack" aria-hidden="true" style={{ position: "relative",', '<div className="pcTrack" aria-hidden="true" style={{ transform: "translateZ(0)", position: "relative",')],
  ["no transform", "card", (s) => s.replace('fontSize: "0.9375rem", fontWeight: 850', "fontSize: 15, fontWeight: 850")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [start, where, mutate] of MUTANTS) {
  const label = find(start);
  let mut;
  try { mut = mutate(SRC[where]); } catch { mut = SRC[where]; }
  if (mut === SRC[where]) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  let m;
  try { m = await meas({ ...SRC, [where]: mut }); } catch { m = null; }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
