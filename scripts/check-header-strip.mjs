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
// #563 COWORK #112 adds a decorative P/E line inside the cell (and positions the cell); COWORK #116 gives the line
// room under the words and keeps the glyph with its first word (a no-break space). The tile otherwise stays as it was.
const PE_DECOR = (s) => s.replace('<div className="stock-stat-cell" style={{ position: "relative", paddingBottom: 17 }}>', '<div className="stock-stat-cell">')
  .replace(/\n {18}\{\/\* A baseline row, so the glyph keeps[^\n]*\*\/\}/, "")
  .replace(' style={valuation.peSector ? { display: "flex", alignItems: "baseline" } : undefined}>', ">")
  .replace('{valuation.peSector.glyph}{"\\u00a0"}</span>', "{valuation.peSector.glyph} </span>")
  .replace(/\n {18}\{\/\* A's numeric sector median[^\n]*\*\/\}\n {18}\{valuation\.peRatio != null && valuation\.peSector \? <PeLine pe=\{valuation\.peRatio\} median=\{valuation\.peSector\.median\} \/> : null\}/, "");
const PE_BLOCK = /\{!valuationLoading && valuation \? \(\s*<div className="stock-stat-cell"(?: style=\{\{ position: "relative"(?:, paddingBottom: 17)? \}\})?>(?:\s*\{\/\* A's numeric sector median[^\n]*\*\/\}\s*\{valuation\.peRatio != null[^\n]*)?\s*<div className="stock-stat-label">P\/E \(\{valuation\.peBasis \?\? "TTM"\}\)<\/div>[\s\S]*?: "See valuation ↓"\}\s*<\/div>\s*<\/div>\s*\) : null\}/;

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
  "the day range: the high on top in green, the low below in red; today's candle on the 52-week track, green when last ≥ open": ({ M }) => {
    const out = html(M, "DayRange", { low: 100, high: 110, last: 107.5 });
    const hi = out.indexOf("hsHigh"), lo = out.indexOf("hsLow");
    const up = M.dayCandle({ open: 102, high: 110, low: 100, last: 107.5, yearLow: 90, yearHigh: 140 }), down = M.dayCandle({ open: 108, high: 110, low: 100, last: 101, yearLow: 90, yearHigh: 140 });
    const flat = M.dayCandle({ open: 11.24, high: 11.24, low: 11.24, last: 11.24, yearLow: 11.24, yearHigh: 13.67 }), pre = M.dayCandle({ open: null, high: 110, low: 100, last: 105 });
    const svg = html(M, "DayCandle", { open: 108, high: 110, low: 100, last: 101, yearLow: 90, yearHigh: 140 });
    return hi > 0 && lo > hi && /hsHigh" style="[^"]*color:#22c55e/.test(out) && /hsLow" style="[^"]*color:#ef4444/.test(out) && out.includes("$110.00") && out.includes("$100.00") &&
      html(M, "DayRange", { low: null, high: 110, last: 100 }).includes("—") &&
      up.up && !down.up && Math.abs(up.wickTop - 60) < 1e-9 && Math.abs(up.wickBottom - 80) < 1e-9 && Math.abs(up.bodyTop - 65) < 1e-9 && Math.abs(up.bodyBottom - 76) < 1e-9 &&
      flat.up && flat.bodyBottom - flat.bodyTop >= M.MIN_BODY_PCT - 1e-9 && flat.wickTop === flat.wickBottom && !pre.onYear && pre.wickTop === 0 && pre.wickBottom === 100 &&
      M.dayCandle({ high: null, low: 1, last: 1 }) === null &&
      /<svg class="hsCandle" data-up="0" aria-hidden="true"/.test(svg) && /class="hsBody"[^>]*fill="#ef4444"/.test(svg) && /class="hsYear"/.test(svg) &&
      // A column wide enough to read (#114): 26 px, starting below the label; a 6 px track, an 8 px body, a last-price tick.
      /viewBox="0 0 26 100"/.test(svg) && /width:26px/.test(svg) && /top:calc\(12px \+ 1\.5rem\)/.test(svg) && /class="hsYear" x="10" y="0" width="6"/.test(svg) &&
      /class="hsBody" x="9" y="[\d.]+" width="8"/.test(svg) && /class="hsLast"/.test(svg) && Math.abs(down.lastY - 78) < 1e-9 &&
      /<DayCandle open=\{quote\?\.open\} high=\{quote\?\.dayHigh\} low=\{quote\?\.dayLow\} last=\{quote\?\.price\} yearLow=\{quote\?\.yearLow\} yearHigh=\{quote\?\.yearHigh\} \/>/.test(M.page) &&
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
  "volume: the last ~30 sessions as bars, the latest brighter, a dashed 50-day average; RSI: the page's own series on a fixed 0–100 pane with the 30–70 band, dashed 70/30, red above, green below": ({ M }) => {
    const vb = M.volumeBars([1, 2, 4, null, 2], 2), many = M.volumeBars(Array.from({ length: 50 }, (_, i) => i + 1), 10);
    const vol = html(M, "VolumeBars", { vols: [1, 2, 4, 2], avg: 2, colour: "#fff" });
    const rp = M.rsiPane([null, 50, 75, 25]), rsi = html(M, "RsiPane", { series: [null, 50, 75, 25], colour: "#fff" });
    return vb.heights.length === 4 && vb.heights[2] === 100 && vb.avgY === 50 && many.heights.length === 30 && M.volumeBars([5], 1) === null &&
      /class="hsVolLast"[^>]*fill-opacity="0\.55"/.test(vol) && /class="hsVolAvg"[^>]*stroke-dasharray="3 3"/.test(vol) && /aria-hidden="true"/.test(vol) &&
      rp.y70 === 9 && rp.y30 === 21 && rp.points === "0.00,15.00 50.00,7.50 100.00,22.50" && rp.last.v === 25 && M.rsiPane([50]) === null &&
      /class="hsRsiHot" x="0" y="0" width="100" height="9" fill="#ef4444"/.test(rsi) && /class="hsRsiCold" x="0" y="21" width="100" height="9" fill="#22c55e"/.test(rsi) &&
      /class="hsRsiBand" x="0" y="9" width="100" height="12"/.test(rsi) && /class="hsRsi70"[^>]*stroke-dasharray/.test(rsi) && /class="hsRsi30"[^>]*stroke-dasharray/.test(rsi) && /class="hsRsiDot"/.test(rsi) &&
      /<VolumeBars vols=\{history\.map\(\(p\) => p\.volume\)\} avg=\{quote\?\.avgVolume\}/.test(M.page) && /<RsiPane series=\{rsi14\}/.test(M.page) &&
      /const rsi14 = useMemo\(\(\) => rsiWilder\(closes, 14\), \[closes\]\);/.test(M.page) && !/<PositionBar /.test(M.page);
  },
  "the P/E tile and A's sector line are as they were": ({ M }) => {
    const now = M.raw.match(PE_BLOCK)?.[0];
    return !!now && PE_DECOR(now) === PE_BEFORE;
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
  "P/E: the sector median as a tick, the stock as a dot, the gap green below and amber above; none for a loss or without the median": ({ M }) => {
    const below = M.peLine(20, 30), above = M.peLine(40, 30), near = M.peLine(30.2, 30);
    const svgB = html(M, "PeLine", { pe: 20, median: 30 }), svgA = html(M, "PeLine", { pe: 40, median: 30 });
    return below.below && !above.below && Math.abs(below.median - 80) < 1e-9 && Math.abs(below.stock - 53.333333333) < 1e-6 && Math.abs(above.stock - 80) < 1e-9 && Math.abs(near.stock - near.median) < 1 &&
      M.peLine(-5, 30) === null && M.peLine(null, 30) === null && M.peLine(20, null) === null &&
      !("sectorMedianOf" in M) &&
      /class="hsPeGap"[^>]*fill="#22c55e"/.test(svgB) && /class="hsPeGap"[^>]*fill="#f59e0b"/.test(svgA) && /class="hsPeMedian" x1="80" x2="80"/.test(svgB) && /aria-hidden="true"/.test(svgB) &&
      /\{valuation\.peRatio != null && valuation\.peSector \? <PeLine pe=\{valuation\.peRatio\} median=\{valuation\.peSector\.median\} \/> : null\}/.test(M.page);
  },
  "price: the last 5 sessions' closes behind the price, a dashed line at the previous close, daily closes only": ({ M }) => {
    const p = M.priceSpark([1, 2, 3, 4, 5, 6, 7], 6), svg = html(M, "PriceSpark", { closes: [1, 2, 3, 4, 5, 6, 7], prevClose: 6 });
    return p.points === "0.00,30.00 25.00,22.50 50.00,15.00 75.00,7.50 100.00,0.00" && p.prevY === 7.5 && p.up === true && M.priceSpark([5, 4], 6).up === false &&
      M.priceSpark([5], 4) === null && /class="hsPrev"[^>]*stroke-dasharray="3 3"/.test(svg) && /stroke="#22c55e"/.test(svg) && /aria-hidden="true"/.test(svg) &&
      // In the cell's right part, level with the big number, clear of the change line (#114).
      /left:52%/.test(svg) && /top:calc\(12px \+ 1\.35rem\)/.test(svg) && /height:1\.5rem/.test(svg) &&
      /<PriceSpark closes=\{closes\} prevClose=\{quote\?\.previousClose\} \/>/.test(M.page);
  },
  "every mini-graphic is decorative (aria-hidden, no pointer events), absolutely placed in a positioned cell, with no transform": ({ M }) => {
    const parts = M.partsSrc.slice(M.partsSrc.indexOf("const behind: CSSProperties"));
    const cells = ["<PriceSpark ", "<DayCandle ", "<VolumeBars ", "<RsiPane ", "<PeLine "];
    // Each graphic's own cell (the nearest stat cell before it) is positioned.
    return cells.every((c) => { const i = M.page.indexOf(c); const cell = M.page.lastIndexOf('<div className="stock-stat-cell"', i); return i > 0 && cell > 0 && M.page.startsWith('<div className="stock-stat-cell" style={{ position: "relative"', cell); }) &&
      (parts.match(/aria-hidden="true" focusable="false"/g) ?? []).length === 5 && !/transform|translate\(|rotate\(|will-change/.test(parts) && /pointerEvents: "none"/.test(parts);
  },
  "the small text stays readable over the graphics: the cell's text paints above them, the small lines carry a halo (no z-index)": ({ M }) =>
    /\.stock-stat-cell > :not\(svg\) \{ position: relative; \}/.test(M.raw) &&
    /\.stock-stat-label, \.stock-stat-sub, \.hsRange \{ text-shadow: 0 0 2px #080d18, 0 0 2px #080d18, 0 0 4px #080d18; \}/.test(M.raw) &&
    !/\.stock-stat-cell[^{]*\{[^}]*z-index/.test(M.raw),
  // #563 COWORK #116: at 390 px the glyph sat alone above its words, and the line touched their underline.
  "P/E: the glyph keeps to its first word (a baseline row, a no-break space); the line sits ~4 px clear of the words": ({ M }) =>
    /data-pe-sector=\{valuation\.peSector \? "" : undefined\} style=\{valuation\.peSector \? \{ display: "flex", alignItems: "baseline" \} : undefined\}>/.test(M.page) &&
    M.page.includes('{valuation.peSector.glyph}{"\\u00a0"}</span>') &&
    M.page.includes('<div className="stock-stat-cell" style={{ position: "relative", paddingBottom: 17 }}>') &&
    /className="hsPe"[\s\S]{0,200}bottom: 3, width: "calc\(100% - 20px\)", height: 12,/.test(M.partsSrc),
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
  [R[1], "lib", (s) => s.replace("up: last >= open, onYear", "up: last > open + 1, onYear")],
  [R[1], "lib", (s) => s.replace("if (bodyBottom - bodyTop < MIN_BODY_PCT) {", "if (false) {")],
  [R[1], "parts", (s) => s.replace("const colour = c.up ? UP : DOWN;", "const colour = c.up ? DOWN : UP;")],
  [R[2], "parts", (s) => s.replace('<svg className="hsSpark" aria-hidden="true" focusable="false"', '<svg className="hsSpark" role="img" focusable="false"')],
  [R[2], "page", (s) => s.replace("<TrendSpark closes={closes.slice(-240)}", "<TrendSpark closes={closes.slice(-60)}")],
  [R[3], "lib", (s) => s.replace("avgY: fin(avg) && avg > 0 ? 100 - (avg / top) * 100 : null", "avgY: null")],
  [R[3], "lib", (s) => s.replace("y70: yOn(70, 0, 100, h), y30: yOn(30, 0, 100, h)", "y70: yOn(80, 0, 100, h), y30: yOn(20, 0, 100, h)")],
  [R[3], "parts", (s) => s.replace('<rect className="hsRsiHot" x={0} y={0} width={100} height={p.y70} fill={DOWN}', '<rect className="hsRsiHot" x={0} y={0} width={100} height={p.y70} fill={UP}')],
  [R[3], "page", (s) => s.replace("<RsiPane series={rsi14}", "<RsiPane series={closes}")],
  [R[7], "lib", (s) => s.replace("return { stock: (pe / top) * 100, median: (median / top) * 100, below: pe < median };", "return { stock: (pe / top) * 100, median: 50, below: pe < median };")],
  [R[7], "parts", (s) => s.replace('fill={l.below ? UP : "#f59e0b"}', 'fill={l.below ? "#f59e0b" : UP}')],
  [R[8], "lib", (s) => s.replace("prevY: fin(prevClose) ? yOn(prevClose, lo, hi, h) : null", "prevY: null")],
  [R[8], "lib", (s) => s.replace("const v = closes.filter(fin).slice(-n);\n  if (v.length < 2) return null;\n  const lo = Math.min(...v, fin(prevClose)", "const v = closes.filter(fin).slice(-20);\n  if (v.length < 2) return null;\n  const lo = Math.min(...v, fin(prevClose)")],
  [R[10], "page", (s) => s.replace("        .stock-stat-cell > :not(svg) { position: relative; }\n", "")],
  [R[10], "page", (s) => s.replace(".stock-stat-label, .stock-stat-sub, .hsRange { text-shadow:", ".stock-stat-label, .hsRange { text-shadow:")],
  [R[11], "page", (s) => s.replace(' style={valuation.peSector ? { display: "flex", alignItems: "baseline" } : undefined}>', ">")],
  [R[11], "parts", (s) => s.replace('right: 10, bottom: 3, width: "calc(100% - 20px)", height: 12,', 'right: 10, bottom: 6, width: "calc(100% - 20px)", height: 12,')],
  [R[1], "parts", (s) => s.replace('viewBox="0 0 26 100" preserveAspectRatio="none"', 'viewBox="0 0 10 100" preserveAspectRatio="none"').replace("bottom: 12, width: 26,", "bottom: 12, width: 10,")],
  [R[1], "parts", (s) => s.replace('top: "calc(12px + 1.5rem)", bottom: 12', "top: 12, bottom: 12")],
  [R[8], "parts", (s) => s.replace('style={{ position: "absolute", left: "52%", right: 10, top: "calc(12px + 1.35rem)", height: "1.5rem", width: "calc(48% - 10px)",', 'style={{ ...behind,')],
  [R[7], "page", (s) => s.replace("median={valuation.peSector.median}", "median={valuation.peRatio}")],
  [R[9], "parts", (s) => s.replace('style={{ position: "absolute", right: 10, top: "calc(12px + 1.5rem)",', 'style={{ transform: "translateZ(0)", position: "absolute", right: 10, top: "calc(12px + 1.5rem)",')],
  [R[9], "parts", (s) => s.replace('<svg className="hsVolume" aria-hidden="true" focusable="false"', '<svg className="hsVolume" focusable="false"')],
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
