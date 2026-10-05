// THE PRICE LEVELS TAP NOTES, TAPPED IN A REAL BROWSER (#563 COWORK #103).
//
// Live bug: tapping MA200, MA50, Macro support or Last price in the Price
// levels ladder showed nothing. A's ReasonedValue note is position: fixed, and
// each ladder label carried transform: translateY(-50%), which makes the label
// the containing block for fixed children: the note was laid out in a ~22 px
// column off the card. The labels are now centred without a transform.
//
// Runs the shipped LevelsSignals (and everything it imports, transpiled as-is)
// with React's browser build, hydrated, in a stock-page-like column. At 390 and
// 1280 px it taps every ladder label (and RSI / MACD) and asserts the note is
// visible, at least 200 px wide, fully inside the viewport, and within 80 px of
// the label tapped; that each label's dotted underline clears the figure line
// below it; and that no leader line crosses a label's text. A MUTANT re-adds
// the transform to the labels and must fail.
//
//   node scripts/measure-level-notes.mjs
//
// NOT IN check-all: it needs Chromium and Playwright (installed globally in the sandbox).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import ts from "typescript";

const ROOT = process.cwd();
const ENTRY = "app/stock/[symbol]/LevelsSignals.tsx";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const file = (p) => { try { return fs.statSync(path.join(ROOT, p)).isFile(); } catch { return false; } };
const resolveFrom = (from, spec) => {
  const base = spec.startsWith("@/") ? spec.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(file) ?? null;
};

/** A tiny bundle: every app module LevelsSignals reaches, as CommonJS, keyed by repo path. */
function bundle(entry, override = {}) {
  const out = {};
  const visit = (rel) => {
    if (out[rel]) return;
    const src = override[rel] ?? read(rel);
    let js = ts.transpileModule(src, { fileName: rel, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react", esModuleInterop: true } }).outputText;
    out[rel] = "";
    js = js.replace(/require\("([^"]+)"\)/g, (m, spec) => {
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        const hit = resolveFrom(rel, spec);
        if (!hit) throw new Error(`${rel}: cannot resolve ${spec}`);
        visit(hit);
        return `require(${JSON.stringify(hit)})`;
      }
      return m;
    });
    out[rel] = js;
  };
  visit(entry);
  return out;
}
const REACT = {
  react: read("node_modules/react/cjs/react.development.js"),
  "react/jsx-runtime": read("node_modules/react/cjs/react-jsx-runtime.development.js"),
  "react-dom": read("node_modules/react-dom/cjs/react-dom.development.js"),
  "react-dom/client": read("node_modules/react-dom/cjs/react-dom-client.development.js"),
  scheduler: read("node_modules/scheduler/cjs/scheduler.development.js"),
};

