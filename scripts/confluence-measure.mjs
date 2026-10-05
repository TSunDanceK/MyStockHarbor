// THE PRICE ZONES CARD AT PHONE AND DESKTOP WIDTH, MEASURED IN CHROMIUM
// (#563 COWORK #83/#84). A rendered layout, not an argument about CSS.
//
// Renders C's card (app/stock/[symbol]/ConfluenceCard.tsx) for several price
// shapes: a rising stock, a falling one, about $25,000 (the widest labels), under
// $1, and a flat range, each where the stock page puts it: below 900 px full
// width inside the page's 20 px gutter; above, the 300 px sidebar. At 320, 360,
// 390, 414, 430 and 1280 px it reports whether the page scrolls sideways,
// whether any zone label or the price label leaves the card or overlaps
// another, whether every band and the dot sit inside the ladder, and the card's
// height. With an output path, it also saves a 390 px screenshot.
//
// NOT IN check-all: it needs a browser, and the suite must run without one.
//
//   node scripts/confluence-measure.mjs [screenshot.png]
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
const files = ["lib/ta/sessionBar.ts", "lib/ta/keyLevels.ts", "lib/ta/macdSeries.ts", "lib/ta/priceLadder.ts", "lib/ta/fairValueGaps.ts", "lib/ta/confluence.ts"];
const unit = `${reasonedValueUnit()}\nimport { useCallback, useLayoutEffect } from "react";\n${strip(fs.readFileSync("app/stock/[symbol]/TapNote.tsx", "utf8"))}\n${files.map((f) => { const src = strip(fs.readFileSync(f, "utf8")); return f.endsWith("fairValueGaps.ts") ? src.replace(/\bisPrice\b/g, "fvgIsPrice") : src; }).join("\n")}\n${strip(fs.readFileSync("app/stock/[symbol]/ConfluenceCard.tsx", "utf8")).replace("export default function ConfluenceCard", "export function ConfluenceCard")}\n`;
const tmp = `scripts/.confluence-measure-${process.pid}.mjs`;
fs.writeFileSync(tmp, ts.transpileModule(unit, { fileName: "c.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText);
let M;
try { M = await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }

/** Weekdays to Fri 2 Oct 2026, a wave around a drift, scaled. */
function bars(scale, drift = 0.1, from = "2025-06-02") {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t), date = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const b = (200 + 30 * Math.sin(i / 17) + 15 * Math.sin(i / 5.3) + i * drift) * scale;
    out.push({ date, open: b, high: b + 3 * scale, low: b - 2.5 * scale, close: b + 0.8 * scale });
    i++;
  }
  return out;
}
const sma = (b, n) => b.slice(-n).reduce((s, x) => s + x.close, 0) / n;
const probe = (b) => ({ bars: b, ma50: sma(b, 50), ma200: sma(b, 200), macro: null, credit: React.createElement("a", { href: "#" }, "Market data from Tiingo.com") });
const flat = bars(1).map((x, i, a) => (i === a.length - 1 ? { ...x, open: x.close, high: x.close, low: x.close } : x));
const cards = [
  ["rising", probe(bars(1))],
  ["falling", probe(bars(1, -0.12))],
  ["~$25,000", probe(bars(110))],
  ["under $1", probe(bars(0.004))],
  ["flat day", probe(flat)],
].map(([name, props]) => `<div class="probe" data-name="${name}">${renderToStaticMarkup(React.createElement(M.ConfluenceCard, props))}</div>`).join("");
const doc = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;background:#06080d;color:#e2e8f0;font-family:system-ui,sans-serif}
.stock-wrap{max-width:1240px;margin:0 auto;padding:0 20px;box-sizing:border-box}
.side{display:flex;flex-direction:column;gap:16px;width:300px}
@media (max-width:900px){.side{width:auto}}
</style></head><body><div class="stock-wrap"><aside class="side">${cards}</aside></div></body></html>`;

const shot = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
for (const width of [320, 360, 390, 414, 430, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(doc);
  const r = await page.evaluate(() => ({
    pageScrolls: document.documentElement.scrollWidth > innerWidth,
    probes: [...document.querySelectorAll(".probe")].map((p) => {
      const card = p.querySelector(".czCard"), c = card.getBoundingClientRect();
      const bad = [];
      const lad = p.querySelector(".czLadder");
      const zones = p.querySelectorAll(".czBand").length;
      if (lad) {
        const L = lad.getBoundingClientRect();
        const labels = [...p.querySelectorAll(".czLabel")].map((e) => e.getBoundingClientRect());
        for (const e of [...p.querySelectorAll(".czLabel > div, .czPrice > div")]) {
          if (e.scrollWidth > e.clientWidth + 0.5) bad.push(`text cut: ${e.textContent}`);
          const b = e.getBoundingClientRect();
          if (b.left < c.left + 10 || b.right > c.right - 10) bad.push(`off the card: ${e.textContent}`);
        }
        for (const e of p.querySelectorAll(".czRange")) {
          const range = document.createRange(); range.selectNodeContents(e);
          if (range.getBoundingClientRect().right > c.right - 10) bad.push(`range off the card: ${e.textContent}`);
        }
        labels.forEach((a, i) => labels.slice(i + 1).forEach((b) => { if (a.bottom > b.top + 1 && b.bottom > a.top + 1) bad.push("labels overlap"); }));
        for (const e of p.querySelectorAll(".czBand, .czDot")) {
          const b = e.getBoundingClientRect();
          if (b.top < L.top - 6.5 || b.bottom > L.bottom + 6.5) bad.push(`${e.className} off the ladder`);
        }
        const dot = p.querySelector(".czDot").getBoundingClientRect(), price = p.querySelector(".czPrice").getBoundingClientRect();
        if (price.right > dot.left) bad.push("price label under the dot");
      }
      return { name: p.dataset.name, zones, cardW: Math.round(c.width), cardH: Math.round(c.height), inView: c.right <= innerWidth + 0.5, bad };
    }),
  }));
  const ok = !r.pageScrolls && r.probes.every((p) => p.inView && p.bad.length === 0 && p.zones > 0);
  if (!ok) failures++;
  console.log(`${width}px: page scrolls sideways ${r.pageScrolls} · ${r.probes.map((p) => `${p.name}: ${p.zones} zones, card ${p.cardW}×${p.cardH}px${p.bad.length ? ` ${JSON.stringify([...new Set(p.bad)])}` : ""}`).join(" · ")} — ${ok ? "OK" : "FAIL"}`);
  if (shot && width === 390) await page.screenshot({ path: shot, fullPage: true });
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
