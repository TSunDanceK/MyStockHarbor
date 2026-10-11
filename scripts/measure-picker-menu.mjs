// THE PICKERS MENU (OPTION B) IN A REAL BROWSER (#553 COWORK #155).
//
// Runs the shipped ScreenerNav and PickerGlyph (and every module they import),
// transpiled as-is, in Chromium with React's own browser build. The filter
// context is stubbed with one ticked row (Oversold) and ATR Spike at 0, so the
// selected and "none today" states both render. At 1280 px it measures the
// sidebar; at 320-430 px it opens the Screens sheet the way a phone does.
// It checks:
//   - every row draws one 30x18 glyph and no text-character icon is visible;
//   - row labels compute at --fs-label (13px) or larger, and section headings
//     at 12px or larger;
//   - the ticked row shows its accent bar, the checkbox is the styled native
//     input and takes keyboard focus with a visible outline;
//   - ATR Spike reads "none today" with no 0 pill;
//   - no sideways scroll and no row wider than the list.
// Writes picker-menu-<page>-390.png and -1280.png to SHOTS (default /tmp).
// CURRENT_HREF=/cheap-tech-stocks (any preset page) also checks that page's
// link row wears exactly the ticked-filter look (#553 COWORK #163).
//
//   node scripts/measure-picker-menu.mjs     # widths 320 360 390 414 430 1280
//
// NOT IN check-all: it needs Chromium and Playwright (installed globally in
// the sandbox). check-picker-glyphs holds the static rules and mutants.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import ts from "typescript";

const ROOT = process.cwd();
// CURRENT_HREF=/cheap-tech-stocks measures a preset page (#553 COWORK #163).
const CURRENT = process.env.CURRENT_HREF || "/oversold-stocks-today";
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
  "next/navigation": `module.exports = { usePathname: () => ${JSON.stringify(CURRENT)}, useSearchParams: () => new URLSearchParams(""), useRouter: () => ({ push() {}, replace() {}, prefetch() {}, back() {}, refresh() {} }) };`,
  // The context, with one ticked row and an empty screen.
  [FILTER_CONTEXT]: `const React = require("react");
const counts = { hasBuySignal: 317, hasSellSignal: 668, oversold: 302, overbought: 135, bestTrendPick: 20, divergencePick: 20,
  bullishRsiDivergence: 36, bearishRsiDivergence: 129, bullishMacdDivergence: 41, bearishMacdDivergence: 88, athBreakoutPick: 19,
  threeMonthHighPick: 20, buyTheDip: 363, breakout: 33, volumeSpike: 21, atrSpike: 0, dailyMa200Proximity: 44, weeklyMa200Proximity: 12,
  aboveMA50: 310, belowMA50: 375, aboveMA200: 352, belowMA200: 333, trendFlipBullish: 9, trendFlipBearish: 14,
  trendFlipBullishWeekly: 3, trendFlipBearishWeekly: 5, strongEarningsGrowth: 61, macroSrPick: 18 };
const state = { predicates: [{ kind: "flag", key: "oversold" }], selectedFilters: ["oversold"], selectedSectors: [], conditionCounts: counts,
  matchCount: 302, isPristine: false, toggleFilter() {}, toggleSector() {}, clearFilters() {}, setPredicate() {}, removePredicate() {},
  setMatchCount() {}, setConditionCounts() {} };
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
const NAV = addModule(path.join(ROOT, "app/components/ScreenerNav.tsx"));
const globalsTokens = (read("app/globals.css").match(/--fs-[a-z]+:\s*[^;]+;|--lh-read:\s*[^;]+;/g) ?? []).join("");

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{${globalsTokens}} *,*::before,*::after{box-sizing:border-box} body{margin:0;background:#06080d;color:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif} #wrap{max-width:1600px;margin:0 auto;padding:14px 10px} @media (min-width:981px){#wrap{display:grid;grid-template-columns:352px 1fr;gap:22px}}</style></head>
<body><div id="wrap"><div id="root"></div><main></main></div>
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
const Nav = require(${JSON.stringify(NAV)}).default;
require("react-dom/client").createRoot(document.getElementById("root")).render(
  React.createElement(Nav, { currentHref: ${JSON.stringify(CURRENT)}, variant: "full", showFilters: true, alwaysFilterMode: true })
);
</script></body></html>`;

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(globalRoot, "noop.js"))("playwright");
const browser = await chromium.launch();
const file = path.join(SHOTS, "picker-menu.html");
fs.writeFileSync(file, page);

