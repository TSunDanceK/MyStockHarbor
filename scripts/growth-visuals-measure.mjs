// THE GROWTH & MARGINS PICTURE AT PHONE AND DESKTOP WIDTH, MEASURED IN CHROMIUM
// (#563 COWORK #56/#58). A rendered layout, not an argument about CSS: the
// one-off tag went missing in the owner's phone screenshot while the desktop
// page showed it.
//
// Renders A's earnings card for ONDS (data/sec/factset-fixture-ONDS.json) with
// the page's own <style> block, at 360 px and 1280 px, and reports for each:
// whether every one-off tag is inside the viewport and is the topmost element
// at its centre (not covered or clipped), which of the two margin layouts is
// showing, how much of each period's slot its bars fill (#60: about two
// thirds) with no bar crossing into the next slot, and the card's height.
//
// With ORCL=1 the same fact set is reshaped as a filer with no cost of sales
// line (#563 COWORK #71), so the margin chart and the phone line show operating
// margin; the same measures apply, and the chart note must not be clipped.
//
// NOT IN check-all: it needs a browser, and the suite must run without one
// (the same rule as layout-overlap-measure.mjs).
//
//   node scripts/growth-visuals-measure.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
import { loadCards, html, React } from "./lib/render-cards.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const PAGE = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
const open = PAGE.indexOf("<style>{`"), close = PAGE.indexOf("`}</style>", open);
const CSS = open >= 0 && close > open ? PAGE.slice(open + 9, close) : "";
const M = await loadCards();
const set = JSON.parse(fs.readFileSync("data/sec/factset-fixture-ONDS.json", "utf8"));
// ORCL=1 (#563 COWORK #71): ONDS reshaped as a filer with no cost of sales line
// and a positive operating margin, so the third chart is operating margin.
// LOSS=1: the same, keeping ONDS's own operating losses, so the operating
// margin chart's scale moves below zero (owner, 3 Oct).
if (process.env.LOSS) {
  const k = (f) => M.SEC_FIELD_KEYS.indexOf(f);
  for (const p of [...set.quarters, ...set.years]) { p.v[k("grossProfit")] = null; p.v[k("costOfRevenue")] = null; }
}
// MIXED=1 (#563 COWORK #72): no gross line, operating margin alternating +20% /
// −35% of sales and net +10% / −40%, the newest quarter negative: the scale
// below zero, red dots and line, "−" labels.
if (process.env.MIXED) {
  const k = (f) => M.SEC_FIELD_KEYS.indexOf(f);
  [...set.quarters, ...set.years].forEach((p, i) => {
    p.v[k("grossProfit")] = null; p.v[k("costOfRevenue")] = null;
    const rev = p.v[k("revenue")];
    if (typeof rev === "number") { p.v[k("operatingIncome")] = rev * (i % 2 ? 0.2 : -0.35); p.v[k("netIncome")] = rev * (i % 2 ? 0.1 : -0.4); }
  });
}
if (process.env.ORCL) {
  const k = (f) => M.SEC_FIELD_KEYS.indexOf(f);
  set.entityName = "ORACLE CORP";
  for (const p of [...set.quarters, ...set.years]) {
    p.v[k("grossProfit")] = null; p.v[k("costOfRevenue")] = null;
    // Oracle-like: operating 30% and net 22% of sales, so no quarter reads as a one-off.
    if (typeof p.v[k("revenue")] === "number") { p.v[k("operatingIncome")] = p.v[k("revenue")] * 0.3; p.v[k("netIncome")] = p.v[k("revenue")] * 0.22; }
  }
}
const view = M.buildSecEarningsView(set);
const card = html(React.createElement(M.SecGrowthMarginsCard, { view }));
const doc = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#06080d;color:#e2e8f0;font-family:system-ui,sans-serif}${CSS}</style></head><body><main style="padding:0 16px">${card}</main></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
for (const width of [360, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.setContent(doc);
  const r = await page.evaluate(() => {
    const tags = [...document.querySelectorAll(".gvOneOff")].map((t) => {
      const b = t.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.left), y: Math.round(b.top),
        inView: b.width > 0 && b.left >= 0 && b.right <= innerWidth, onTop: !!hit && t.contains(hit) };
    });
    const shown = (sel) => [...document.querySelectorAll(sel)].some((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0);
    const c = document.querySelector("section.card")?.getBoundingClientRect();
    // Bars per slot: the sales pair (.gvBars) and the profit bar, against their column.
    const fills = [...document.querySelectorAll(".gvCol")].flatMap((col) => {
      const w = col.getBoundingClientRect();
      return [...col.querySelectorAll(".gvBars, .gvPlBar")].map((b) => {
        const r = b.getBoundingClientRect();
        return { fill: r.width / w.width, inside: r.left >= w.left - 0.5 && r.right <= w.right + 0.5 };
      });
    });
    const fill = fills.length ? { min: Math.min(...fills.map((f) => f.fill)), max: Math.max(...fills.map((f) => f.fill)) } : null;
    // Every shown axis label whole: its text no wider than what is painted.
    const ticks = [...document.querySelectorAll(".gvTick")].filter((t) => getComputedStyle(t).visibility !== "hidden" && t.offsetParent);
    const clipped = ticks.filter((t) => t.scrollWidth > t.clientWidth + 0.5 && getComputedStyle(t).overflow === "hidden").map((t) => t.textContent);
    return { clipped, tags, phoneLine: shown(".gvPhoneOnly"), marginChart: shown(".gvDesktopOnly"), cardH: Math.round(c?.height ?? 0),
      fill, barsInside: fills.every((f) => f.inside), deskLine: shown(".gvDeskLine") };
  });
  // ORCL=1 has no one-off quarter, so no tag is expected there.
  const tagsOk = (process.env.ORCL || process.env.LOSS || process.env.MIXED ? true : r.tags.length > 0) && r.tags.every((t) => t.inView && t.onTop);
  const layoutOk = (width < 481 ? r.phoneLine && !r.marginChart : !r.phoneLine && r.marginChart && r.deskLine) &&
    !!r.fill && r.fill.min >= 0.6 && r.fill.max <= 0.7 && r.barsInside && r.clipped.length === 0;
  if (!tagsOk || !layoutOk) failures++;
  console.log(`${width}px: tags ${JSON.stringify(r.tags)} · margin line over sales ${r.phoneLine} · separate margin chart ${r.marginChart} · bars fill ${r.fill ? `${Math.round(r.fill.min * 100)}–${Math.round(r.fill.max * 100)}%` : "none"} of a slot, inside it ${r.barsInside} · clipped labels ${JSON.stringify(r.clipped)} · card ${r.cardH}px — ${tagsOk && layoutOk ? "OK" : "FAIL"}`);
  // SHOT=<prefix> also saves <prefix>-<width>.png, the screenshot a phone check asks for.
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-${width}.png`, fullPage: true });
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
