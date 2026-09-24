// /dashboard's wide-chart toggle (Relay B, #553 COWORK #27). Layout only.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE CHART STRETCHES INSTEAD OF RE-MEASURING. The Basic chart is an SVG
//      at width 100% over a fixed 760-unit viewBox; given a wider box without
//      a wider viewBox it scales up -- ~45% taller, oversized type. It must
//      widen its viewBox and keep its height.
//   2. THE ARITHMETIC DRIFTS FROM THE CSS: wideViewWidth assumes the grid's
//      360px column and 16px gap; if the CSS changes and it does not, the
//      chart's height jumps on toggle.
//   3. A STALE X SCALE: PriceChart memoises its x scale; without `width` in
//      its deps the plot keeps the old width's positions.
//   4. THE OTHER ENGINES STAY AT THE OLD WIDTH: no resize nudge on toggle.
//   5. THE WRONG LAYOUT: cards not below the chart, not side by side, or the
//      button shown on narrow single-column widths; no aria-pressed.
//   6. STORAGE THAT THROWS breaks the page (private windows).
//
// The layout itself is also tested RENDERED, on the preview, by
// scripts/preview-screenshots.mjs page=dashboard (a GitHub runner; the agent
// sandbox cannot reach *.vercel.app). This check runs the pure module and the
// wiring, then again on mutants; each must be caught.
//
//   node scripts/check-dashboard-wide.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MODULE = "lib/dashboardWide.ts";

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-dwide-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

// The rendered height of the Basic SVG: viewBox height scaled by box / viewBox width.
const renderedHeight = (boxWidth, viewWidth, viewHeight = 430) => (viewHeight * boxWidth) / viewWidth;

