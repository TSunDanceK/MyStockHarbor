// THE STOCK PAGE'S HEADER STRIP (#563 COWORK #99 §4): rules, then mutants.
//
// lib/headerStrip.ts and app/stock/[symbol]/HeaderStripParts.tsx, transpiled
// into one module with the page's own formatChangeLabel (lifted from
// StockSymbolPageClient.tsx), rendered with fixtures, and the page's wiring
// read from its source.
//
// Rules: the arrow and the sign agree, with spoken words; the day range is the
// high on top in green, the low below in red, and the bar marks the price's
// place in it; the Trend score's line is decorative (aria-hidden) and drawn
// over the chart's window; the Volume and RSI bars sit on their scales; the
// P/E tile and A's sector line are untouched; nothing can push the strip
// sideways at 320–430 px; the header no longer renders the 1M–5Y period boxes
// (#563 COWORK #111: they are the Performance card). A mutant each.
//
//   node scripts/check-header-strip.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { grabFunction } from "./lib/earnings-plan.mjs";
import { stripComments } from "./lib/source-code.mjs";

const LIB = "lib/headerStrip.ts", PARTS = "app/stock/[symbol]/HeaderStripParts.tsx", PAGE = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const read = (f) => fs.readFileSync(f, "utf8");
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");

let n = 0;
async function load(lib, parts, page) {
  const unit = `${strip(lib)}\n${strip(parts)}\n${grabFunction(page, "formatChangeLabel")}\nexport { formatChangeLabel };\n`;
  const tmp = `scripts/.check-header-strip-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, ts.transpileModule(unit, { fileName: "h.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
const html = (M, C, p) => renderToStaticMarkup(React.createElement(M[C], p));
/** The P/E tile as it stood on main before this PR (A's #741 line, at c2928b1d), which must not change. */
const PE_BEFORE = "{!valuationLoading && valuation ? (\n                <div className=\"stock-stat-cell\">\n                  <div className=\"stock-stat-label\">P/E ({valuation.peBasis ?? \"TTM\"})</div>\n                  <div className=\"stock-stat-value\">\n                    {valuation.peRatio != null\n                      ? formatValuationMultiple(valuation.peRatio)\n                      : <ReasonedValue text={valuation.words?.peRatio ?? \"—\"} reason={valuation.reasons?.peRatio} />}\n                  </div>\n                  {/* P/E VS ITS SECTOR (#552 COWORK #147 §2): the glyph and the\n                      words carry it, in the page's ordinary ink (a comparison,\n                      not a verdict); the note names the peers and the date. */}\n                  <div className=\"stock-stat-sub\" data-pe-sector={valuation.peSector ? \"\" : undefined}>\n                    {valuation.peSector\n                      ? <><span aria-hidden=\"true\">{valuation.peSector.glyph} </span><ReasonedValue text={valuation.peSector.text} reason={valuation.peSector.note} /></>\n                      : \"See valuation ↓\"}\n                  </div>\n                </div>\n              ) : null}";
const PE_BLOCK = /\{!valuationLoading && valuation \? \(\s*<div className="stock-stat-cell">\s*<div className="stock-stat-label">P\/E \(\{valuation\.peBasis \?\? "TTM"\}\)<\/div>[\s\S]*?: "See valuation ↓"\}\s*<\/div>\s*<\/div>\s*\) : null\}/;

const RULES = {
  "the arrow and the sign agree (▲ with +, ▼ with −, none when unchanged), with spoken words": ({ M }) => {
    const cases = [[1.23, 0.45], [-2.5, -1.1], [0, 0], [0.004, 0.001], [-0.004, -0.001]];
    const agree = cases.every(([c, p]) => {
      const label = M.formatChangeLabel(c, p), d = M.changeDirection(c), out = html(M, "PriceChange", { change: c, pct: p, label });
      const arrow = (out.match(/[▲▼]/g) ?? []).join("");
      return (d === "up" ? label.startsWith("+") && arrow === "▲" && /color:#22c55e/.test(out) && /aria-label="Up /.test(out)
        : d === "down" ? label.startsWith("-") && arrow === "▼" && /color:#ef4444/.test(out) && /aria-label="Down /.test(out)
        : arrow === "" && /aria-label="Unchanged today"/.test(out)) && out.includes(label);
    });
    return agree && M.changeDirection(null) === null && M.changeAria(-2.5, -1.1) === "Down 2.50 (1.10%) today" &&
      /<PriceChange change=\{quote\?\.change\} pct=\{quote\?\.changePercentage\} label=\{formatChangeLabel\(quote\?\.change, quote\?\.changePercentage\)!\} \/>/.test(M.page);
  },
  "the day range: the high on top in green, the low below in red, the bar at the price's place": ({ M }) => {
    const out = html(M, "DayRange", { low: 100, high: 110, last: 107.5 });
    const hi = out.indexOf("hsHigh"), lo = out.indexOf("hsLow");
    return M.rangePosition(100, 110, 107.5) === 75 && M.rangePosition(100, 110, 120) === 100 && M.rangePosition(100, 110, 90) === 0 &&
      M.rangePosition(100, 100, 100) === 50 && M.rangePosition(110, 100, 105) === null && M.rangePosition(100, 110, null) === null &&
      hi > 0 && lo > hi && /hsHigh" style="[^"]*color:#22c55e/.test(out) && /hsLow" style="[^"]*color:#ef4444/.test(out) &&
      out.includes("$110.00") && out.includes("$100.00") && /data-pos="75\.0"/.test(out) && /left:calc\(75% - 4px\)/.test(out) &&
      html(M, "DayRange", { low: null, high: 110, last: 100 }).includes("—") &&
      /<DayRange low=\{quote\?\.dayLow\} high=\{quote\?\.dayHigh\} last=\{quote\?\.price\} \/>\s*<div className="stock-stat-sub">52wk <span style=\{\{ whiteSpace: "nowrap" \}\}>\{formatRange\(quote\?\.yearLow, quote\?\.yearHigh\)\}<\/span><\/div>/.test(M.page);
  },
  "the Trend score's line is decorative (aria-hidden), over the chart's window, in the score's colour; the number and word stay": ({ M }) => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 9) * 10);
    const out = html(M, "TrendSpark", { closes, colour: "#22c55e" });
    const pts = M.sparkPoints([1, 3, 2], 100, 30);
    return /<svg class="hsSpark" aria-hidden="true" focusable="false"/.test(out) && /pointer-events:none/.test(out) && /stroke="#22c55e"/.test(out) &&
      pts === "0.00,30.00 50.00,0.00 100.00,15.00" && M.sparkPoints([5]) === null && html(M, "TrendSpark", { closes: [1], colour: "#fff" }) === "" &&
      /<TrendSpark closes=\{closes\.slice\(-240\)\} colour=\{trendTone \? toneColor\(trendTone\) : "rgba\(203,213,225,0\.8\)"\} \/>\s*<div className="stock-stat-label">Trend score<\/div>/.test(M.page) &&
      /data=\{history\.slice\(-240\)\}/.test(M.page) &&
      /\{trendScore\.known \? `\$\{trendScore\.passed\}\/\$\{trendScore\.total\}` : "—"\}/.test(M.page) && /\{trend \?\? "Not enough history yet"\}/.test(M.page);
  },
  "the Volume and RSI bars sit on their scales (RSI 0–100 with 30/70 marks, volume 0–2× with 1× in the middle)": ({ M }) => {
    const bar = html(M, "PositionBar", { pos: 70, ticks: [30, 70] });
    return M.rsiPosition(70) === 70 && M.rsiPosition(null) === null && M.volumePosition(2e6, 1e6) === 100 && M.volumePosition(1e6, 1e6) === 50 &&
      M.volumePosition(5e6, 1e6) === 100 && M.volumePosition(1e6, 0) === null && /aria-hidden="true"/.test(bar) && (bar.match(/left:30%|left:70%/g) ?? []).length === 2 &&
      html(M, "PositionBar", { pos: null }) === "" &&
      /<PositionBar pos=\{rsiPosition\(typeof lastRsi === "number" \? lastRsi : null\)\} ticks=\{\[30, 70\]\}/.test(M.page) &&
      /<PositionBar pos=\{volumePosition\(quote\?\.volume, quote\?\.avgVolume\)\} ticks=\{\[50\]\}/.test(M.page);
  },
  "the P/E tile and A's sector line are as they were": ({ M }) => {
    const now = M.raw.match(PE_BLOCK)?.[0];
    return !!now && now === PE_BEFORE;
  },
  "nothing in the strip can push the page sideways at 320–430 px": ({ M }) =>
    !/nowrap|width:\s*\d{3,}|minWidth:\s*\d{3,}/.test(M.partsSrc) && /width: "calc\(100% - 20px\)"/.test(M.partsSrc) &&
    /\.stock-header-stats \{\s*display: grid !important;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/.test(M.raw) &&
    /\.stock-stat-cell \{\s*flex: 0\.7 1 130px;[\s\S]*?min-width: 0;/.test(M.raw),
  "the header no longer renders the 1M–5Y period boxes; the stat row and the price stamp stay": ({ M }) => {
    const header = M.page.slice(M.page.indexOf("<header"), M.page.indexOf("</header>"));
    return header.length > 0 && !/PerformanceStrip|perfChip|perfStrip/.test(header) && !/^import PerformanceStrip /m.test(M.page) &&
      /className="stock-header-stats"/.test(header) && /Price: \{quote\.priceLabel\}/.test(header);
  },
};

const src = { lib: read(LIB), parts: read(PARTS), page: read(PAGE) };
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };
const measure = async (s) => {
  const M = await load(s.lib, s.parts, s.page);
  return { M: Object.assign(Object.create(M), { page: stripComments(s.page, { file: PAGE }), raw: s.page, partsSrc: stripComments(s.parts, { file: PARTS }) }) };
};

console.log("=== Rules ===");
const base = await measure(src);
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));

const R = Object.keys(RULES);
const MUTANTS = [
  [R[0], "lib", (s) => s.replace('export const ARROW: Record<Direction, string> = { up: "▲", down: "▼", flat: "" };', 'export const ARROW: Record<Direction, string> = { up: "▼", down: "▲", flat: "" };')],
  [R[0], "parts", (s) => s.replace(' aria-label={changeAria(change, pct) ?? undefined}', "")],
  [R[1], "parts", (s) => s.replace('<div className="hsHigh" style={{ ...row, color: UP }}><span style={tag}>High</span>{price(high)}</div>\n      <div className="hsLow" style={{ ...row, color: DOWN }}><span style={tag}>Low</span>{price(low)}</div>', '<div className="hsLow" style={{ ...row, color: DOWN }}><span style={tag}>Low</span>{price(low)}</div>\n      <div className="hsHigh" style={{ ...row, color: UP }}><span style={tag}>High</span>{price(high)}</div>')],
  [R[1], "lib", (s) => s.replace("return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));", "return Math.max(0, Math.min(100, ((hi - v) / (hi - lo)) * 100));")],
  [R[2], "parts", (s) => s.replace('<svg className="hsSpark" aria-hidden="true" focusable="false"', '<svg className="hsSpark" role="img" focusable="false"')],
  [R[2], "page", (s) => s.replace("<TrendSpark closes={closes.slice(-240)}", "<TrendSpark closes={closes.slice(-60)}")],
  [R[3], "lib", (s) => s.replace("return rangePosition(0, 2, typeof volume === \"number\" ? volume / avg : null);", "return rangePosition(0, 3, typeof volume === \"number\" ? volume / avg : null);")],
  [R[3], "page", (s) => s.replace("ticks={[30, 70]}", "ticks={[20, 80]}")],
  [R[4], "page", (s) => s.replace(': "See valuation ↓"}', ': "See the valuation section"}')],
  [R[6], "page", (s) => s.replace("</div>{/* end hero box */}", "{performance ? <PerformanceStrip strip={performance} /> : null}</div>{/* end hero box */}")],
  [R[5], "parts", (s) => s.replace('style={{ position: "relative", height: 4, marginTop: 6,', 'style={{ position: "relative", height: 4, marginTop: 6, minWidth: 220,')],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [label, where, mutate] of MUTANTS) {
  const mut = mutate(src[where]);
  if (mut === src[where]) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  let m;
  try { m = await measure({ ...src, [where]: mut }); } catch { m = null; }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
