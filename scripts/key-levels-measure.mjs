// THE KEY LEVELS POLE IN CHROMIUM (#563 COWORK #115, "E1, true scale").
//
// Renders C's card (app/stock/[symbol]/KeyLevelsCard.tsx), hydrated, for the
// fixtures #115 lists: a normal day, a Monday (the Week skipped), the first
// session of a month (the Month skipped), a flat day, a gap from the previous
// close, a crowded cluster of levels within 0.3%, and a thin stock whose levels
// are one price (BRBI's flat run); and /markets/spx (#563 COWORK #118), the same
// card in that page's own two-column levels row, on S&P 500 ETF bars whose Week
// (from Mon 28 Sep) differs from the Day, so the full set shows. At 320, 360, 390, 414, 430 and 1280 px, at a
// 16 px and a 20 px root, it fails when the page scrolls sideways, when a label
// overlaps another, when any label leaves the card, or when a name or price is
// cut, or when a label runs out of the pole or over the key and fine print under it. With an output directory it saves 1280 and 390 px screenshots.
//
// NOT IN check-all: it needs a browser, and the suite must run without one.
//
//   node scripts/key-levels-measure.mjs [shots-dir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

// HYDRATED: the card measures its own labels after mount (their height sets the
// gap), so it runs as React does in the browser. A tiny CommonJS bundle of every
// app module the card reaches, as scripts/measure-level-notes.mjs builds one.
const ENTRY = "app/stock/[symbol]/KeyLevelsCard.tsx";
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


// ── fixtures: weekdays from 3 Aug 2026 to `end`, a gentle wave; `tweak` edits the last bars ──
function bars(end, tweak = (b) => b, base = 230) {
  const out = [];
  for (let t = Date.parse("2026-08-03T00:00:00Z"), i = 0; t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const c = base * (1 + 0.03 * Math.sin(i / 5) + i * 0.0008);
    out.push({ date: d.toISOString().slice(0, 10), open: c * 0.997, high: c * 1.008, low: c * 0.992, close: c });
    i++;
  }
  return tweak(out);
}
const lastOf = (b) => b[b.length - 1].close;
const flatEnd = (b) => { const l = b[b.length - 1]; b[b.length - 1] = { ...l, open: l.close, high: l.close, low: l.close }; return b; };
const gapEnd = (b) => { const p = b[b.length - 2].close, l = b[b.length - 1]; b[b.length - 1] = { ...l, open: p * 1.06, high: p * 1.075, low: p * 1.05, close: p * 1.07 }; return b; };
const crowd = (b) => { const n = b.length; for (let i = n - 4; i < n; i++) { const c = 250; b[i] = { ...b[i], open: c * (1 + (i - n) * 0.0004), high: c * 1.0012, low: c * 0.9985, close: c * (1 + (i - n + 2) * 0.0003) }; } return b; };
const flatRun = (b) => b.map((x, i) => (i >= b.length - 12 ? { ...x, open: 11.24, high: 11.24, low: 11.24, close: 11.24 } : x));
const FIX = [
  ["normal day", bars("2026-10-08")],
  ["Monday (Week skipped)", bars("2026-10-05")],
  ["first of the month (Month skipped)", bars("2026-10-01")],
  ["flat day", bars("2026-10-08", flatEnd)],
  ["gap from the previous close", bars("2026-10-08", gapEnd)],
  ["crowded (6 levels within 0.3%)", bars("2026-10-08", crowd)],
  ["thin stock, one-price levels", bars("2026-10-08", flatRun, 13)],
  ["/markets/spx (Week from 28 Sep, the close on Fri 2 Oct)", bars("2026-10-02", (b) => b, 740)],
].map(([name, b]) => [name, { bars: b, lastPrice: lastOf(b), credit: "Market data from Tiingo.com" }]);
const SPX = FIX.length - 1;