async function suite(W, code) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  // 1. Re-measure keeps the chart's height, at several desktop widths.
  for (const grid of [1000, 1248, 1408, 1600]) {
    const normalBox = grid - W.DASH_CARD_COLUMN_PX - W.DASH_GRID_GAP_PX - 2 * W.DASH_CHART_PAD_PX;
    const wideBox = grid - 2 * W.DASH_CHART_PAD_PX;
    const hNormal = renderedHeight(normalBox, W.BASIC_VIEW_WIDTH);
    const hWide = renderedHeight(wideBox, W.wideViewWidth(grid));
    ok(`at a ${grid}px grid the wide chart keeps its height (${hNormal.toFixed(0)}px)`, Math.abs(hWide - hNormal) / hNormal < 0.01, `${hWide.toFixed(0)} vs ${hNormal.toFixed(0)}`);
    ok(`at a ${grid}px grid the viewBox widens`, W.wideViewWidth(grid) > W.BASIC_VIEW_WIDTH);
  }
  ok("too narrow for two columns: the drawing width stays 760", W.wideViewWidth(560) === 760 && W.wideViewWidth(NaN) === 760);

  // 2. The constants are the CSS's.
  ok("the grid CSS is 360px + 1fr with a 16px gap, as wideViewWidth assumes",
    code.dash.includes(`.msh-grid{display:grid;grid-template-columns:${W.DASH_CARD_COLUMN_PX}px 1fr;gap:${W.DASH_GRID_GAP_PX}px;`));

  // 6. Storage.
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  ok("a throwing storage reads as normal and writes silently", W.readWideChoice(throwing) === false && (() => { W.writeWideChoice(throwing, true); return true; })());
  ok("no storage reads as normal", W.readWideChoice(null) === false && W.readWideChoice(undefined) === false);
  ok("the dashboard reads storage only through browserStorage (the property read can throw)",
    !/window\.localStorage/.test(code.dash) && /readWideChoice\(browserStorage\(\)\)/.test(code.dash) && /writeWideChoice\(browserStorage\(\), !w\)/.test(code.dash));
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  W.writeWideChoice(store, true);
  ok("the choice round-trips", W.readWideChoice(store) === true && mem.get(W.WIDE_CHART_KEY) === "1");

  // 3-5. Wiring.
  ok("PriceChart draws at the given width", /const width = viewWidth && viewWidth > 0 \? viewWidth : 760;/.test(code.price));
  ok("PriceChart's x scale recomputes when the width changes", /\}, \[series\.length, width\]\);/.test(code.price));
  ok("the dashboard passes the re-measured width to the inline Basic chart",
    /viewWidth=\{full \? undefined : basicViewWidth\}/.test(code.dash) && /const basicViewWidth = wideChart && !isMobile \? wideViewWidth\(deskGridWidth\) : undefined;/.test(code.dash));
  ok("the grid is measured by a ResizeObserver", /new ResizeObserver\(measure\)/.test(code.dash) && /ref=\{deskGridRef\}/.test(code.dash));
  ok("the other engines are nudged to re-measure on toggle", /window\.dispatchEvent\(new Event\("resize"\)\)\);\s*return \(\) => window\.cancelAnimationFrame\(id\);\s*\}, \[wideChart\]\);/.test(code.dash));
  ok("wide mode: the chart first, then the two cards in their own two-column row",
    /<div className="msh-col msh-wide-chart"><ChartPanel \/><\/div>\s*<div className="msh-wide-cards"><OverviewPanel \/><BreakdownPanel \/><\/div>/.test(code.dash) &&
      code.dash.includes(".msh-grid-wide{grid-template-columns:1fr;}") && code.dash.includes(".msh-wide-cards{display:grid;grid-template-columns:1fr 1fr;"));
  ok("the button says what it does and is a toggle", /aria-pressed=\{wideChart\}/.test(code.dash) && code.dash.includes(`"Back to two columns"`) && code.dash.includes(`"Widen chart"`));
  ok("the button is hidden where the layout is single-column", code.dash.includes("@media(max-width:960px){.msh-widebtn{display:none!important;}"));
  // 7. The icon and target (#553 COWORK #35).
  const leftward = (d) => /^M(\d+) 10H(\d+)/.exec(d);
  const rightward = (d) => /^M(\d+) 10h(\d+)/.exec(d);
  ok("normal layout: a LEFT arrow (extend the chart)", !!leftward(W.WIDE_ARROW_LEFT) && Number(leftward(W.WIDE_ARROW_LEFT)[1]) > Number(leftward(W.WIDE_ARROW_LEFT)[2]) && /l-5 5 5 5$/.test(W.WIDE_ARROW_LEFT));
  ok("wide mode: a RIGHT arrow (back to two columns)", !!rightward(W.WIDE_ARROW_RIGHT) && /l5 5-5 5$/.test(W.WIDE_ARROW_RIGHT));
  ok("the button draws LEFT when normal and RIGHT when wide", /<path d=\{wideChart \? WIDE_ARROW_RIGHT : WIDE_ARROW_LEFT\} \/>/.test(code.dash));
  const btn = /function WideChartButton\(\)[\s\S]*?\n  \}\n/.exec(code.dash)?.[0] ?? "";
  const px = (re) => Number(re.exec(btn)?.[1] ?? 0);
  ok("the click target is at least 32x32", px(/width: (\d+), height: \d+/) >= 32 && px(/width: \d+, height: (\d+)/) >= 32);
  ok("the icon is 18-20px and bold", px(/<svg width="(\d+)"/) >= 18 && px(/<svg width="(\d+)"/) <= 20 && Number(/strokeWidth="([\d.]+)"/.exec(btn)?.[1] ?? 0) >= 2.2);
  ok("tooltip and label stay", /title=\{label\} aria-label=\{label\} aria-pressed=\{wideChart\}/.test(btn));
  ok("the button is not on the plot (the Basic pan arrows are)", /<WideChartButton \/><div style=\{\{ fontSize: 11/.test(code.dash));
  return fails;
}

const src = read(MODULE);
const code = { dash: readCodeOnly("app/components/DashboardClient.tsx"), price: readCodeOnly("app/components/PriceChart.tsx") };

const base = await suite(await loadSibling(MODULE, src), code);
if (base.length) {
  console.error("FAIL check-dashboard-wide:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["the re-measure skipped (the Basic chart just stretches)", () => [src, { ...code, dash: mut("remeasure", code.dash, "viewWidth={full ? undefined : basicViewWidth}", "") }]],
  ["the viewBox widened by the wrong ratio (no card column)", () => [mut("ratio", src, "const normal = gridWidth - DASH_CARD_COLUMN_PX - DASH_GRID_GAP_PX - 2 * DASH_CHART_PAD_PX;", "const normal = gridWidth - 2 * DASH_CHART_PAD_PX - 1;"), code]],
  ["the x scale not recomputed on width", () => [src, { ...code, price: mut("deps", code.price, "}, [series.length, width]);", "}, [series.length]);") }]],
  ["no resize nudge on toggle", () => [src, { ...code, dash: mut("nudge", code.dash, `window.dispatchEvent(new Event("resize"))`, "void 0") }]],
  ["cards not side by side", () => [src, { ...code, dash: mut("side", code.dash, ".msh-wide-cards{display:grid;grid-template-columns:1fr 1fr;", ".msh-wide-cards{display:grid;grid-template-columns:1fr;") }]],
  ["a throwing storage breaks the page", () => [mut("storage", src, `    return storage?.getItem(WIDE_CHART_KEY) === "1";
  } catch {
    return false;
  }`, `    return storage?.getItem(WIDE_CHART_KEY) === "1";
  } finally {
    // no catch
  }`), code]],
  ["storage read outside the try", () => [src, { ...code, dash: mut("inline", code.dash, "readWideChoice(browserStorage())", "readWideChoice(window.localStorage)") }]],
  ["arrows swapped (right arrow to extend)", () => [src, { ...code, dash: mut("swap", code.dash, "wideChart ? WIDE_ARROW_RIGHT : WIDE_ARROW_LEFT", "wideChart ? WIDE_ARROW_LEFT : WIDE_ARROW_RIGHT") }]],
  ["left arrow drawn pointing right", () => [mut("dir", src, `WIDE_ARROW_LEFT = "M16 10H4M9 5l-5 5 5 5"`, `WIDE_ARROW_LEFT = "M4 10h12M11 5l5 5-5 5"`), code]],
  ["the small 30px button back", () => [src, { ...code, dash: mut("size", code.dash, `justifyContent: "center", width: 34, height: 34, flex`, `justifyContent: "center", width: 30, height: 30, flex`) }]],
  ["a thin 16px icon back", () => [src, { ...code, dash: mut("icon", code.dash, `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6"`, `<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"`) }]],
  ["button shown on narrow widths", () => [src, { ...code, dash: mut("narrow", code.dash, "@media(max-width:960px){.msh-widebtn{display:none!important;}", "@media(max-width:960px){") }]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, c] = make();
  let fails;
  try {
    fails = await suite(await loadSibling(MODULE, s), c);
  } catch {
    fails = ["threw"];
  }
  if (!fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-dashboard-wide: height kept at 4 widths, layout, wiring and the arrow button hold; ${MUTANTS.length} mutants caught`);
