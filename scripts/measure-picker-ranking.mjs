// THE CHARTS PREVIEW BUTTON AND THE "RANKED BY" LINE IN A REAL BROWSER (#553 COWORK #161).
//
// Runs the shipped PickerResultsGrid (and every module it imports), transpiled
// as-is, in Chromium with React's browser build and the site's globals.css, on
// a fixture of 40 rows with the page's ranking set ("EPS growth, highest
// first"). At 320-430 px the controls dock to the bottom bar; at 1280 px they
// sit above the table. It checks:
//   - the preview button: label "View as charts" with its hint on desktop,
//     thumbnail + "Charts" in the docked bar with no hint; a 44 px target;
//     aria-pressed flips and the label reads "View as table" after a click;
//   - the thumbnail is aria-hidden;
//   - "Ranked by EPS growth, highest first" shows while unsorted; after a
//     column sort (desktop header click, or the phone Sort list) it reads
//     "Back to growth ranking", and pressing it restores the fixture order;
//   - the hint and the ranking line compute at --fs-label (13px) or larger;
//   - no sideways scroll at any width.
// Writes picker-ranking-390.png and picker-ranking-1280.png to SHOTS.
//
//   node scripts/measure-picker-ranking.mjs     # widths 320 360 390 414 430 1280
//
// NOT IN check-all: it needs Chromium and Playwright. check-picker-ranking
// holds the static rules and mutants.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import ts from "typescript";

const ROOT = process.cwd();
const SHOTS = path.resolve(process.env.SHOTS || "/tmp");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const cjs = (src, fileName) => ts.transpileModule(src, {
  fileName,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react", esModuleInterop: true },
}).outputText;

const FILTER_CONTEXT = "app/components/PickerFilterContext.tsx";
const STUBS = {
  "next/link": `const React = require("react");
module.exports = { __esModule: true, default: function Link(p) { const { href, prefetch, scroll, replace, ...rest } = p; return React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }); } };`,
  "next/navigation": `module.exports = { usePathname: () => "/oversold-stocks-today", useSearchParams: () => new URLSearchParams(""), useRouter: () => ({ push() {}, replace() {}, prefetch() {}, back() {}, refresh() {} }) };`,
  [FILTER_CONTEXT]: `const React = require("react");
const state = { predicates: [], selectedFilters: [], selectedSectors: [], conditionCounts: null, matchCount: null, isPristine: true,
  toggleFilter() {}, toggleSector() {}, clearFilters() {}, setPredicate() {}, removePredicate() {}, setMatchCount() {}, setConditionCounts() {} };
module.exports = { __esModule: true, usePickerFilter: () => state, PickerFilterProvider: ({ children }) => children, PickerFilterUrlSync: () => null };`,
};
const REACT = {
  react: read("node_modules/react/cjs/react.development.js"),
  "react/jsx-runtime": read("node_modules/react/cjs/react-jsx-runtime.development.js"),
  "react-dom": read("node_modules/react-dom/cjs/react-dom.development.js"),
  "react-dom/client": read("node_modules/react-dom/cjs/react-dom-client.development.js"),
  scheduler: read("node_modules/scheduler/cjs/scheduler.development.js"),
};
function resolveFile(spec, from) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"]) {
    const f = base + ext;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  throw new Error(`cannot resolve ${spec} from ${from}`);
}
const MODULES = { ...REACT, ...STUBS };
function addModule(file) {
  const id = path.relative(ROOT, file);
  if (id in MODULES) return id;
  MODULES[id] = "";
  const src = fs.readFileSync(file, "utf8");
  let out = cjs(src, path.basename(file).replace(/\.m?js$/, ".ts"));
  out = out.replace(/require\("([^"]+)"\)/g, (m, spec) => {
    if (spec in REACT || spec in STUBS) return m;
    const target = resolveFile(spec, file);
    if (!target) throw new Error(`no stub for ${spec} (from ${id})`);
    return `require(${JSON.stringify(addModule(target))})`;
  });
  MODULES[id] = out;
  return id;
}
const GRID = addModule(path.join(ROOT, "app/components/PickerResultsGrid.tsx"));
const globalsCss = read("app/globals.css").replace(/@import[^;]+;/g, "");

