// THE EARNINGS SNAPSHOT CARD'S CHART IN CHROMIUM (#563 COWORK #123 §3).
//
// Renders the card (app/components/LatestEarningsCard.tsx, server markup, as
// the page ships it) for the fact-set fixtures, profitable and loss-making, in
// the stock page's 300 px sidebar and full width at 320–430 px, at a 16 px and
// a 20 px root, plus an INTC-like large-loss card. It fails when a chart label
// overlaps another label, a bar or a margin dot; when a label leaves the
// chart; when the chart does not reach the card's inner edges; or when the
// page scrolls sideways. With an output directory it saves 1280 and 390 px
// screenshots.
//
// NOT IN check-all: it needs a browser.
//
//   node scripts/snapshot-chart-measure.mjs [shots-dir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadSnapshot, html, React } from "./lib/render-snapshot.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const SYMBOLS = ["AAPL", "TSLA", "KTOS", "GEV", "AZN", "BYND", "WKHS", "NBIS"];
const M = await loadSnapshot();
const cards = SYMBOLS.flatMap((sym) => {
  const set = JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${sym}.json`, "utf8"));
  const view = M.buildSecEarningsView(set);
  const score = M.scoreFromSec(view, sym, { status: "ready", set, cold: false });
  const snapshot = M.buildSecEarningsSnapshot({ symbol: sym, view, score, reported: null, nextReport: { kind: "none" } });
  return snapshot.annualChart && !snapshot.annualChart.reason ? [[sym, html(React.createElement(M.default, { snapshot, symbol: sym }))]] : [];
});
// AN INTC-LIKE LARGE LOSS (#563 COWORK #126/#127): the margin scale reaches higher for its -35% low,
// so its top label (13%, at its own line) sits close above the "0%" label.
{
  const set = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
  const view = M.buildSecEarningsView(set);
  const score = M.scoreFromSec(view, "AAPL", { status: "ready", set, cold: false });
  const base = M.buildSecEarningsSnapshot({ symbol: "AAPL", view, score, reported: null, nextReport: { kind: "none" } });
  const yr = (label, revenue, netIncome, netMargin) => ({ label, short: `'${label.slice(4)}`, revenue, revenueText: null, revenueGap: null, netIncome, netIncomeText: null, profitGap: null, netMargin, oneOff: null, derivedNotes: [] });
  const snapshot = { ...base, annualChart: { reason: null, years: [yr("FY2022", 63.05e9, 8.01e9, 12.7), yr("FY2023", 54.23e9, 1.69e9, 3.1), yr("FY2024", 53.1e9, -18.76e9, -35.3), yr("FY2025", 52.9e9, -0.27e9, -0.5)] } };
  cards.push(["INTC-like", html(React.createElement(M.default, { snapshot, symbol: "AAPL" }))]);
}

const CSS = fs.readFileSync("app/globals.css", "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
const doc = (root) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style><style>
*,::before,::after{box-sizing:border-box}html{font-size:${root}px}body{margin:0;background:#06080d;color:#f1f5f9;font-family:system-ui,sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding:0 16px}.side{display:flex;flex-direction:column;gap:16px;width:300px}@media (max-width:900px){.side{width:auto}}
</style></head><body><div class="wrap"><aside class="side">${cards.map(([sym, h]) => `<div class="probe" data-sym="${sym}">${h}</div>`).join("")}</aside></div></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-chart-"));
const shots = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
for (const root of [16, 20]) {
  const f = path.join(tmp, `p${root}.html`); fs.writeFileSync(f, doc(root));
  for (const width of [320, 360, 390, 414, 430, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`file://${f}`);
    const r = await page.evaluate(() => ({
      scrolls: document.documentElement.scrollWidth > innerWidth,
      probes: [...document.querySelectorAll(".probe")].map((p) => {
        const bad = [], chart = p.querySelector("[data-snapshot-chart]"), svg = chart?.querySelector("svg");
        if (!svg) return { sym: p.dataset.sym, bad: ["no chart"] };
        const card = p.querySelector("section").getBoundingClientRect(), pad = parseFloat(getComputedStyle(p.querySelector("section")).paddingLeft);
        const S = svg.getBoundingClientRect();
        if (S.left > card.left + pad + 1 || S.right < card.right - pad - 1) bad.push(`chart narrower than the card (${Math.round(S.width)} of ${Math.round(card.width - 2 * pad)} px)`);
        const texts = [...svg.querySelectorAll("text")].map((t) => ({ t: t.textContent, b: t.getBoundingClientRect() }));
        const marks = [...svg.querySelectorAll("rect, circle")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0);
        const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        texts.forEach((x, i) => {
          if (x.b.left < S.left - 1 || x.b.right > S.right + 1) bad.push(`label leaves the chart: ${x.t}`);
          texts.slice(i + 1).forEach((y) => { if (hit(x.b, y.b)) bad.push(`labels collide: ${x.t} / ${y.t}`); });
          if (marks.some((m) => hit(x.b, m))) bad.push(`label on a bar or dot: ${x.t}`);
        });
        return { sym: p.dataset.sym, bad: [...new Set(bad)] };
      }),
    }));
    const ok = !r.scrolls && r.probes.every((p) => !p.bad.length);
    if (!ok) failures++;
    console.log(`${width}px @ ${root}px root: ${ok ? "OK" : "FAIL"} (${r.probes.length} charts)${r.scrolls ? " · SCROLLS SIDEWAYS" : ""}`);
    for (const p of r.probes) if (p.bad.length) console.log(`    ${p.sym}: ${p.bad.join("; ")}`);
    if (shots && root === 16 && (width === 1280 || width === 390)) {
      for (const [i, [sym]] of cards.entries()) await page.locator(".probe section").nth(i).screenshot({ path: path.join(shots, `snapshot-${width}-${sym}.png`) });
    }
    await page.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
