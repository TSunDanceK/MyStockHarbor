// THE CHART-PLAY CARDS' QUIET LINK IN A REAL BROWSER (#553 COWORK #162).
//
// Runs the shipped PlaysClient, BullFlagsClient and DescendingTrianglesClient
// (transpiled as-is, the page payload module stubbed) in Chromium with the
// site's globals.css, each on a fixture section of five cards. It checks, at
// 320-430 px and 1280 px:
//   - no full-width filled button in any card;
//   - each card ends in an "Open full chart →" link at --fs-label or larger,
//     in a 44 px tall tap area, named "Open full chart for <SYMBOL>";
//   - the chart is a link to the same URL under the same name;
//   - cards in one row end level, and nothing scrolls sideways.
// Writes play-cards-<page>-<width>.png to SHOTS.
//
//   node scripts/measure-play-cards.mjs     # widths 320 360 390 414 430 1280
//
// NOT IN check-all: it needs Chromium and Playwright. check-play-card-link
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
  "app/plays/playsPagePayload.ts": `module.exports = { __esModule: true, readPlaysPagePayload: async () => null, readBullFlagsPagePayload: async () => null, readDescendingTrianglesPagePayload: async () => null };`,
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
    const rel = path.relative(ROOT, target);
    if (rel in STUBS) return `require(${JSON.stringify(rel)})`;
    return `require(${JSON.stringify(addModule(target))})`;
  });
  MODULES[id] = out;
  return id;
}
const CLIENTS = [
  ["plays", "app/plays/PlaysClient.tsx", "ascendingTriangle"],
  ["bull-flags", "app/plays/bull-flags/BullFlagsClient.tsx", "bullFlag"],
  ["descending-triangles", "app/plays/descending-triangles/DescendingTrianglesClient.tsx", "descendingTriangle"],
].map(([name, file, play]) => [name, addModule(path.join(ROOT, file)), play]);
const globalsCss = read("app/globals.css").replace(/@import[^;]+;/g, "");

const day = (i) => new Date(Date.UTC(2026, 5, 1) + i * 86400000).toISOString().slice(0, 10);
const chartPoints = Array.from({ length: 60 }, (_, i) => { const c = 40 + i * 0.15 + Math.sin(i / 4) * 1.5; return { date: day(i), open: c - 0.3, high: c + 0.8, low: c - 0.8, close: c, volume: 1e6 }; });
const item = (play, i) => ({
  symbol: "P" + (i + 1), companyName: "Pattern Company " + (i + 1) + (i === 1 ? " With A Much Longer Name" : ""), play, timeframe: "D", score: 80 - i, tone: "green",
  note: i === 2 ? "A longer description line that wraps onto a second line, so the card is taller than its neighbours in the same row." : "Fixture pattern.",
  resistance: 50, support: 40, latestClose: 48, distanceToResistancePct: 2, distanceToSupportPct: 3, resistanceTouches: 3, risingLowTouches: 3, supportTouches: 3, fallingHighTouches: 3,
  patternBars: 30, resistanceZonePct: 1, supportZonePct: 1, lowSlopePct: 0.2, highSlopePct: -0.2,
  supportStartDate: day(20), supportStartPrice: 42, supportEndDate: day(58), supportEndPrice: 47, resistanceStartDate: day(20), resistanceStartPrice: 50, resistanceEndDate: day(58), resistanceEndPrice: 49,
  poleStartPrice: 40, poleHighPrice: 50, poleGainPct: 25, flagRetracementPct: 30, distanceToBreakoutPct: 2, flagHigh: 50, flagLow: 46, flagBars: 8, poleBars: 10, flagDriftPct: -1,
  flagUpperStartPrice: 50, flagUpperEndPrice: 49, flagLowerStartPrice: 47, flagLowerEndPrice: 46, flagAngleDeg: -10, poleStartDate: day(40), poleHighDate: day(50), flagStartDate: day(51),
  startDate: day(20), endDate: day(59), chartPoints, dashboardHref: "/dashboard?symbol=P" + (i + 1),
});

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(globalRoot, "noop.js"))("playwright");
const browser = await chromium.launch();
let bad = 0;
const say = (ok, label, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) bad++; };

