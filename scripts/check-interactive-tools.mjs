// The Interactive chart's tools (Relay B, #553 COWORK #28 part a, #29).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE MENU AND THE SHEET DRIFT: two renderings of one menu, each wired to
//      its own copy of the actions. Both are built from buildChartMenu() and
//      run through one runAction().
//   2. THE % SCALE MEASURES FROM THE WRONG BAR: it must be the first VISIBLE
//      bar (klinecharts' "percentage" axis), so it re-bases on pan and zoom.
//   3. A MENU OFF THE CHART: opened near an edge it must stay inside.
//   4. LONG-PRESS FIRES DURING A PAN: movement past the slop cancels it.
//   5. #29, TOUCH ON THE AXES: the strips must be touch-action:none (or the page
//      scrolls instead), replay the drag as a mouse drag that the library does
//      not discard (sourceCapabilities), and double-tap must reset.
//   6. RECENTER LEAVES A STRETCHED PRICE AXIS FROZEN: it must turn auto-fit back on.
//
// The rendered test (desktop right-click menu, % re-base on pan, phone sheet,
// long-press, axis drag + double-tap) is posted on #553 with the screenshots.
//
//   node scripts/check-interactive-tools.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const MODULE = "lib/interactiveChartMenu.ts";
const CHART = "app/components/InteractiveChart.tsx";

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-ictools-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const CAT = {
  chartTypes: [{ key: "candle_solid", label: "Candle" }, { key: "area", label: "Line" }],
  intervals: [{ key: "d", label: "D" }, { key: "w", label: "W" }, { key: "m", label: "M" }],
  indicators: [{ key: "MA", label: "MA" }, { key: "RSI", label: "RSI" }],
  drawTools: [{ key: "trend", label: "Trend line" }],
};

