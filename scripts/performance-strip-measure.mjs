// THE PERFORMANCE STRIP AT PHONE AND DESKTOP WIDTH, MEASURED IN CHROMIUM
// (#563 COWORK #69): six chips in one row on desktop, 3×2 at 320–430 px, no
// sideways scroll, no chip's text overflowing it. Two shapes: a five-year
// series (every chip filled) and a short listing (3Y and 5Y "—"). With an
// output path it saves a 360 px screenshot.
//
// NOT IN check-all: it needs a browser (the same rule as key-levels-measure.mjs).
//
//   node scripts/performance-strip-measure.mjs [screenshot.png]
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
const unit = `${reasonedValueUnit()}\n${strip(fs.readFileSync("lib/ta/keyLevels.ts", "utf8"))}\n${strip(fs.readFileSync("lib/ta/performance.ts", "utf8"))}\n${strip(fs.readFileSync("app/stock/[symbol]/PerformanceStrip.tsx", "utf8")).replace("export default function PerformanceStrip", "export function PerformanceStrip")}\n`;
const tmp = `scripts/.performance-strip-measure-${process.pid}.mjs`;
fs.writeFileSync(tmp, ts.transpileModule(unit, { fileName: "p.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText);
let M;
try { M = await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }

function bars(from, f) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push({ date: d.toISOString().slice(0, 10), close: f(i++) });
  }
  return out;
}
// A volatile five-year series with a recent fall, so both arrows show; and SPY.
const stock = bars("2021-03-01", (i) => 2400 + 900 * Math.sin(i / 90) + i * 1.3 - (i > 1380 ? (i - 1380) * 40 : 0));
const spy = bars("2021-03-01", (i) => 400 + i * 0.12);
const credit = React.createElement("a", { href: "#" }, "Market data from Tiingo.com");
const shapes = [["five years", M.performanceStrip(stock, spy)], ["listed Mar 2024", M.performanceStrip(stock.filter((b) => b.date >= "2024-03-01"), spy)]];
const html = shapes.map(([n, s]) => `<div class="probe" data-name="${n}" style="margin-bottom:24px">${renderToStaticMarkup(React.createElement(M.PerformanceStrip, { strip: s, credit }))}</div>`).join("");
const doc = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#06080d;color:#e2e8f0;font-family:system-ui,sans-serif}.stock-wrap{max-width:1240px;margin:0 auto;padding:0 20px;box-sizing:border-box}</style></head><body><div class="stock-wrap">${html}</div></body></html>`;

const shot = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
for (const width of [320, 360, 390, 414, 430, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.setContent(doc);
  const r = await page.evaluate(() => ({
    scrolls: document.documentElement.scrollWidth > innerWidth,
    probes: [...document.querySelectorAll(".probe")].map((p) => {
      const chips = [...p.querySelectorAll(".perfChip")];
      const rows = new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size;
      const over = chips.filter((c) => [...c.querySelectorAll("*")].some((e) => e.getBoundingClientRect().right > c.getBoundingClientRect().right + 0.5)).map((c) => c.dataset.key);
      return { name: p.dataset.name, rows, over, h: Math.round(p.getBoundingClientRect().height) };
    }),
  }));
  const ok = !r.scrolls && r.probes.every((p) => p.over.length === 0 && p.rows === (width <= 640 ? 2 : 1));
  if (!ok) failures++;
  console.log(`${width}px: scrolls ${r.scrolls} · ${r.probes.map((p) => `${p.name}: ${p.rows} row(s), ${p.h}px${p.over.length ? ` overflow ${JSON.stringify(p.over)}` : ""}`).join(" · ")} — ${ok ? "OK" : "FAIL"}`);
  if (shot && width === 360) await page.screenshot({ path: shot, fullPage: true });
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