const CSS = fs.readFileSync("app/globals.css", "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
const docAt = (root) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style><style>
*,::before,::after{box-sizing:border-box}html{font-size:${root}px}body{margin:0;background:#06080d;color:#f1f5f9;font-family:system-ui,sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding:0 20px}.side{display:flex;flex-direction:column;gap:16px;width:300px}@media (max-width:900px){.side{width:auto}}
.spxWrap{max-width:1080px;margin:24px auto 0;padding:24px}.spxLevels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
@media (max-width:900px){.spxLevels{grid-template-columns:minmax(0,1fr)}}@media (max-width:640px){.spxWrap{padding:16px}}
</style></head><body><div class="wrap"><aside class="side">${FIX.slice(0, SPX).map(([n], i) => `<div class="probe" data-name="${n}" id="p${i}"></div>`).join("")}</aside></div>
<div class="spxWrap"><div class="spxLevels"><div class="zones" style="min-height:4rem"></div><div style="display:grid;gap:6px;min-width:0"><div class="probe" data-name="${FIX[SPX][0]}" id="p${SPX}"></div></div></div></div>
<script>
window.process = { env: { NODE_ENV: "development" } };
const SOURCES = ${JSON.stringify(MODS).replace(/<\/script/g, "<\\/script")};
const cache = {};
function require(name) { if (cache[name]) return cache[name].exports; if (!(name in SOURCES)) throw new Error("no module " + name); const module = { exports: {} }; cache[name] = module; new Function("module", "exports", "require", "process", SOURCES[name])(module, module.exports, require, window.process); return module.exports; }
const React = require("react"), Card = require(${JSON.stringify(ENTRY)}).default, client = require("react-dom/client");
${JSON.stringify(FIX.map(([, p]) => p))}.forEach((props, i) => client.createRoot(document.getElementById("p" + i)).render(React.createElement(Card, props)));
</script></body></html>`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "key-levels-measure-"));
const shots = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
for (const root of [16, 20]) {
  const f = path.join(tmpDir, `p${root}.html`); fs.writeFileSync(f, docAt(root));
  for (const width of [320, 360, 390, 414, 430, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`file://${f}`); await page.waitForSelector(".probe .klCard"); await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({
      scrolls: document.documentElement.scrollWidth > innerWidth,
      probes: [...document.querySelectorAll(".probe")].map((p) => {
        const card = p.querySelector(".klCard").getBoundingClientRect(), bad = [];
        const labels = [...p.querySelectorAll(".klLabel")].map((l) => ({ l, parts: [...l.querySelectorAll(".klName, .klValue, .klPill")].filter((e) => e.textContent.trim()).map((e) => { const range = document.createRange(); range.selectNodeContents(e); return range.getBoundingClientRect(); }) }));
        labels.forEach(({ l, parts }) => parts.forEach((b) => { if (b.left < card.left + 4 || b.right > card.right - 4) bad.push(`outside the card: ${l.textContent.trim().slice(0, 30)}`); }));
        for (const e of p.querySelectorAll(".klName, .klValue, .klPill")) if (e.scrollWidth > e.clientWidth + 0.5) bad.push(`cut: ${e.textContent.trim().slice(0, 30)}`);
        // Every label inside the pole's own box, and clear of the key and the fine print under it.
        const poleBox = p.querySelector(".klPole").getBoundingClientRect();
        const below = [...p.querySelectorAll(".klKey, .klCredit")].map((e) => e.getBoundingClientRect());
        labels.forEach(({ l, parts }) => parts.forEach((b) => {
          if (b.bottom > poleBox.bottom + 1 || b.top < poleBox.top - 1) bad.push(`out of the pole: ${l.textContent.trim().slice(0, 30)}`);
          if (below.some((k) => b.bottom > k.top + 1 && b.top < k.bottom - 1 && b.right > k.left && b.left < k.right)) bad.push(`over the fine print: ${l.textContent.trim().slice(0, 30)}`);
        }));
        const boxes = labels.flatMap(({ l, parts }) => parts.map((b) => ({ t: l.textContent.trim().slice(0, 24), b })));
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach((c) => { if (a.t !== c.t && a.b.right > c.b.left + 1 && c.b.right > a.b.left + 1 && a.b.bottom > c.b.top + 1 && c.b.bottom > a.b.top + 1) bad.push(`overlap: ${a.t} / ${c.t}`); }));
        return { name: p.dataset.name, labels: labels.length, h: Math.round(card.height), bad: [...new Set(bad)] };
      }),
    }));
    const ok = !r.scrolls && !errors.length && r.probes.every((p) => !p.bad.length && p.labels > 1);
    if (!ok) failures++;
    console.log(`${width}px @ ${root}px root: ${ok ? "OK" : "FAIL"}${r.scrolls ? " · SCROLLS SIDEWAYS" : ""}${errors.length ? ` · errors ${errors.join(" ")}` : ""}`);
    for (const p of r.probes) if (p.bad.length || p.labels < 2) console.log(`    ${p.name} (${p.labels} labels): ${p.bad.join("; ") || "too few labels"}`);
    if (shots && (width === 1280 || width === 390)) await page.screenshot({ path: path.join(shots, `key-levels-${width}-${root}.png`), fullPage: true });
    await page.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