async function suite(M, chart) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  const menu = M.buildChartMenu({ interval: "w", chartType: "area", activeIndicators: ["RSI"], scale: "percent", canFullscreen: true }, CAT);
  const keys = menu.map((s) => s.key).join(",");
  ok("the menu's order: Chart type, Timeframe, Indicators, Draw, Scale, then the actions", keys === "type,tf,ind,draw,scale,recenter,undo,clear,fullscreen", keys);
  const ticked = (k) => menu.find((s) => s.key === k).items.filter((i) => i.checked).map((i) => i.id).join(",");
  ok("the current chart type, timeframe, scale and active indicators are ticked", ticked("type") === "type:area" && ticked("tf") === "tf:w" && ticked("ind") === "ind:RSI" && ticked("scale") === "scale:percent");
  ok("no Fullscreen entry when already fullscreen", !M.buildChartMenu({ interval: "d", chartType: "area", activeIndicators: [], scale: "price", canFullscreen: false }, CAT).some((s) => s.key === "fullscreen"));
  ok("Measure appears only when the tools are given, with no Clear measures (a measure is temporary, #43)", !menu.some((s) => s.key === "measure") &&
    JSON.stringify(M.buildChartMenu({ interval: "d", chartType: "area", activeIndicators: [], scale: "price", canFullscreen: false }, { ...CAT, measureTools: [{ key: "range", label: "Price range" }] }).find((s) => s.key === "measure")?.items.map((i) => i.id)) === '["measure:range"]');
  ok("actions parse into verb and argument", JSON.stringify(M.parseAction("ind:RSI")) === '["ind","RSI"]' && JSON.stringify(M.parseAction("recenter")) === '["recenter",null]');

  // 2. The % base: the first VISIBLE bar.
  const data = [{ timestamp: 1, close: 100 }, { timestamp: 2, close: 110 }, { timestamp: 3, close: 121 }];
  ok("the % base is the first visible bar's close", M.percentBase(data, 1)?.close === 110 && M.percentBase(data, 0)?.close === 100);
  ok("...so panning re-bases it", M.percentBase(data, 2)?.timestamp === 3);
  ok("the % value is change from the base", Math.abs(M.pctFromBase(121, 110) - 10) < 1e-9 && Math.abs(M.pctFromBase(99, 110) + 10) < 1e-9);
  ok("the scale is remembered; anything unknown reads as price", M.readScale("percent") === "percent" && M.readScale(null) === "price" && M.readScale("x") === "price");

  // 3. Clamping.
  const c = M.clampMenu(780, 480, 196, 300, 800, 500);
  ok("a menu opened near the bottom-right corner stays inside the chart", c.left + 196 <= 800 && c.top + 300 <= 500 && c.left >= 0 && c.top >= 0, JSON.stringify(c));
  ok("...and one opened in open space stays at the cursor", JSON.stringify(M.clampMenu(100, 80, 196, 300, 800, 500)) === JSON.stringify({ left: 100, top: 80 }));

  // 4. Long-press.
  ok("a still finger for 500ms is a long-press", M.isLongPress(0, 520, 2, 3));
  ok("a moving finger (a pan) is not", !M.isLongPress(0, 900, 12, 0));
  ok("a quick tap is not", !M.isLongPress(0, 200, 0, 0));

  // 5-6. Wiring in the chart.
  ok("the % chip toggles the klinecharts percentage axis", /yAxis: \{ type: mode === "percent" \? "percentage" : "normal" \}/.test(chart) && /onClick=\{\(\) => setScale\(scale === "percent" \? "price" : "percent"\)\}/.test(chart));
  ok("the chip follows the first visible bar on pan and zoom", /subscribeAction\("onVisibleRangeChange", updateChip\)/.test(chart) && /percentBase\(chart\.getDataList\(\), chart\.getVisibleRange\(\)\.from\)/.test(chart));
  ok("the scale is read and written through the guarded storage helper", /readScale\(readStored\(SCALE_KEY\)\)/.test(chart) && /writeStored\(SCALE_KEY, mode\)/.test(chart) && !/localStorage/.test(chart));
  ok("the right-click menu and the phone sheet render the same model through one runAction",
    /<ChartContextMenu sections=\{menuSections\}[\s\S]{0,300}onAction=\{runAction\}/.test(chart) && /<ChartToolsSheet sections=\{menuSections\} onAction=\{runAction\}/.test(chart));
  ok("the context menu opens only on desktop, at the cursor", /function onContextMenu\(e: React\.MouseEvent\) \{\s*if \(isMobile \|\| onOwnControl\(e\.target\)\) return;\s*e\.preventDefault\(\);/.test(chart));
  ok("the menu is keyboard-accessible: Esc, arrows, Enter", /e\.key === "Escape"/.test(chart) && /e\.key === "ArrowDown"/.test(chart) && /e\.key === "ArrowRight" && focus\.level === 0/.test(chart) && /role="menu"/.test(chart));
  ok("the menu is clamped inside the chart", /const pos = clampMenu\(at\.x, at\.y, MENU_W,/.test(chart));
  ok("long-press opens the sheet and a second finger (pinch) cancels it", /window\.setTimeout\(\(\) => \{ pressRef\.current = null; setSheetOpen\(true\); \}, LONG_PRESS_MS\)/.test(chart) && /a second finger: a pinch/.test(readRaw(CHART)));
  ok("movement past the slop cancels the long-press", /> LONG_PRESS_SLOP\) \{ window\.clearTimeout\(p\.timer\); pressRef\.current = null; \}/.test(chart));
  ok("phone toolbar: [D W M] + one Tools button, nothing else wraps", /const narrow = isMobile && !compact;/.test(chart) && /\{narrow \? \(\s*<button type="button" onClick=\{\(\) => setSheetOpen\(true\)\} data-chart-tools/.test(chart) && /\{!narrow \? \(<>/.test(chart));
  ok("sheet rows are at least 44px tall", /minHeight: 44, padding: "0 16px"/.test(chart));
  ok("Recenter, Undo and Clear are icon-only with tooltips", /const iconOnlyActions = true;/.test(chart) && /title="Recenter chart" aria-label="Recenter chart"/.test(chart) && /title="Undo last drawing" aria-label="Undo last drawing"/.test(chart));
  ok("#29: the axis strips are touch-action:none", (chart.match(/data-axis-strip="[xy]" style=\{\{[^}]*touchAction: "none"/g) ?? []).length === 2);
  ok("#29: the strips are at least 44px to hit", /data-axis-strip="y" style=\{\{[^}]*width: 56/.test(chart) && /data-axis-strip="x" style=\{\{[^}]*height: 44/.test(chart));
  ok("#29: the replayed mouse events say they are not from touch (else the library drops them)", /Object\.defineProperty\(ev, "sourceCapabilities", \{ value: \{ firesTouchEvents: false \} \}\)/.test(chart));
  ok("#29: strips only on touch-first devices (they would take the desktop mouse drag)", /window\.matchMedia\("\(pointer: coarse\)"\)/.test(chart) && /\{coarse \? \(<>/.test(chart));
  ok("#29: double-tap resets the axis", /if \(now - lastTap < 300\) \{/.test(chart) && /if \(axis === "y"\) applyScale\(scaleRef\.current\);/.test(chart));
  ok("Recenter turns the price axis's auto-fit back on", /setOffsetRightDistance\(isMobile \? 8 : 12\); \} catch \{[^}]*\}\s*applyScale\(scaleRef\.current\);/.test(chart));
  return fails;
}
function readRaw(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }

const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
const chart = readCodeOnly(CHART);

const base = await suite(await loadSibling(MODULE, src), chart);
if (base.length) {
  console.error("FAIL check-interactive-tools:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["the % base is the first bar of the whole history", () => [mut("base", src, "const i = Math.max(0, Math.floor(visibleFrom));", "const i = 0;"), chart]],
  ["% measured against the current value, not the base (swapped)", () => [mut("pct", src, "return ((value - base) / base) * 100;", "return ((value - base) / value) * 100;"), chart]],
  ["the menu is not clamped", () => [mut("clamp", src, "left: Math.max(pad, Math.min(x, W - w - pad)),", "left: x,"), chart]],
  ["long-press ignores movement", () => [mut("slop", src, "&& Math.hypot(dx, dy) <= LONG_PRESS_SLOP", ""), chart]],
  ["the timeframe tick is wrong", () => [mut("tick", src, "checked: t.key === state.interval", "checked: false"), chart]],
  ["the strips lose touch-action:none (the page scrolls instead)", () => [src, chart.replace(/(data-axis-strip="y" style=\{\{[^}]*)touchAction: "none"/, "$1touchAction: \"auto\"")]],
  ["the replay does not set sourceCapabilities (the library drops it)", () => [src, mut("caps", chart, `Object.defineProperty(ev, "sourceCapabilities", { value: { firesTouchEvents: false } });`, "")]],
  ["the strips on every device (steal the desktop mouse drag)", () => [src, mut("coarse", chart, "{coarse ? (<>", "{true ? (<>")]],
  ["the sheet gets its own action handler", () => [src, mut("sheet", chart, "<ChartToolsSheet sections={menuSections} onAction={runAction}", "<ChartToolsSheet sections={menuSections} onAction={() => setSheetOpen(false)}")]],
  ["Recenter leaves the stretched axis frozen", () => [src, chart.replace(/(setOffsetRightDistance\(isMobile \? 8 : 12\); \} catch \{[^}]*\}\s*)applyScale\(scaleRef\.current\);/, "$1")]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, c] = make();
  let fails;
  try { fails = await suite(await loadSibling(MODULE, s), c); } catch { fails = ["threw"]; }
  if (!fails.length) { survived++; console.error(`MUTANT SURVIVED: ${label}`); }
}
if (survived) process.exit(1);
console.log(`check-interactive-tools: menu model, % base, clamp, long-press and #29 axis strips hold; ${MUTANTS.length} mutants caught`);
