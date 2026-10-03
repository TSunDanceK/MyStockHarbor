// THE EARNINGS SNAPSHOT TILE AT PHONE WIDTH, MEASURED (#552 COWORK #134/#135).
//
// Renders the shipped tile (render-snapshot.mjs) for committed SEC fixtures,
// loads each in Chromium at each width inside a 16 px page gutter, and reports
// anything wider than the tile, plus any chart label painted outside it.
// Writes a 360 px screenshot per fixture to SHOTS (default /tmp).
//
//   node scripts/measure-snapshot-tile.mjs        # widths 320 360 375 430
//
// NOT IN check-all: it needs Chromium and Playwright (installed globally in
// the sandbox). check-snapshot-annual-chart holds the rules and mutants.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadSnapshot, html, React } from "./lib/render-snapshot.mjs";

const S = await loadSnapshot();
const SHOTS = path.resolve(process.env.SHOTS || "/tmp");
const fixture = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));
function bank() {
  const s = structuredClone(fixture("AAPL"));
  for (const k of ["grossProfit", "costOfRevenue"]) {
    const i = S.SEC_FIELD_KEYS.indexOf(k);
    if (i >= 0) for (const list of [s.quarters, s.years]) for (const p of list) p.v[i] = null;
  }
  return s;
}
const CASES = { AAPL: fixture("AAPL"), BYND: fixture("BYND"), AZN: fixture("AZN"), KGC: fixture("KGC"), AVAV: fixture("AVAV"), BANK: bank() };

function page(symbol, set) {
  const view = S.buildSecEarningsView(set);
  const score = S.scoreFromSec(view, symbol, { status: "ready", set, cold: false });
  const reported = view.latestFiled ? { on: view.latestFiled, via: "filing", timing: null } : null;
  const snapshot = S.buildSecEarningsSnapshot({ symbol, view, score, reported, nextReport: { kind: "none" } });
  const tile = html(React.createElement(S.default, { snapshot, symbol }));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#020617;color:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}</style></head>
<body><div id="col">${tile}</div></body></html>`;
}

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(globalRoot, "noop.js"))("playwright");
const browser = await chromium.launch();
let bad = 0;
for (const [sym, set] of Object.entries(CASES)) {
  const file = path.join(SHOTS, `snapshot-tile-${sym}.html`);
  fs.writeFileSync(file, page(sym, set));
  for (const width of (process.env.WIDTHS || "320,360,375,430").split(",").map(Number)) {
    const p = await browser.newPage({ viewport: { width, height: 1200 } });
    await p.goto(`file://${file}`);
    const found = await p.evaluate(() => {
      const out = [];
      const card = document.querySelector("#col > section");
      const c = card.getBoundingClientRect();
      if (card.scrollWidth > card.clientWidth + 1) out.push(`tile scrollWidth ${card.scrollWidth} > ${card.clientWidth}`);
      for (const el of card.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        if (r.right > c.right + 1 || r.left < c.left - 1) { out.push(`<${el.tagName.toLowerCase()}> ${Math.round(r.left)}–${Math.round(r.right)} outside tile ${Math.round(c.left)}–${Math.round(c.right)}`); break; }
      }
      // CHART LABELS MUST NOT CLIP: every <text> inside the chart's own box.
      const svg = card.querySelector("[data-snapshot-chart] svg");
      if (svg) {
        const b = svg.getBoundingClientRect();
        for (const t of svg.querySelectorAll("text")) {
          const r = t.getBoundingClientRect();
          if (r.left < c.left || r.right > c.right || r.top < b.top - 12 || r.bottom > b.bottom + 2) out.push(`chart label "${t.textContent}" clipped`);
        }
      }
      return { out, pageW: document.documentElement.scrollWidth, view: document.documentElement.clientWidth };
    });
    const wide = found.pageW > found.view + 1;
    console.log(`${sym} ${width}px: ${found.out.length ? `${found.out.length} problem(s)` : "fits"}${wide ? `; PAGE scrollWidth ${found.pageW} > ${found.view}` : ""}`);
    for (const l of found.out) console.log(`   ${l}`);
    bad += found.out.length + (wide ? 1 : 0);
    if (width === 360) await p.locator("#col > section").screenshot({ path: path.join(SHOTS, `snapshot-tile-${sym}-360.png`) });
    await p.close();
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
