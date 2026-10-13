// THE PICKER RESULT ROWS AT PHONE WIDTH, IN A REAL BROWSER (#553 COWORK #147).
//
// Runs the shipped PickerResultsGrid (and every module it imports), transpiled
// as-is, in Chromium with React's own browser build, inside a wrapper with the
// screener shell's phone rules (.resultWrap: 10 px gutter, 8 px at <= 390,
// overflow-x clip, border-box). Three page configs: /low-pe-stocks (Valuation
// tab), /oversold-stocks-today (General, with the Stretch column) and the
// custom screener (/pickers). The fixture's first row carries the LONGEST
// company name in data/company-names.json, cleaned as the site cleans it.
//
// At each width, collapsed and with the long row expanded, it checks that
// every .mRow's right edge is inside the viewport and inside .resultWrap, that
// no descendant of a row paints past the row's right edge (the figures and
// the chevron included), and that the page does not scroll sideways. At 1280
// it checks that the phone rows are not used (desktop unchanged: the table).
//
// THE MUTANTS, at 390 px: the old implicit row track, and every rule of this
// fix reverted (the live bug: rows ~1360 px wide, clipped by .resultWrap, no
// sideways scroll). Both must be caught on all three pages, or the measure
// exits 1.
//
//   node scripts/measure-picker-rows.mjs     # widths 320 360 390 414 430 1280
//
// NOT IN check-all: it needs Chromium and Playwright (installed globally in
// the sandbox, not a dependency). Exit 1 on any overflow or uncaught mutant.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import ts from "typescript";
import "./lib/register-capex-ts.mjs";

const ROOT = process.cwd();
const SHOTS = path.resolve(process.env.SHOTS || "/tmp");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const cjs = (src, fileName) => ts.transpileModule(src, {
  fileName,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react", esModuleInterop: true },
}).outputText;

// ── The module graph, walked from the grid, every import as written ──────────
const STUBS = {
  "next/link": `const React = require("react");
module.exports = { __esModule: true, default: function Link(p) { const { href, prefetch, scroll, replace, ...rest } = p; return React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }); } };`,
  "next/navigation": `module.exports = {
  usePathname: () => window.__PATH,
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, back() {}, refresh() {} }),
};`,
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
  if (MODULES[id]) return id;
  MODULES[id] = "";
  const src = fs.readFileSync(file, "utf8");
  let out = file.endsWith(".mjs") || file.endsWith(".js") ? cjs(src, path.basename(file).replace(/\.m?js$/, ".ts")) : cjs(src, path.basename(file));
  // Rewrite every require() to the resolved module id.
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

// ── The fixture ─────────────────────────────────────────────────────────────
const { cleanName } = await import(path.join(ROOT, "lib/server/companyNames.ts"));
const names = JSON.parse(read("data/company-names.json")).rows;
const [longSym, longName] = Object.entries(names).map(([s, n]) => [s, cleanName(n)]).sort((a, b) => b[1].length - a[1].length)[0];

function points(seed) {
  const out = [];
  const d = new Date(Date.UTC(2026, 9, 2));
  while (out.length < 120) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift({ date: d.toISOString().slice(0, 10) });
    d.setUTCDate(d.getUTCDate() - 1);
  }
  out.forEach((p, k) => {
    const c = 40 + seed + 6 * Math.sin((k + seed) / 9) - k * 0.03;
    p.close = Number(c.toFixed(2)); p.open = Number((c * 1.004).toFixed(2));
    p.high = Number((c * 1.015).toFixed(2)); p.low = Number((c * 0.985).toFixed(2)); p.volume = 1_000_000 + k * 1000;
  });
  return out;
}
const OTHER = [
  ["CHTR", "Charter Communications, Inc."], ["KHC", "The Kraft Heinz Company"], ["APP", "AppLovin Corporation"],
  ["BRK-B", "Berkshire Hathaway Inc."], ["GOOGL", "Alphabet Inc."], ["T", "AT&T Inc."], ["WBD", "Warner Bros. Discovery, Inc."],
];
const ENTRIES = [[longSym, longName], ...OTHER].map(([symbol, companyName], i) => ({
  symbol, companyName, note: "fixture", tone: "bearish",
  stockHref: `/stock/${symbol}`, chartHref: `/dashboard?symbol=${symbol}`,
  chartPoints: points(i * 3), price: 1234.56 + i, changePct: -12.34 + i, volume: 98_765_432,
  marketCap: 1.23e12, peRatio: 123.4, industry: "Diversified Telecommunication Services", sector: "Communication Services",
  oversold: true, firedIndicators: ["RSI(14) < 30", "Stochastic < 20"], reasons: ["RSI(14) < 30", "Stochastic < 20"],
}));
const CONFIGS = [
  { name: "low-pe", path: "/low-pe-stocks", configHref: "/low-pe-stocks", configTitle: "Low PE Stocks", defaultTab: "valuation" },
  { name: "oversold", path: "/oversold-stocks-today", configHref: "/oversold-stocks-today", configTitle: "Oversold Stocks Today", defaultTab: "general" },
  { name: "custom", path: "/pickers", configHref: "/pickers", configTitle: "Custom screener", defaultTab: "general" },
];

