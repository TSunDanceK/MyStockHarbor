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
// Since #563 COWORK #109: hydrated with React's browser build (the card measures
// its labels after mount), with app/globals.css's tokens, at the default 16 px
// root and again at 20 px (a large-text browser setting).
//
// NOT IN check-all: it needs a browser, and the suite must run without one.
//
//   node scripts/confluence-measure.mjs [screenshot.png]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

// HYDRATED, NOT STATIC (#563 COWORK #109): the card measures its own labels after
// mount (their height sets the stacking gap), so it runs as React does in the
// browser. A tiny CommonJS bundle of every app module the card reaches, as
// scripts/measure-level-notes.mjs builds one.
const ENTRY = "app/stock/[symbol]/ConfluenceCard.tsx";
const read = (p) => fs.readFileSync(p, "utf8");
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const resolveFrom = (from, spec) => {
  const base = spec.startsWith("@/") ? spec.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(isFile) ?? null;
};
function bundle(entry) {
  const out = {};
  const visit = (rel) => {
    if (out[rel] !== undefined) return;
    out[rel] = "";
    let js = ts.transpileModule(read(rel), { fileName: rel, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react", esModuleInterop: true } }).outputText;
    js = js.replace(/require\("([^"]+)"\)/g, (m, spec) => {
      if (!spec.startsWith("@/") && !spec.startsWith(".")) return m;
      const hit = resolveFrom(rel, spec);
      if (!hit) throw new Error(`${rel}: cannot resolve ${spec}`);
      visit(hit);
      return `require(${JSON.stringify(hit)})`;
    });
    out[rel] = js;
  };
  visit(entry);
  return out;
}
const MODS = {
  ...bundle(ENTRY),
  react: read("node_modules/react/cjs/react.development.js"),
  "react/jsx-runtime": read("node_modules/react/cjs/react-jsx-runtime.development.js"),
  "react-dom": read("node_modules/react-dom/cjs/react-dom.development.js"),
  "react-dom/client": read("node_modules/react-dom/cjs/react-dom-client.development.js"),
  scheduler: read("node_modules/scheduler/cjs/scheduler.development.js"),
};

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
const probe = (b) => ({ bars: b, ma50: sma(b, 50), ma200: sma(b, 200), macro: null, credit: "Market data from Tiingo.com" });
const flat = bars(1).map((x, i, a) => (i === a.length - 1 ? { ...x, open: x.close, high: x.close, low: x.close } : x));
const cards = [
  ["rising", probe(bars(1))],
  ["falling", probe(bars(1, -0.12))],
  ["~$25,000", probe(bars(110))],
  ["under $1", probe(bars(0.004))],
  ["flat day", probe(flat)],
];
// THE SITE'S OWN TOKENS (#563 COWORK #100/#101/#109): without app/globals.css, var(--fs-label) is undefined
// and every label inherits 16px, which the live page never shows. Each width runs at a 16 px root and a 20 px one.
const CSS = fs.readFileSync("app/globals.css", "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
const ROOTS = process.env.ROOT_PX ? [Number(process.env.ROOT_PX)] : [16, 20];
const docAt = (ROOT_PX) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style><style>
*,::before,::after{box-sizing:border-box}html{font-size:${ROOT_PX}px}
body{margin:0;background:#06080d;color:#e2e8f0;font-family:system-ui,sans-serif}
.stock-wrap{max-width:1240px;margin:0 auto;padding:0 20px;box-sizing:border-box}
.side{display:flex;flex-direction:column;gap:16px;width:300px}
@media (max-width:900px){.side{width:auto}}
</style></head><body><div class="stock-wrap"><aside class="side">${cards.map(([name], i) => `<div class="probe" data-name="${name}" id="p${i}"></div>`).join("")}</aside></div>
<script>
window.process = { env: { NODE_ENV: "development" } };
const SOURCES = ${JSON.stringify(MODS).replace(/<\/script/g, "<\\/script")};
const cache = {};
function require(name) {
  if (cache[name]) return cache[name].exports;
  if (!(name in SOURCES)) throw new Error("no module " + name);
  const module = { exports: {} };
  cache[name] = module;
  new Function("module", "exports", "require", "process", SOURCES[name])(module, module.exports, require, window.process);
  return module.exports;
}
const React = require("react"), Card = require(${JSON.stringify(ENTRY)}).default, client = require("react-dom/client");
${JSON.stringify(cards.map(([, props]) => props))}.forEach((props, i) => client.createRoot(document.getElementById("p" + i)).render(React.createElement(Card, props)));
window.__rendered = true;
</script></body></html>`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "confluence-measure-"));
const htmlAt = Object.fromEntries(ROOTS.map((px) => { const f = path.join(tmpDir, `page-${px}.html`); fs.writeFileSync(f, docAt(px)); return [px, f]; }));

const shot = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
for (const root of ROOTS) for (const width of [320, 360, 390, 414, 430, 1280]) {
  const htmlFile = htmlAt[root];
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`file://${htmlFile}`);
  await page.waitForSelector(".probe .czCard");
  // After mount: the labels are measured and the gap settles (a layout effect, then a ResizeObserver tick).
  await page.waitForTimeout(250);
  if (errors.length) { console.log(`${width}px @ ${root}px root: page errors ${JSON.stringify(errors)}`); failures++; }
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
  console.log(`${width}px @ ${root}px root: page scrolls sideways ${r.pageScrolls} · ${r.probes.map((p) => `${p.name}: ${p.zones} zones, card ${p.cardW}×${p.cardH}px${p.bad.length ? ` ${JSON.stringify([...new Set(p.bad)])}` : ""}`).join(" · ")} — ${ok ? "OK" : "FAIL"}`);
  if (shot && width === 390 && root === ROOTS[0]) await page.screenshot({ path: shot, fullPage: true });
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