// Weekday bars to Fri 2 Oct 2026; MA50, MA200 and a macro zone below the price.
function fixture() {
  const bars = [];
  for (let t = Date.parse("2025-06-02T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const c = 300 + 40 * Math.sin(i / 40) + i * 0.12;
    bars.push({ date: d.toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c });
    i++;
  }
  const closes = bars.map((b) => b.close), avg = (n) => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
  const last = closes[closes.length - 1];
  return { last, ma50: avg(50), ma200: avg(200), zone: { lower: last * 0.86, upper: last * 0.89 }, rsi: 58, macdTone: "green", macdBars: bars, asOf: "2026-10-02" };
}

function page(mods, props) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>/* the live site's Tailwind preflight (app/globals.css @import "tailwindcss") */*,::before,::after{box-sizing:border-box}:root{--fs-read:1rem;--lh-read:1.65;--fs-label:.8125rem;--fs-fine:.75rem}body{margin:0;background:#06080d;color:#f1f5f9;font-family:system-ui,sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding:24px 20px;box-sizing:border-box}.card{border:1px solid rgba(148,163,184,.25);border-radius:20px;padding:18px;min-width:0}
.lsGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.cols{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px}@media(max-width:900px){.lsGrid,.cols{grid-template-columns:minmax(0,1fr)}}</style></head>
<body><div class="wrap"><div class="cols"><section class="card"><div id="root"></div></section><aside></aside></div></div>
<script>
window.process = { env: { NODE_ENV: "development" } };
const SOURCES = ${JSON.stringify(mods)};
const cache = {};
function require(name) {
  if (cache[name]) return cache[name].exports;
  if (!(name in SOURCES)) throw new Error("no module " + name);
  const module = { exports: {} };
  cache[name] = module;
  new Function("module", "exports", "require", "process", SOURCES[name])(module, module.exports, require, window.process);
  return module.exports;
}
const React = require("react");
const LevelsSignals = require(${JSON.stringify(ENTRY)}).default;
require("react-dom/client").createRoot(document.getElementById("root")).render(React.createElement(LevelsSignals, ${JSON.stringify(props)}));
</script></body></html>`;
}

const globalRoot = (() => { try { return createRequire(import.meta.url).resolve("playwright"); } catch { return "/opt/node22/lib/node_modules/playwright/index.js"; } })();
const { chromium } = createRequire(globalRoot)("playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "level-notes-"));

/** Every tap target's result at one width: [{ name, ok, why }]. */
async function tapAll(html, width) {
  const f = path.join(tmp, `p-${width}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(f, html);
  const phone = width < 700;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: phone, isMobile: phone });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`file://${f}`);
  await p.waitForSelector(".lsLabel [role=button]");
  const names = await p.$$eval(".lsLadder .lsLabel [role=button], .lsGrid [role=button]", (els) => els.map((e, i) => ({ i, name: e.textContent.trim() })));
  const out = [];
  for (const { i, name } of names) {
    const btn = (await p.$$(".lsLadder .lsLabel [role=button], .lsGrid [role=button]"))[i];
    await btn.scrollIntoViewIfNeeded();
    if (phone) await btn.tap(); else await btn.click();
    await p.waitForTimeout(60);
    const r = await p.evaluate((k) => {
      const b = document.querySelectorAll(".lsLadder .lsLabel [role=button], .lsGrid [role=button]")[k];
      const tip = document.querySelector("[role=tooltip]");
      if (!tip) return { why: "no note mounted" };
      const t = tip.getBoundingClientRect(), a = b.getBoundingClientRect();
      const cs = getComputedStyle(tip);
      const gap = Math.max(0, a.top - t.bottom, t.top - a.bottom);
      const why = [];
      if (cs.visibility === "hidden" || cs.display === "none" || t.width === 0 || t.height === 0) why.push("not visible");
      if (t.width < 200) why.push(`only ${Math.round(t.width)} px wide`);
      if (t.left < -0.5 || t.top < -0.5 || t.right > innerWidth + 0.5 || t.bottom > innerHeight + 0.5) why.push(`outside the viewport (${Math.round(t.left)},${Math.round(t.top)} ${Math.round(t.width)}×${Math.round(t.height)})`);
      if (gap > 80) why.push(`${Math.round(gap)} px from the label`);
      return { why: why.join("; ") };
    }, i);
    out.push({ name, ok: !r.why, why: r.why });
    await p.keyboard.press("Escape");
    await p.mouse.click(2, 2);
    await p.waitForTimeout(30);
  }
  // Each label's dotted underline clears the figure line below it, and no leader crosses label text.
  const layout = await p.evaluate(() => {
    const bad = [];
    for (const lab of document.querySelectorAll(".lsLadder .lsLabel")) {
      const u = lab.querySelector("[role=button]")?.getBoundingClientRect(), v = lab.querySelector(".lsValue")?.getBoundingClientRect();
      if (u && v && v.top - u.bottom < 1.5) bad.push(`${lab.dataset.key}: the underline touches its figure (${(v.top - u.bottom).toFixed(1)} px)`);
      const texts = [...lab.querySelectorAll("span")].map((s) => s.getBoundingClientRect());
      // The leader as a segment (the SVG has no viewBox, so its coordinates are CSS px), against each text box.
      const hits = (x1, y1, x2, y2, t) => {
        for (let k = 0; k <= 40; k++) {
          const x = x1 + ((x2 - x1) * k) / 40, y = y1 + ((y2 - y1) * k) / 40;
          if (x > t.left + 1 && x < t.right - 1 && y > t.top + 1 && y < t.bottom - 1) return true;
        }
        return false;
      };
      for (const line of document.querySelectorAll(".lsLeaders line")) {
        const S = line.ownerSVGElement.getBoundingClientRect(), n = (a) => Number(line.getAttribute(a));
        const [x1, y1, x2, y2] = [S.left + n("x1"), S.top + n("y1"), S.left + n("x2"), S.top + n("y2")];
        for (const t of texts) if (hits(x1, y1, x2, y2, t)) { bad.push(`${lab.dataset.key}: a leader (${line.closest("svg").getAttribute("class")} #${[...line.parentNode.children].indexOf(line)}) crosses its text "${lab.textContent.slice(0, 30)}"`); break; }
      }
    }
    return [...new Set(bad)];
  });
  await ctx.close();
  return { taps: out, layout, errors };
}

let failures = 0;
const props = fixture();
const real = page({ ...REACT, ...bundle(ENTRY) }, props);
for (const width of [390, 1280]) {
  const { taps, layout, errors } = await tapAll(real, width);
  console.log(`\n${width}px`);
  for (const t of taps) { console.log(`  ${t.ok ? "PASS" : "FAIL"}  tap "${t.name}"${t.ok ? "" : ` — ${t.why}`}`); if (!t.ok) failures++; }
  for (const l of layout) { console.log(`  FAIL  ${l}`); failures++; }
  if (!layout.length) console.log("  PASS  every underline clears its figure; no leader crosses label text");
  for (const e of errors) { console.log(`  FAIL  page error: ${e}`); failures++; }
  if (taps.filter((t) => /MA50|MA200|Macro|Last/i.test(t.name)).length < 4) { console.log("  FAIL  fewer than four ladder labels to tap"); failures++; }
}
// THE MUTANT: the transform back on the labels must break the ladder's notes.
{
  const src = read(ENTRY).replace('position: "absolute", top: m.labelY, height: 0,', 'position: "absolute", top: m.labelY, height: 0, transform: "translateY(0)",');
  if (src === read(ENTRY)) { console.log("\n  FAIL  mutant: the transform could not be re-added"); failures++; }
  else {
    const { taps } = await tapAll(page({ ...REACT, ...bundle(ENTRY, { [ENTRY]: src }) }, props), 1280);
    const caught = taps.some((t) => /MA50|MA200|Macro|Last/i.test(t.name) && !t.ok);
    console.log(`\n  ${caught ? "PASS" : "FAIL"}  mutant (a transform back on the labels) ${caught ? "is caught" : "was MISSED"}`);
    if (!caught) failures++;
  }
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
