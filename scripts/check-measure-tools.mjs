// The Interactive chart's measure tools (Relay B, #553 COWORK #28 part b).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE WRONG % BASE: the % must be measured from the START point (where the
//      measure began), so 100 -> 110 is +10% and 110 -> 100 is -9.09%.
//   2. THE WRONG SPAN: bars are end index minus start index (signed); days are
//      calendar days between the two bars' dates, left out past the last bar.
//   3. THE WRONG LABEL: each tool shows only its own line(s); signs and
//      plurals read right ("1 bar", a real minus sign).
//   4. WIRING: Measure ▾ in the toolbar and Measure ▸ in the menu/sheet run the
//      same startMeasure. A measure is TEMPORARY (COWORK #43): the next press
//      on the chart (or Esc) only clears it -- swallowed in the capture phase,
//      so it cannot pan, place or select -- and it is never in Undo, never
//      selectable. Shift + drag runs in the capture phase (before the library
//      pans). Touch pauses panning only while the two taps are placed.
//
// The rendered test (desktop: toolbar, both menus, up/down %, the clearing
// click that neither pans nor places, Esc, Undo untouched, Shift + drag; phone:
// sheet, tap-tap, the clearing tap) is posted on #553 with the screenshots.
//
//   node scripts/check-measure-tools.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const MODULE = "lib/measure.ts";
const CHART = "app/components/InteractiveChart.tsx";

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-measure-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1); // a Wednesday
const near = (a, b, eps = 1e-9) => a !== null && Math.abs(a - b) < eps;