// The grid's <style> block is in the source; a mutant edits the source before
// transpiling. The row-track fix is two rules that each hold on their own in
// Chromium (an explicit minmax(0, 1fr) column, or min-width: 0 on the row,
// which caps the implicit auto track), so the first mutant takes both out. The
// second reverts every rule this fix added: the live bug.
const OLD_TRACK = [
  [/\.mRows \{ margin-top: 12px; display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 8px; \}/, ".mRows { margin-top: 12px; display: grid; gap: 8px; }"],
  [/\.mRow \{\n(\s*)min-width: 0;\n/, ".mRow {\n"],
];
const ALL_REVERTED = [
  ...OLD_TRACK,
  [/flex: 1 1 auto; min-width: 0; display: flex; width: 100%;/, "flex: 1 1 auto; display: flex; width: 100%;"],
  [/\.mRowName \{\n(\s*)flex: 0 1 auto; min-width: 0;/, ".mRowName {\n$1min-width: 0;"],
  [/\.mRowChart \{ grid-column: 1 \/ -1; min-width: 0; margin/, ".mRowChart { grid-column: 1 / -1; margin"],
];
const MUTANTS = [
  ["the old implicit row track (no column, no row min-width)", OLD_TRACK],
  ["every rule of this fix reverted (the live bug)", ALL_REVERTED],
];

function pageHtml(modules, config) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#020617;color:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
/* ScreenerShell / PickerResultPage at <= 720 px. */
.page, .page * { box-sizing: border-box; }
.page { overflow-x: clip; }
.resultWrap { max-width: 1600px; margin: 0 auto; padding: 26px 18px 58px; }
@media (max-width: 720px) { .resultWrap { width: 100%; padding: 14px 10px 44px; overflow-x: clip; } }
@media (max-width: 390px) { .resultWrap { padding-left: 8px; padding-right: 8px; } }
</style></head>
<body><div class="page"><div class="resultWrap"><div id="root"></div></div></div>
<script>
window.process = { env: { NODE_ENV: "development" } };
window.__PATH = ${JSON.stringify(config.path)};
const SOURCES = ${JSON.stringify(modules)};
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
  React.createElement(Grid, {
    entries: ${JSON.stringify(ENTRIES)},
    configHref: ${JSON.stringify(config.configHref)}, configTitle: ${JSON.stringify(config.configTitle)},
    tone: "bearish", emptyText: "None", isEarnings: false, defaultTab: ${JSON.stringify(config.defaultTab)},
  })
);
</script></body></html>`;
}

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(globalRoot, "noop.js"))("playwright");
const browser = await chromium.launch();

async function measure(modules, config, width, { shot = false } = {}) {
  const phone = width < 700;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  const file = path.join(SHOTS, `picker-rows-${config.name}.html`);
  fs.writeFileSync(file, pageHtml(modules, config));
  await p.goto(`file://${file}`);
  await p.waitForSelector(phone ? ".mRow" : "table", { timeout: 15000 }).catch(() => {});
  const probe = () => p.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const wrap = document.querySelector(".resultWrap").getBoundingClientRect();
    const rows = [...document.querySelectorAll(".mRow")];
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      const sym = row.querySelector(".mRowSym")?.textContent ?? "?";
      if (r.right > vw + 0.5) out.push(`${sym}: row right ${Math.round(r.right)} > viewport ${vw} (row ${Math.round(r.width)} px)`);
      if (r.right > wrap.right + 0.5) out.push(`${sym}: row right ${Math.round(r.right)} > .resultWrap ${Math.round(wrap.right)}`);
      for (const el of row.querySelectorAll("*")) {
        const b = el.getBoundingClientRect();
        if (!b.width || getComputedStyle(el).display === "none") continue;
        if (b.right > r.right + 0.5) { out.push(`${sym}: <${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}"> right ${Math.round(b.right)} > row ${Math.round(r.right)}`); break; }
      }
      for (const cls of [".mRowFigures", ".mRowChev"]) {
        const el = row.querySelector(cls);
        if (!el) { out.push(`${sym}: no ${cls}`); continue; }
        const b = el.getBoundingClientRect();
        if (b.right > vw + 0.5 || b.width === 0) out.push(`${sym}: ${cls} not visible (right ${Math.round(b.right)})`);
      }
    }
    return { out, rows: rows.length, table: !!document.querySelector("table"), pageWide: document.documentElement.scrollWidth > vw + 0.5 };
  });
  const collapsed = await probe();
  let expanded = null;
  if (phone && collapsed.rows) {
    await p.click(".mRow .mRowToggle");
    await p.waitForSelector(".mRowPanel");
    expanded = await probe();
    expanded.chartFits = await p.evaluate(() => {
      const row = document.querySelector(".mRow.open").getBoundingClientRect();
      const svg = document.querySelector(".mRowChart svg");
      if (!svg) return "no chart";
      const b = svg.getBoundingClientRect();
      return b.right <= row.right + 0.5 && b.width > 100 ? true : `chart ${Math.round(b.width)} px, right ${Math.round(b.right)} vs row ${Math.round(row.right)}`;
    });
    if (shot) await p.screenshot({ path: path.join(SHOTS, `picker-rows-${config.name}-${width}.png`), fullPage: false });
  }
  await ctx.close();
  return { collapsed, expanded, errors };
}