for (const [name, id, play] of CLIENTS) {
  const payload = { updatedAt: "2026-10-05T12:00:00Z", universeSize: 685, sections: [{ title: "Fixture section", description: "Fixture.", foundCount: 5, shownCount: 5, items: Array.from({ length: 5 }, (_, i) => item(play, i)) }] };
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${globalsCss} *,*::before,*::after{box-sizing:border-box} body{margin:0;background:#06080d;color:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}</style></head>
<body><div id="root"></div><script>
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
const C = require(${JSON.stringify(id)}).default;
require("react-dom/client").createRoot(document.getElementById("root")).render(React.createElement(C, { initialPayload: ${JSON.stringify(payload)} }));
</script></body></html>`;
  const file = path.join(SHOTS, `play-cards-${name}.html`);
  fs.writeFileSync(file, html);
  for (const width of (process.env.WIDTHS || "320,360,390,414,430,1280").split(",").map(Number)) {
    const phone = width <= 980;
    const ctx = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`file://${file}`);
    await p.waitForSelector("article .playOpenLink", { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(200);
    console.log(`\n=== ${name} @ ${width} px ===`);
    const r = await p.evaluate(() => {
      const cards = [...document.querySelectorAll("article")].filter((a) => a.querySelector(".playOpenLink"));
      return {
        n: cards.length,
        cards: cards.map((a) => {
          const A = a.getBoundingClientRect();
          const link = a.querySelector(".playOpenLink");
          const area = a.querySelector(".playChartArea");
          const L = link.getBoundingClientRect();
          const buttons = [...a.querySelectorAll("a, button")].filter((el) => {
            const cs = getComputedStyle(el); const R = el.getBoundingClientRect();
            const filled = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
            return filled && R.width > A.width * 0.7 && !el.classList.contains("playChartArea");
          }).length;
          return {
            top: Math.round(A.top), bottom: Math.round(A.bottom), linkH: L.height, linkPx: parseFloat(getComputedStyle(link).fontSize),
            linkText: link.textContent.trim(), linkName: link.getAttribute("aria-label"), linkHref: link.getAttribute("href"),
            areaHref: area?.getAttribute("href"), areaName: area?.getAttribute("aria-label"), areaH: area?.getBoundingClientRect().height ?? 0,
            linkAtFoot: A.bottom - L.bottom < 24, buttons,
          };
        }),
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      };
    });
    say(r.n === 5, "five cards rendered", errors[0] ?? String(r.n));
    if (r.n) {
      say(r.cards.every((c) => c.buttons === 0), "no full-width filled button in any card");
      say(r.cards.every((c) => c.linkText === "Open full chart →" && /^Open full chart for P\d$/.test(c.linkName ?? "")), "each card ends in the named link");
      say(r.cards.every((c) => c.linkH >= 44 && c.linkPx >= 13), "a 44 px tap area at --fs-label or larger", `${Math.min(...r.cards.map((c) => c.linkH))} px / ${r.cards[0].linkPx}px`);
      say(r.cards.every((c) => c.areaHref === c.linkHref && c.areaName === c.linkName && c.areaH > 40), "the chart links to the same URL under the same name");
      say(r.cards.every((c) => c.linkAtFoot), "the link sits at the card's foot");
      const rows = new Map();
      for (const c of r.cards) rows.set(c.top, [...(rows.get(c.top) ?? []), c.bottom]);
      say([...rows.values()].every((b) => Math.max(...b) - Math.min(...b) <= 1), "cards in one row end level", JSON.stringify([...rows.values()]));
    }
    say(r.sw <= r.cw, "no sideways scroll", `${r.sw} vs ${r.cw}`);
    say(errors.length === 0, "no page errors", errors[0] ?? "");
    if (width === 390 || width === 1280) await p.screenshot({ path: path.join(SHOTS, `play-cards-${name}-${width}.png`), fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log(bad ? `\nFAILED (${bad})` : "\nALL MEASURES PASSED");
process.exit(bad ? 1 : 0);