async function suite(M, chart) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  // 1. The % base is the start point.
  const up = M.measureStats({ value: 100, dataIndex: 10, timestamp: T0 }, { value: 110, dataIndex: 28, timestamp: T0 + 25 * DAY });
  const down = M.measureStats({ value: 110, dataIndex: 10, timestamp: T0 }, { value: 100, dataIndex: 28, timestamp: T0 + 25 * DAY });
  ok("100 -> 110 is +10 and +10%", near(up.dPrice, 10) && near(up.dPct, 10), JSON.stringify(up));
  ok("110 -> 100 is -10 and -9.09% (the base is where it started)", near(down.dPrice, -10) && near(down.dPct, -100 / 11), JSON.stringify(down));
  ok("up is green, down is red", up.up === true && down.up === false && M.measureColor("both", up) === M.MEASURE_UP && M.measureColor("price", down) === M.MEASURE_DOWN);
  ok("a date range has no direction (neutral colour)", M.measureColor("date", down) === M.MEASURE_NEUTRAL);
  ok("a start at 0 has no % (no divide by zero)", M.measureStats({ value: 0 }, { value: 5 }).dPct === null);

  // 2. The span.
  ok("bars are end minus start: 18", up.bars === 18);
  ok("days are calendar days between the bars' dates: 25", up.days === 25);
  const back = M.measureStats({ value: 1, dataIndex: 30, timestamp: T0 + 7 * DAY }, { value: 1, dataIndex: 25, timestamp: T0 });
  ok("drawn right to left the span is negative", back.bars === -5 && back.days === -7, JSON.stringify(back));
  const future = M.measureStats({ value: 1, dataIndex: 30, timestamp: T0 }, { value: 2, dataIndex: 40 });
  ok("past the last bar (no date) the days are left out, the bars are not", future.bars === 10 && future.days === null);

  // 3. Labels.
  ok("price label: +10.00 (+10.00%)", M.priceLabel(up) === "+10.00 (+10.00%)", M.priceLabel(up));
  ok("price label down uses a real minus sign: −10.00 (−9.09%)", M.priceLabel(down) === "−10.00 (−9.09%)", M.priceLabel(down));
  ok("price label follows the chart's price precision", M.priceLabel(up, 3) === "+10.000 (+10.00%)");
  ok("date label: 18 bars · 25 days", M.dateLabel(up) === "18 bars · 25 days", M.dateLabel(up));
  ok("date label: singulars, and no days past the last bar", M.dateLabel(M.measureStats({ dataIndex: 1, timestamp: T0 }, { dataIndex: 2, timestamp: T0 + DAY })) === "1 bar · 1 day" && M.dateLabel(future) === "10 bars");
  ok("Price range shows only the price line", JSON.stringify(M.measureLabel("price", up)) === JSON.stringify(["+10.00 (+10.00%)"]));
  ok("Date range shows only the span line", JSON.stringify(M.measureLabel("date", up)) === JSON.stringify(["18 bars · 25 days"]));
  ok("Measure shows both, price first", JSON.stringify(M.measureLabel("both", up)) === JSON.stringify(["+10.00 (+10.00%)", "18 bars · 25 days"]));
  ok("the three tools, Measure first (the default)", M.MEASURE_TOOLS.map((t) => t.key).join(",") === "both,price,date" && M.MEASURE_TOOLS[0].overlay === "mshMeasure");

  // 4. Wiring in the chart.
  ok("the overlays are registered with klinecharts (custom overlays) and draw from lib/measure",
    /registerMeasureOverlays\(kl\)/.test(chart) && /name: tool\.overlay,\s*totalStep: 3,/.test(chart) && /const stats = measureStats\(overlay\.points\[0\] \?\? \{\}, overlay\.points\[1\] \?\? \{\}\);/.test(chart));
  ok("the toolbar and the menu/sheet run the same startMeasure",
    /onClick=\{\(\) => startMeasure\(tool\.key\)\}/.test(chart) && /else if \(verb === "measure" && arg\) startMeasure\(arg as MeasureKind\);/.test(chart) && /measureTools: MEASURE_TOOLS\.map/.test(chart));
  ok("no Clear measures anywhere (one temporary measure at a time)", !/measure-clear|Clear measures|clearMeasures\(/.test(chart));
  ok("measures are not drawings: not in Undo, no selection hooks", !/overlayIdsRef\.current\.push\(id\);\s*measureIdsRef/.test(chart) && /setMeasure\(\{ id, drawn: false \}\);/.test(chart) && !/name: tool\.overlay,\s*\.\.\.overlayHooks/.test(chart));
  ok("once placed, a measure is locked (no select, no drag)", /overrideOverlay\(\{ id: placed, lock: true \}\)/.test(chart));
  ok("the next press on the chart only clears a placed measure (capture phase, swallowed)",
    /if \(!measureRef\.current\?\.drawn \|\| onOwnControl\(e\.target\)\) return false;\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*clearMeasure\(\);/.test(chart) &&
    /wrap\.addEventListener\("touchstart", touchDown, opts\);/.test(chart) && /wrap\.addEventListener\("mousemove", eat, true\);/.test(chart) && /wrap\.addEventListener\("mouseup", eatEnd, true\);/.test(chart));
  ok("Esc clears the measure", /if \(e\.key === "Escape" && \(measureRef\.current \|\| quickRef\.current\)\) \{ clearMeasure\(\); clearQuick\(\); return; \}/.test(chart));
  ok("Shift + drag runs in the capture phase, before the library pans", /wrap\.addEventListener\("mousedown", down, true\);/.test(chart) && /if \(!e\.shiftKey\) \{ clearQuick\(\); return; \}/.test(chart));
  ok("touch: panning pauses while placing and comes back once placed",
    /if \(coarse \|\| isMobile\) \{\s*try \{ chart\.setScrollEnabled\(false\); \}/.test(chart) && /setMeasure\(\{ id: placed, drawn: true \}\);[\s\S]{0,300}setScrollEnabled\(true\)/.test(chart));
  ok("the hint takes no clicks (a tap on it clears like anywhere else)", /data-measure-hint style=\{\{[^}]*pointerEvents: "none"/.test(chart));
  ok("Delete removes the selected drawing; its pill is a 44px target", /if \(e\.key !== "Delete" && e\.key !== "Backspace"\) return;/.test(chart) && /data-overlay-delete onClick=\{deleteSelected\} style=\{\{ minHeight: 44/.test(chart));
  return fails;
}

const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
const chart = readCodeOnly(CHART);

const base = await suite(await loadSibling(MODULE, src), chart);
if (base.length) {
  console.error("FAIL check-measure-tools:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["the % base is the END point (swapped)", () => [mut("base", src, "(dPrice / Math.abs(a.value)) * 100", "(dPrice / Math.abs(b.value as number)) * 100"), chart]],
  ["bars counted the wrong way", () => [mut("bars", src, "Math.round(b.dataIndex) - Math.round(a.dataIndex)", "Math.round(a.dataIndex) - Math.round(b.dataIndex)"), chart]],
  ["days counted in bars", () => [mut("days", src, "Math.round((b.timestamp - a.timestamp) / DAY_MS)", "(num(a.dataIndex) && num(b.dataIndex) ? b.dataIndex - a.dataIndex : 0)"), chart]],
  ["a fall is coloured green", () => [mut("up", src, "up: dPrice === null || dPrice >= 0", "up: true"), chart]],
  ["Price range also shows the span", () => [mut("kind", src, 'kind === "price" ? [priceLabel(s, pricePrecision)]', 'kind === "price" ? [priceLabel(s, pricePrecision), dateLabel(s)]'), chart]],
  ["no plural handling", () => [mut("plural", src, "abs === 1 ? one : many", "many"), chart]],
  ["Shift + drag in the bubble phase (the library pans first)", () => [src, mut("capture", chart, 'wrap.addEventListener("mousedown", down, true);', 'wrap.addEventListener("mousedown", down);')]],
  ["the clearing press also reaches the chart (pans or places)", () => [src, mut("swallow", chart, "if (!measureRef.current?.drawn || onOwnControl(e.target)) return false;\n      e.preventDefault();\n      e.stopPropagation();", "if (!measureRef.current?.drawn || onOwnControl(e.target)) return false;")]],
  ["a placed measure stays draggable", () => [src, mut("lock", chart, "overrideOverlay({ id: placed, lock: true })", "overrideOverlay({ id: placed })")]],
  ["Esc does nothing", () => [src, mut("esc", chart, 'if (e.key === "Escape" && (measureRef.current || quickRef.current)) { clearMeasure(); clearQuick(); return; }', "")]],
  ["touch keeps panning while placing", () => [src, chart.replace(/if \(coarse \|\| isMobile\) \{\s*try \{ chart\.setScrollEnabled\(false\); \} catch \{[^}]*\}/, "if (coarse || isMobile) {")]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, c] = make();
  let fails;
  try { fails = await suite(await loadSibling(MODULE, s), c); } catch { fails = ["threw"]; }
  if (!fails.length) { survived++; console.error(`MUTANT SURVIVED: ${label}`); }
}
if (survived) process.exit(1);
console.log(`check-measure-tools: % from the start point, bars/days, labels and the wiring hold; ${MUTANTS.length} mutants caught`);
