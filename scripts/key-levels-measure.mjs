// THE KEY LEVELS CARD AT PHONE AND DESKTOP WIDTH, MEASURED IN CHROMIUM
// (#563 COWORK #64). A rendered layout, not an argument about CSS.
//
// Renders C's card (app/stock/[symbol]/KeyLevelsCard.tsx; range bars, #66/#67)
// for prices of three widths: about $250, about $25,000 (the widest a pooled
// stock shows) and under $1 (four decimals), plus a day whose open, high and
// last price are one price, so the open tick and the price dot sit on top of
// each other. Each sits where the stock page puts it: below 900 px the sidebar
// is full width inside the page's 20 px gutter; above, a 300 px sidebar. At
// 320, 360, 390, 414, 430 and 1280 px it reports whether the page scrolls
// sideways, whether a row's low–high label collides with its title or leaves
// the card, whether every tick and dot is inside its track with both still
// visible where they meet (the tick's ends showing above and below the dot),
// and the card's height. With an output path, it also saves a 360 px screenshot.
//
// NOT IN check-all: it needs a browser, and the suite must run without one
// (the same rule as growth-visuals-measure.mjs).
//
//   node scripts/key-levels-measure.mjs [screenshot.png]
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
const unit = `${reasonedValueUnit()}\n${strip(fs.readFileSync("lib/ta/keyLevels.ts", "utf8"))}\n${strip(fs.readFileSync("lib/ta/keyLevelBars.ts", "utf8"))}\n${strip(fs.readFileSync("app/stock/[symbol]/KeyLevelsCard.tsx", "utf8")).replace("export default function KeyLevelsCard", "export function KeyLevelsCard")}\n`;
const tmp = `scripts/.key-levels-measure-${process.pid}.mjs`;
fs.writeFileSync(tmp, ts.transpileModule(unit, { fileName: "k.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText);
let M;
try { M = await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }

// Weekdays 1 Jul – 2 Oct 2026 (Labor Day closed), scaled to a price level.
function bars(scale) {
  const out = [];
  for (let t = Date.parse("2026-07-01T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t), date = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || date === "2026-09-07") continue;
    const open = (100 + i * 1.5 + (i % 4) * 0.3) * scale;
    out.push({ date, open, high: open + 2.4 * scale, low: open - 1.3 * scale, close: open + 0.4 * scale });
    i++;
  }
  return out;
}
/** The last day opens at its high and the last price is that same open. */
function overlap() {
  const b = bars(1.2), last = b[b.length - 1];
  b[b.length - 1] = { ...last, high: last.open, close: last.open - 0.5, low: last.open - 2 };
  return b;
}
const credit = React.createElement("a", { href: "#" }, "Market data from Tiingo.com");
const cards = [
  ["~$250", { bars: bars(1.2), lastPrice: 250.37, credit }],
  ["~$25,000", { bars: bars(120), lastPrice: 25012.5, credit }],
  ["under $1", { bars: bars(0.004), lastPrice: 0.7012, credit }],
  ["open = high = last", { bars: overlap(), lastPrice: overlap().at(-1).open, credit }],
].map(([name, props]) => `<div class="probe" data-name="${name}">${renderToStaticMarkup(React.createElement(M.KeyLevelsCard, props))}</div>`).join("");
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
      const card = p.querySelector(".klCard"), c = card.getBoundingClientRect();
      const bad = [];
      for (const row of p.querySelectorAll(".klRow")) {
        const range = row.querySelector(".klRange"), title = row.firstElementChild?.firstElementChild;
        if (range && title) {
          const a = title.getBoundingClientRect(), b = range.getBoundingClientRect();
          if (b.left < a.right + 4 || b.right > c.right - 12 || Math.abs(b.top - a.top) > 6) bad.push(`label ${range.textContent}`);
        }
        const track = row.querySelector(".klTrack");
        if (!track) continue;
        const t = track.getBoundingClientRect();
        const dot = row.querySelector(".klDot").getBoundingClientRect(), tick = row.querySelector(".klOpen")?.getBoundingClientRect();
        if (dot.left < c.left || dot.right > c.right) bad.push("dot off the card");
        if (tick && (tick.left < t.left - 1 || tick.right > t.right + 1)) bad.push("tick off its track");
        // Both visible where they meet: the tick's ends stick out above and below the dot.
        if (tick && !(tick.top < dot.top - 2 && tick.bottom > dot.bottom + 2)) bad.push("tick hidden by the dot");
      }
      return { name: p.dataset.name, cardW: Math.round(c.width), cardH: Math.round(c.height), inView: c.right <= innerWidth + 0.5, bad };
    }),
  }));
  const ok = !r.pageScrolls && r.probes.every((p) => p.inView && p.bad.length === 0);
  if (!ok) failures++;
  console.log(`${width}px: page scrolls sideways ${r.pageScrolls} · ${r.probes.map((p) => `${p.name}: card ${p.cardW}×${p.cardH}px${p.bad.length ? ` ${JSON.stringify(p.bad)}` : ""}`).join(" · ")} — ${ok ? "OK" : "FAIL"}`);
  if (shot && width === 360) await page.screenshot({ path: shot, fullPage: true });
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
