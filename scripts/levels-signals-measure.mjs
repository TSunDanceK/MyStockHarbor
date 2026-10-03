// THE "PRICE LEVELS & SIGNALS" SECTION AT PHONE AND DESKTOP WIDTH, MEASURED IN
// CHROMIUM (#563 COWORK #68). A rendered layout, not an argument about CSS.
//
// Renders C's LevelsSignals for three shapes: AAPL as Cowork saw it (MA50 and
// MA200 below the price, a zone further down), MA200 ABOVE the price with no
// zone (the zone omitted with its reason), and a crowded ladder (every level
// within ~3% of the price, so the labels must stack). Each sits in the stock
// page's main column (full width inside the 20 px gutter on a phone; ~880 px on
// desktop). At 320, 360, 390, 414, 430 and 1280 px it reports whether the page
// scrolls sideways, whether two ladder labels overlap or a label leaves the
// section, whether the gauges stack under the ladder on a phone, and the
// section's height. With an output path it saves a 360 px screenshot.
//
// NOT IN check-all: it needs a browser (the same rule as key-levels-measure.mjs).
//
//   node scripts/levels-signals-measure.mjs [screenshot.png]
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reasonedValueUnit } from "./lib/render-cards.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");
const unit = `${reasonedValueUnit()}\n${strip(fs.readFileSync("lib/ta/keyLevels.ts", "utf8"))}\n${strip(fs.readFileSync("lib/ta/priceLadder.ts", "utf8"))}\n${strip(fs.readFileSync("app/stock/[symbol]/LevelsSignals.tsx", "utf8")).replace("export default function LevelsSignals", "export function LevelsSignals")}\n`;
const tmp = `scripts/.levels-signals-measure-${process.pid}.mjs`;
fs.writeFileSync(tmp, ts.transpileModule(unit, { fileName: "l.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText);
let M;
try { M = await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }

const credit = React.createElement("a", { href: "#" }, "Market data from Tiingo.com");
const base = { zoneMissing: "No repeated weekly support zone found", asOf: "2026-10-02", credit };
const shapes = [
  ["AAPL", { last: 333.69, ma50: 322.42, ma200: 290.1, zone: { lower: 255.4, upper: 268.9, touches: 3, volumeRatio: 1.1 }, rsi: 54.7, macdTone: "red" }],
  ["MA200 above, no zone", { last: 100, ma50: 104, ma200: 120, zone: null, rsi: 31.2, macdTone: "green" }],
  ["crowded", { last: 24012.5, ma50: 24080.3, ma200: 23950.6, zone: { lower: 23700, upper: 24300, touches: 4, volumeRatio: null }, rsi: 71.4, macdTone: "yellow" }],
];
const html = shapes.map(([n, p]) => `<section class="probe" data-name="${n}" style="margin:0 0 24px">${renderToStaticMarkup(React.createElement(M.LevelsSignals, { ...base, ...p }))}</section>`).join("");
const doc = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;background:#06080d;color:#e2e8f0;font-family:system-ui,sans-serif}
.stock-wrap{max-width:1240px;margin:0 auto;padding:0 20px;box-sizing:border-box}
.main{margin-left:328px}
@media (max-width:900px){.main{margin-left:0}}
</style></head><body><div class="stock-wrap"><div class="main">${html}</div></div></body></html>`;

const shot = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
for (const width of [320, 360, 390, 414, 430, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(doc);
  const r = await page.evaluate(() => ({
    pageScrolls: document.documentElement.scrollWidth > innerWidth,
    probes: [...document.querySelectorAll(".probe")].map((p) => {
      const box = p.getBoundingClientRect();
      const labels = [...p.querySelectorAll(".lsLabel")].map((l) => ({ l, r: l.getBoundingClientRect(), words: l.querySelector(".lsWords") }));
      const bad = [];
      for (let i = 0; i < labels.length; i++) {
        const a = labels[i];
        if (a.r.right > box.right + 0.5 || a.r.left < box.left - 0.5) bad.push(`label off: ${a.l.dataset.key}`);
        if (a.words && a.words.scrollWidth > a.words.clientWidth + 0.5) bad.push(`label cut: ${a.l.dataset.key}`);
        for (let j = i + 1; j < labels.length; j++) {
          const b = labels[j];
          if (a.r.top < b.r.bottom - 1 && b.r.top < a.r.bottom - 1) bad.push(`overlap: ${a.l.dataset.key}/${b.l.dataset.key}`);
        }
      }
      const parts = [...p.querySelectorAll(".lsPart")].map((x) => x.getBoundingClientRect());
      const stacked = parts.length === 2 && parts[1].top >= parts[0].bottom - 1;
      return { name: p.dataset.name, h: Math.round(box.height), bad, stacked };
    }),
  }));
  const ok = !r.pageScrolls && r.probes.every((p) => p.bad.length === 0 && (width <= 640 ? p.stacked : !p.stacked));
  if (!ok) failures++;
  console.log(`${width}px: scrolls sideways ${r.pageScrolls} · ${r.probes.map((p) => `${p.name}: ${p.h}px, gauges ${p.stacked ? "stacked" : "beside"}${p.bad.length ? ` ${JSON.stringify(p.bad)}` : ""}`).join(" · ")} — ${ok ? "OK" : "FAIL"}`);
  if (shot && width === 360) await page.screenshot({ path: shot, fullPage: true });
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