// 40 rows in a fixed "ranked" order; their day change runs the other way so a
// sort by % Change visibly reorders them.
const pts = (seed) => Array.from({ length: 30 }, (_, i) => {
  const c = 50 + Math.sin((i + seed) / 3) * 4 + i * 0.1;
  return { time: 1720000000 + i * 86400, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 1e6 };
});
const entries = Array.from({ length: 40 }, (_, i) => ({
  symbol: "T" + String(i + 1).padStart(2, "0"), companyName: "Fixture Company " + (i + 1), note: "fixture", tone: "green",
  stockHref: "#", chartHref: "#", chartPoints: pts(i), price: 50 + i, changePct: -2 + i * 0.1, volume: 1e6 + i, score: 40 - i,
}));

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${globalsCss} *,*::before,*::after{box-sizing:border-box} body{margin:0;background:#06080d;color:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif} #root{max-width:1200px;margin:0 auto;padding:14px 10px}
.viewToggle { display: inline-flex; align-items: center; gap: 6px; padding: 9px 15px; border-radius: 999px; border: 1px solid rgba(96,165,250,0.4); background: rgba(59,130,246,0.10); color: #dbeafe; font-weight: 800; font-size: 12.5px; cursor: pointer; white-space: nowrap; flex: 0 0 auto; }</style></head>
<body><div id="root"></div>
<script>
window.process = { env: { NODE_ENV: "development" } };
const SOURCES = ${JSON.stringify(MODULES)};
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
const Grid = require(${JSON.stringify(GRID)}).default;
require("react-dom/client").createRoot(document.getElementById("root")).render(
  React.createElement(Grid, { entries: ${JSON.stringify(entries)}, configHref: "/stocks-with-strong-earnings-growth", configTitle: "Fixture",
    tone: "green", emptyText: "none", isEarnings: false, ranking: { label: "EPS growth, highest first", short: "growth" } })
);
</script></body></html>`;

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(globalRoot, "noop.js"))("playwright");
const browser = await chromium.launch();
const file = path.join(SHOTS, "picker-ranking.html");
fs.writeFileSync(file, page);

let bad = 0;
const say = (ok, label, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) bad++; };
const order = (p) => p.evaluate(() => [...document.querySelectorAll("tbody tr, .mRow")].map((r) => (r.textContent.match(/T\d\d/) || [""])[0]).filter(Boolean).slice(0, 5).join(","));

for (const width of (process.env.WIDTHS || "320,360,390,414,430,1280").split(",").map(Number)) {
  const phone = width <= 980;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`file://${file}`);
  await p.waitForSelector(".viewPreview", { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(150);
  console.log(`\n=== ${width} px ===`);
  const b = await p.evaluate(() => {
    const btn = document.querySelector(".viewPreview");
    if (!btn) return null;
    const vis = (sel) => { const el = btn.querySelector(sel); return !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0; };
    const thumb = btn.querySelector(".viewThumb");
    const hint = btn.querySelector(".viewToggleHint");
    const line = document.querySelector(".rankLine");
    return {
      h: btn.getBoundingClientRect().height, name: btn.getAttribute("aria-label"), pressed: btn.getAttribute("aria-pressed"),
      long: vis(".viewLabelLong"), short: vis(".viewLabelShort"), hint: vis(".viewToggleHint"), thumbHidden: thumb?.getAttribute("aria-hidden"),
      thumbW: thumb?.getBoundingClientRect().width ?? 0, hintPx: hint ? parseFloat(getComputedStyle(hint).fontSize) : 0,
      line: line?.textContent ?? null, linePx: line ? parseFloat(getComputedStyle(line).fontSize) : 0,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    };
  });
  if (!b) { say(false, "the preview button rendered", errors[0] ?? ""); await ctx.close(); continue; }
  say(b.h >= 44, "the button is a 44 px target", `${b.h.toFixed(1)} px`);
  say(b.name === "View results as charts" && b.pressed === "false", "named for what it does, not pressed in the list view", `${b.name} / ${b.pressed}`);
  say(b.thumbHidden === "true" && b.thumbW > 0, "the thumbnail shows and is aria-hidden", `${b.thumbW.toFixed(0)} px`);
  if (phone) say(b.short && !b.long && !b.hint, "docked bar: thumbnail plus one word, no hint");
  else say(b.long && b.hint && !b.short && b.hintPx >= 13, "desktop: bold label and hint, hint at --fs-label or larger", `${b.hintPx}px`);
  say(b.line === "Ranked by EPS growth, highest first" && b.linePx >= 13, "the ranking is named while unsorted", `${b.line} at ${b.linePx}px`);
  say(b.sw <= b.cw, "no sideways scroll", `${b.sw} vs ${b.cw}`);
  const before = await order(p);
  if (phone) {
    await p.selectOption(".mSortWrap select", "price:desc");
  } else {
    await p.click("th:has-text('% Change'), th:has-text('Change')");
  }
  await p.waitForTimeout(100);
  const sorted = await order(p);
  const back = await p.evaluate(() => document.querySelector(".rankLine")?.textContent ?? null);
  const phoneOpt = phone ? await p.evaluate(() => document.querySelector(".mSortWrap select option")?.textContent ?? null) : null;
  say(sorted !== before && /Back to growth ranking/.test(back ?? ""), "after a sort the line offers the way back", `${back}`);
  if (phone) say(phoneOpt === "Back to growth ranking", "the phone Sort list offers it too", `${phoneOpt}`);
  if (phone) await p.selectOption(".mSortWrap select", "__ranking"); else await p.click(".rankBack");
  await p.waitForTimeout(100);
  const restored = await order(p);
  say(restored === before, "pressing it restores the page's ranking", `${restored} vs ${before}`);
  if (width === 390 || width === 1280) await p.screenshot({ path: path.join(SHOTS, `picker-ranking-${width}.png`), fullPage: false });
  await p.click(".viewPreview");
  await p.waitForTimeout(150);
  const after = await p.evaluate(() => { const btn = document.querySelector(".viewPreview"); return { name: btn?.getAttribute("aria-label"), pressed: btn?.getAttribute("aria-pressed"), text: btn?.textContent }; });
  say(after.name === "View results as table" && after.pressed === "true" && (phone ? /Table/.test(after.text) : /View as table/.test(after.text)), "in chart view it flips to the table", `${after.name} / ${after.pressed}`);
  const sw2 = await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  say(sw2, "no sideways scroll in chart view either");
  if (width === 390 || width === 1280) await p.screenshot({ path: path.join(SHOTS, `picker-ranking-${width}-charts.png`), fullPage: false });
  say(errors.length === 0, "no page errors", errors[0] ?? "");
  await ctx.close();
}
await browser.close();
console.log(bad ? `\nFAILED (${bad})` : "\nALL MEASURES PASSED");
process.exit(bad ? 1 : 0);