let bad = 0;
const say = (ok, label, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) bad++; };
const TEXT_ICONS = /[▲▼●★⊖↗↘◆◇▮▇↕◈☆▦⚇⇄△⚑▽✓]/;

for (const width of (process.env.WIDTHS || "320,360,390,414,430,1280").split(",").map(Number)) {
  const phone = width < 981;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`file://${file}`);
  console.log(`\n=== ${width} px ===`);
  if (phone) {
    const trigger = (await p.$(".screenerPillBtn")) ?? (await p.$(".screenerSelectBtn"));
    if (trigger) await trigger.click();
    await p.waitForSelector(".screenerOverlayPanel .screenerNavList", { timeout: 5000 }).catch(() => {});
  } else {
    await p.waitForSelector(".screenerSidebar .screenerNavList", { timeout: 5000 }).catch(() => {});
  }
  const r = await p.evaluate((phoneMode) => {
    const list = document.querySelector(phoneMode ? ".screenerOverlayPanel .screenerNavList" : ".screenerSidebar .screenerNavList");
    if (!list) return { missing: true };
    const L = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll(".screenerNavItem")];
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const rowGlyphs = rows.map((row) => row.querySelectorAll("svg.pickerGlyph").length);
    const glyphSizes = [...list.querySelectorAll("svg.pickerGlyph")].map((g) => { const b = g.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; });
    const labels = rows.map((row) => row.querySelector(".screenerNavLabel")).filter(Boolean).map((l) => parseFloat(getComputedStyle(l).fontSize));
    const headings = [...list.querySelectorAll(".screenerNavHeading")].map((h) => parseFloat(getComputedStyle(h).fontSize));
    const text = [...list.querySelectorAll("*")].filter((e) => e.children.length === 0 && visible(e)).map((e) => e.textContent).join(" ");
    const wide = rows.filter((row) => row.getBoundingClientRect().right > L.right + 0.5).map((row) => row.textContent.trim().slice(0, 30));
    const ticked = list.querySelector(".screenerNavCheckable.checked");
    const tickedBar = ticked ? getComputedStyle(ticked).boxShadow : "";
    const box = list.querySelector('.screenerNavCheckable input[type="checkbox"]');
    const boxStyle = box ? { appearance: getComputedStyle(box).appearance, w: box.getBoundingClientRect().width, radius: getComputedStyle(box).borderRadius } : null;
    const atr = rows.find((row) => /ATR Spike/.test(row.textContent));
    // #553 COWORK #163: the current page's link row wears the ticked look.
    const currentLinks = [...list.querySelectorAll("a.screenerNavItem[aria-current=page]")];
    const look = (el) => el ? { bg: getComputedStyle(el).backgroundColor, bar: getComputedStyle(el).boxShadow, weight: getComputedStyle(el.querySelector(".screenerNavLabel")).fontWeight } : null;
    return {
      currentLinks: currentLinks.length, currentLook: look(currentLinks[0]), tickedLook: look(ticked),
      rows: rows.length, rowGlyphs, glyphSizes, labels, headings, textIcons: text,
      wide, pageWide: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5,
      tickedBar, boxStyle,
      atr: atr ? { none: /none today/.test(atr.textContent), pill: !!atr.querySelector(".screenerNavCount"), nameColour: getComputedStyle(atr.querySelector(".screenerNavLabel")).color, boxOpacity: getComputedStyle(atr.querySelector("input")).opacity, rowOpacity: getComputedStyle(atr).opacity } : null,
    };
  }, phone);
  if (r.missing) { say(false, "the menu list rendered", errors[0] ?? "not found"); await ctx.close(); continue; }
  say(errors.length === 0, "no page errors", errors[0]);
  say(r.rows >= 30 && r.rowGlyphs.every((n) => n === 1), `every row draws one glyph (${r.rows} rows)`, r.rowGlyphs.filter((n) => n !== 1).length + " without");
  say(r.glyphSizes.every((s) => s === "30x18"), "every glyph is 30x18", [...new Set(r.glyphSizes)].join(", "));
  say(!TEXT_ICONS.test(r.textIcons), "no text-character icon is visible");
  say(r.labels.every((px) => px >= 13 - 0.01), `row labels at --fs-label or larger (min ${Math.min(...r.labels)}px)`);
  say(r.headings.every((px) => px >= 12 - 0.01), `section headings at 12px or larger (min ${Math.min(...r.headings)}px)`);
  say(/2px 0px 0px 0px inset|inset 2px 0px 0px/.test(r.tickedBar), "the ticked row carries its 2px accent bar", r.tickedBar);
  say(r.boxStyle && r.boxStyle.appearance === "none" && Math.round(r.boxStyle.w) === 16 && r.boxStyle.radius === "5px", "the checkbox is the restyled native input (16px, 5px corners)", JSON.stringify(r.boxStyle));
  say(r.atr && r.atr.none && !r.atr.pill, "ATR Spike (0) reads \"none today\", no 0 pill");
  say(r.atr && r.atr.boxOpacity === "1" && r.atr.rowOpacity === "1", "...and its box is not greyed out (only the name dims)", JSON.stringify(r.atr));
  say(r.wide.length === 0, "no row wider than the list", r.wide.slice(0, 3).join("; "));
  say(!r.pageWide, "no sideways scroll");
  if (CURRENT !== "/oversold-stocks-today") {
    say(r.currentLinks === 1 && JSON.stringify(r.currentLook) === JSON.stringify(r.tickedLook), `${CURRENT}: its row, and only it, looks exactly like a ticked filter`, `${r.currentLinks} · ${JSON.stringify(r.currentLook)} vs ${JSON.stringify(r.tickedLook)}`);
  } else {
    say(r.currentLinks === 0, "a non-preset page highlights no Popular Screen link row", String(r.currentLinks));
  }
  // Keyboard focus: Tab to the first checkbox; its outline must show.
  const focus = await p.evaluate((phoneMode) => {
    const list = document.querySelector(phoneMode ? ".screenerOverlayPanel .screenerNavList" : ".screenerSidebar .screenerNavList");
    const box = list?.querySelector('.screenerNavCheckable input[type="checkbox"]');
    return !!box;
  }, phone);
  if (focus) {
    const sel = phone ? ".screenerOverlayPanel .screenerNavCheckable input[type=checkbox]" : ".screenerSidebar .screenerNavCheckable input[type=checkbox]";
    await p.focus(sel);
    await p.keyboard.press("Shift+Tab");
    await p.keyboard.press("Tab");
    const outline = await p.evaluate((s) => { const el = document.querySelector(s); return document.activeElement === el ? getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth : "not focused"; }, sel);
    say(/solid 2px/.test(outline), "keyboard focus shows a 2px outline on the checkbox", outline);
  }
  if (width === 390 || width === 1280) {
    const target = phone ? ".screenerOverlayPanel" : ".screenerSidebar";
    const el = await p.$(target);
    if (el) await el.screenshot({ path: path.join(SHOTS, `picker-menu-${CURRENT.slice(1)}-${width}.png`) });
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${bad ? `FAILED (${bad})` : "ALL MEASURES PASSED"}  (screenshots in ${SHOTS})\n`);
process.exit(bad ? 1 : 0);
