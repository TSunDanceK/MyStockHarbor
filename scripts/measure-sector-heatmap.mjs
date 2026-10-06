// THE /sector HEAT MAP IN A REAL BROWSER (#553 COWORK #157 item 1).
//
// Runs the shipped SectorHeatMap and lib/sectorHeatmap.ts (transpiled as-is)
// in Chromium with the site's globals.css, on an 11-sector fixture with one
// falling sector and one with no figure. At 320-430 px and 1280 px it checks:
//   - 11 tiles, each a link with its name, return and company count;
//   - year to date is shown first; "1 month" and "Last close" swap every
//     tile's figure and shade, with aria-pressed following;
//   - the falling sector is red; text on every tile is white at >= 4.5:1;
//   - phones: a 2-column grid; desktop: a treemap with no overlapping tiles;
//   - no name clipped or broken mid-word; text at --fs-label or larger;
//   - no sideways scroll.
// Writes sector-heatmap-390.png and sector-heatmap-1280.png to SHOTS.
//
//   node scripts/measure-sector-heatmap.mjs     # widths 320 360 390 414 430 1280
//
// NOT IN check-all: it needs Chromium and Playwright. check-sector-heatmap
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
const MAP = addModule(path.join(ROOT, "app/sector/SectorHeatMap.tsx"));
const LIBID = addModule(path.join(ROOT, "lib/sectorHeatmap.ts"));
const globalsCss = read("app/globals.css").replace(/@import[^;]+;/g, "");
const NAMES = ["Technology", "Healthcare", "Financials", "Consumer Discretionary", "Communication Services", "Industrials", "Consumer Staples", "Energy", "Utilities", "Real Estate", "Materials"];
const rows = NAMES.map((name, i) => ({
  slug: name.toLowerCase().replace(/\s+/g, "-"), name, href: "/sector/" + name.toLowerCase().replace(/\s+/g, "-") + "/news",
  companies: 40 + i * 3, day: i === 3 ? -1.25 : 0.3 + i * 0.1, month: i === 3 ? -4.5 : 1 + i, ytd: i === 3 ? -12.4 : i === 7 ? null : 5 + i * 2,
  capSum: [16, 7, 9, 8, 7, 6, 4, 3, 1.5, 1.4, 1.8][i] * 1e12, capCovered: 40 + i * 3, constituents: 40 + i * 3,
}));

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${globalsCss} *,*::before,*::after{box-sizing:border-box} body{margin:0;background:#06080d;color:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif} #root{max-width:1120px;margin:0 auto;padding:18px 16px}</style></head>
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
const L = require(${JSON.stringify(LIBID)});
const HeatMap = require(${JSON.stringify(MAP)}).default;
const rows = ${JSON.stringify(rows)};
const sizing = L.heatSizing(rows);
const tiles = L.heatTiles(rows, sizing);
const rects = L.squarify(tiles.map((t) => t.weight), 200, 100).map((r) => ({ x: r.x / 2, y: r.y, w: r.w / 2, h: r.h }));
require("react-dom/client").createRoot(document.getElementById("root")).render(
  React.createElement(HeatMap, { tiles, rects, dayLabel: "Last close · 2 Oct", sizedBy: "tracked market cap", credit: { text: "Market data from Tiingo.com", href: "#" } })
);
</script></body></html>`;

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(globalRoot, "noop.js"))("playwright");
const browser = await chromium.launch();
const file = path.join(SHOTS, "sector-heatmap.html");
fs.writeFileSync(file, page);
let bad = 0;
const say = (ok, label, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) bad++; };

const read_ = (p) => p.evaluate(() => {
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const tiles = [...document.querySelectorAll("a.heatTile")].map((a) => {
    const R = a.getBoundingClientRect();
    const name = a.querySelector(".heatName");
    const bg = getComputedStyle(a).backgroundColor;
    const contrast = (1.05) / (lum(bg) + 0.05);
    return { name: name.textContent, value: a.querySelector(".heatValue").textContent, count: a.querySelector(".heatCount").textContent, href: a.getAttribute("href"),
      cls: a.className, x: R.left, y: R.top, w: R.width, h: R.height, contrast,
      clipped: name.scrollWidth > name.clientWidth + 1 || [...a.children].some((c) => { const C = c.getBoundingClientRect(); return C.top < R.top - 0.5 || C.bottom > R.bottom + 0.5 || C.right > R.right + 0.5; }),
      nameLines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight || "16")),
      px: Math.min(parseFloat(getComputedStyle(name).fontSize), parseFloat(getComputedStyle(a.querySelector(".heatCount")).fontSize)) };
  });
  const pressed = [...document.querySelectorAll(".heatPeriod")].map((b) => b.getAttribute("aria-pressed") + ":" + b.textContent);
  return { tiles, pressed, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
});

for (const width of (process.env.WIDTHS || "320,360,390,414,430,1280").split(",").map(Number)) {
  const phone = width <= 640;
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`file://${file}`);
  await p.waitForSelector("a.heatTile", { timeout: 5000 }).catch(() => {});
  console.log(`\n=== ${width} px ===`);
  const a = await read_(p);
  say(a.tiles.length === 11 && a.tiles.every((t) => t.href.startsWith("/sector/") && / companies$/.test(t.count)), "11 tiles, each a link with name, return and count");
  say(a.pressed.some((s) => s === "true:Year to date") && a.tiles.find((t) => t.name === "Consumer Discretionary").value === "-12.40%", "year to date shown first");
  say(/down/.test(a.tiles.find((t) => t.name === "Consumer Discretionary").cls) && a.tiles.find((t) => t.name === "Energy").value === "—", "the falling sector is red; a missing figure is a dash");
  say(a.tiles.every((t) => t.contrast >= 4.5), "white text at >= 4.5:1 on every tile", Math.min(...a.tiles.map((t) => t.contrast)).toFixed(2));
  say(a.tiles.every((t) => !t.clipped), "no name or tile text clipped", a.tiles.filter((t) => t.clipped).map((t) => t.name).join(", "));
  say(a.tiles.every((t) => t.px >= 13), "tile text at --fs-label or larger");
  if (phone) {
    const xs = [...new Set(a.tiles.map((t) => Math.round(t.x)))];
    say(xs.length === 2, "phones: a 2-column grid", xs.join(","));
  } else {
    let overlap = 0;
    for (let i = 0; i < a.tiles.length; i++) for (let j = i + 1; j < a.tiles.length; j++) {
      const s = a.tiles[i], t = a.tiles[j];
      if (Math.min(s.x + s.w, t.x + t.w) - Math.max(s.x, t.x) > 0.5 && Math.min(s.y + s.h, t.y + t.h) - Math.max(s.y, t.y) > 0.5) overlap++;
    }
    say(overlap === 0 && new Set(a.tiles.map((t) => Math.round(t.w))).size > 3, "desktop: a treemap, sized by weight, no overlaps");
  }
  say(a.sw <= a.cw, "no sideways scroll", `${a.sw} vs ${a.cw}`);
  if (width === 390 || width === 1280) await p.screenshot({ path: path.join(SHOTS, `sector-heatmap-${width}.png`), fullPage: true });
  await p.click("text=1 month");
  const b = await read_(p);
  say(b.pressed.some((s) => s === "true:1 month") && b.tiles.find((t) => t.name === "Consumer Discretionary").value === "-4.50%" && b.tiles.find((t) => t.name === "Energy").value === "+8.00%", "1 month swaps every figure, aria-pressed follows");
  await p.click("text=Last close · 2 Oct");
  const c = await read_(p);
  say(c.tiles.find((t) => t.name === "Consumer Discretionary").value === "-1.25%" && c.pressed.some((s) => s === "true:Last close · 2 Oct"), "Last close swaps them again");
  say(b.sw <= b.cw && c.sw <= c.cw, "no sideways scroll on any period");
  say(errors.length === 0, "no page errors", errors[0] ?? "");
  await ctx.close();
}
await browser.close();
console.log(bad ? `\nFAILED (${bad})` : "\nALL MEASURES PASSED");
process.exit(bad ? 1 : 0);