let bad = 0;
const say = (ok, label, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) bad++; };
console.log(`Fixture: ${ENTRIES.length} rows; the longest name in data/company-names.json (${longSym}, ${longName.length} chars) first.`);

for (const width of (process.env.WIDTHS || "320,360,390,414,430,1280").split(",").map(Number)) {
  console.log(`\n=== ${width} px ===`);
  for (const config of CONFIGS) {
    const { collapsed, expanded, errors } = await measure(MODULES, config, width, { shot: width === 390 });
    say(errors.length === 0, `${config.path}: no page errors`, errors[0]);
    if (width >= 700) {
      say(collapsed.rows === 0 && collapsed.table, `${config.path}: desktop keeps the table, no phone rows`);
      continue;
    }
    say(collapsed.rows === ENTRIES.length, `${config.path}: ${collapsed.rows} phone rows rendered`);
    say(collapsed.out.length === 0, `${config.path}: collapsed, every row fits, figures and chevron visible`, collapsed.out.slice(0, 3).join("; "));
    say(!collapsed.pageWide, `${config.path}: collapsed, no sideways scroll`);
    say(expanded && expanded.out.length === 0, `${config.path}: one row expanded, every row fits`, expanded?.out.slice(0, 3).join("; "));
    say(expanded && expanded.chartFits === true, `${config.path}: the expanded chart sizes to its row`, String(expanded?.chartFits));
  }
}

console.log("\n=== mutants, 390 px ===");
const gridSrc = read("app/components/PickerResultsGrid.tsx");
for (const [label, edits] of MUTANTS) {
  let m = gridSrc;
  let applied = true;
  for (const [from, to] of edits) {
    const next = m.replace(from, to);
    if (next === m) applied = false;
    m = next;
  }
  if (!applied) { say(false, `mutant "${label}" applies`, "a replacement matched nothing"); continue; }
  const gridFile = path.join(ROOT, "app/components/PickerResultsGrid.tsx");
  const modules = { ...MODULES, [GRID]: cjs(m, "PickerResultsGrid.tsx").replace(/require\("([^"]+)"\)/g, (mm, spec) => {
    if (spec in REACT || spec in STUBS) return mm;
    return `require(${JSON.stringify(path.relative(ROOT, resolveFile(spec, gridFile)))})`;
  }) };
  let caught = 0;
  for (const config of CONFIGS) {
    const { collapsed } = await measure(modules, config, 390);
    if (collapsed.out.length) caught++;
  }
  say(caught === CONFIGS.length, `mutant "${label}" is caught on all ${CONFIGS.length} pages`, `${caught}/${CONFIGS.length}`);
}

await browser.close();
console.log(`\n${bad ? `FAILED (${bad})` : "ALL MEASURES PASSED"}\n`);
process.exit(bad ? 1 : 0);
