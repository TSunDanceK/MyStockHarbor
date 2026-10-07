// A "CHART" LINK LANDS ON THE CHART, IN CHROMIUM (#563 COWORK #151, #152).
//
// Bundles the REAL DashboardClient for the browser (esbuild, as
// measure-dashboard-search does), mounts it with a landing a full screen tall
// above the analyser, and opens the links chartHref builds, plus the older
// forms, at 390 and 1280 px. It fails when, after hydration, the analyser's top
// is not at the top of the viewport (within 40 px), or it does not show the
// linked symbol:
//   /dashboard?symbol=AMZN#analyser, /dashboard?symbol=AMZN (older ?symbol=),
//   /dashboard#analyser (no symbol: the analyser, default symbol).
// A bare /dashboard must stay at the top, on the landing. Reduced motion is
// emulated on one run: the landing must still jump there.
//
// THE PHONE TAP (#152): an iPhone (390 px, touch, mobile UA) taps the stock
// page's "Dashboard" button (its real href, from chartHref) on /stock/AMZN. The
// dashboard it opens models the two things that pushed the analyser off screen
// on a real phone: the router's own scroll to the top after the page mounts
// (Next does this after a client navigation, after the page's effects), and a
// hero image that arrives late and grows the landing by 600 px. After load and
// hydration the analyser's top must be in the viewport, at the top, showing
// AMZN. And when the reader has already scrolled (a swipe before the image
// lands), the page must not pull them back.
//
// MUTANTS: a copy without the analyser jump must fail on the ?symbol= link (on
// #analyser the browser's own fragment scroll also lands there); the #151
// single jump (no hold) must fail the phone tap.
//
//   node scripts/measure-chart-links.mjs
//
// NOT IN check-all: it needs a browser and esbuild (ESBUILD_BIN, or fetched by
// npx).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire, register } from "node:module";

register("./lib/tsx-render-hooks.mjs", import.meta.url);
const { chartHref, chartHrefFrom } = await import("../lib/chartHref.ts");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const CLIENT = "app/components/DashboardClient.tsx";
const MUTANT = "app/components/.DashboardClient.chart-links-mutant.tsx";
const tmp = fs.mkdtempSync(path.join("scripts", ".chart-links-"));
// useSearchParams reads the real URL, as Next's does.
fs.writeFileSync(path.join(tmp, "nav.js"), `const r={push(){},replace(){},prefetch(){},back(){},refresh(){}};export const useRouter=()=>r;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useParams=()=>({});export const notFound=()=>{};export const redirect=()=>{};`);
fs.writeFileSync(path.join(tmp, "link.js"), `import React from "react";export default React.forwardRef(function Link({href,prefetch,scroll,replace,...p},ref){return React.createElement("a",{...p,href:typeof href==="string"?href:"#",ref});});`);

function bundle(clientPath, name, phone = false) {
  const entry = `scripts/.chart-links-entry-${name}.tsx`, out = path.join(tmp, `${name}.js`);
  fs.writeFileSync(entry, `import React from "react";
import { createRoot } from "react-dom/client";
import DashboardClient from "@/${clientPath.replace(/\.tsx$/, "")}";
const tall = { style: { minHeight: "140vh" } };
const landing = { market: React.createElement("div", { "data-market-now": "", ...tall }, "Market right now"), cards: React.createElement("div", { className: "dlCards", ...tall }, "cards"), mapped: 109, bottlenecks: {}, css: "" };
${phone ? `import PickerResultsGrid from "@/app/components/PickerResultsGrid";
// The screens' shipped row grid, for the #153 tap.
(window as unknown as { mountGrid: (p: object) => void }).mountGrid = (p) => createRoot(document.getElementById("grid")!).render(React.createElement(PickerResultsGrid, p as React.ComponentProps<typeof PickerResultsGrid>));
// The router's scroll after a client navigation runs after the page's own effects (a parent's didMount).
class RouterScroll extends React.Component<{ children: React.ReactNode }> { componentDidMount() { window.scrollTo(0, 0); } render() { return this.props.children; } }
// A hero picture with no reserved size, served late: the landing grows under the reader.
landing.market = React.createElement("div", { "data-market-now": "" }, React.createElement("img", { src: "/slow-hero.svg", alt: "", style: { display: "block", width: "100%" } }), landing.market);` : ""}
const sym = (new URLSearchParams(location.search).get("symbol") || "SPY").toUpperCase();
const app = React.createElement(DashboardClient, { defaultSymbol: sym, landing });
${phone ? `// A client navigation, as Next makes it: no page load, so no browser fragment scroll.
(window as unknown as { mountDashboard: () => void }).mountDashboard = () => createRoot(document.getElementById("root")!).render(React.createElement(RouterScroll, null, React.createElement(DashboardClient, { defaultSymbol: (new URLSearchParams(location.search).get("symbol") || "SPY").toUpperCase(), landing })));` : 'createRoot(document.getElementById("root")!).render(app);'}
`);
  try {
    const args = [entry, "--bundle", "--platform=browser", "--format=iife", "--jsx=automatic", "--alias:@=.", `--alias:next/navigation=./${path.join(tmp, "nav.js")}`, `--alias:next/link=./${path.join(tmp, "link.js")}`, '--define:process.env.NODE_ENV="production"', '--banner:js=var process={env:{NODE_ENV:"production"}};', `--outfile=${out}`, "--log-level=error"];
    if (process.env.ESBUILD_BIN) execFileSync(process.env.ESBUILD_BIN, args, { stdio: "inherit" });
    else execFileSync("npx", ["--yes", "esbuild@0.24.2", ...args], { stdio: "inherit" });
  } finally { fs.rmSync(entry, { force: true }); }
  return fs.readFileSync(out, "utf8");
}

process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const real = bundle(CLIENT, "real");
const realPhone = bundle(CLIENT, "real-phone", true);
const src = fs.readFileSync(CLIENT, "utf8");
const mutated = src.replace(/useLayoutEffect\(\(\) => \{\s*if \(!landing \|\| !wantsAnalyser\(window\.location\.hash, deepSymbol\)\) return;\s*return holdOnAnalyser\(\(\) => analyserRef\.current\);\s*\}, \[landing, deepSymbol\]\);/, "");
let mutantJs = null;
if (mutated !== src) {
  fs.writeFileSync(MUTANT, mutated);
  try { mutantJs = bundle(MUTANT, "mutant"); } finally { fs.rmSync(MUTANT, { force: true }); }
}
// #152's bug: one jump, no hold.
const single = src.replace("return holdOnAnalyser(() => analyserRef.current);", 'analyserRef.current?.scrollIntoView({ behavior: "instant", block: "start" });');
let singleJs = null;
if (single !== src) {
  fs.writeFileSync(MUTANT, single);
  try { singleJs = bundle(MUTANT, "single", true); } finally { fs.rmSync(MUTANT, { force: true }); }
}

const css = fs.readFileSync("app/globals.css", "utf8").replace(/@tailwind[^;]*;|@import[^;]*;/g, "");
const doc = (js) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body style="margin:0;background:#05080f"><div id="root"></div><script>${js}</script></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
/** Open a URL; where is the analyser, and which symbol does it show? */
async function land(js, url, width, reducedMotion = "no-preference") {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
  await page.route("**/*", (r) => (r.request().url().startsWith("http://dash.test/dashboard") ? r.fulfill({ body: doc(js), contentType: "text/html" }) : r.fulfill({ status: 404, body: "{}", contentType: "application/json" })));
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  await page.goto(`http://dash.test${url}`);
  await page.waitForSelector("#analyser", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const a = document.querySelector("#analyser");
    return a ? { top: a.getBoundingClientRect().top, scrollY, text: a.textContent ?? "" } : null;
  });
  await page.close();
  return { errors, r };
}

const CASES = [
  ["/dashboard?symbol=AMZN#analyser", "AMZN", true],
  ["/dashboard?symbol=AMZN", "AMZN", true],
  ["/dashboard#analyser", "SPY", true],
  ["/dashboard", "SPY", false],
];
let failures = 0;
for (const width of [390, 1280]) {
  for (const [url, sym, toAnalyser] of CASES) {
    const { errors, r } = await land(real, url, width);
    const bad = errors.length ? `the page threw: ${errors[0]}` : !r ? "no analyser" : toAnalyser ? (Math.abs(r.top) > 40 ? `the analyser is ${Math.round(r.top)} px from the top` : !r.text.includes(sym) ? `the analyser does not show ${sym}` : "") : r.scrollY > 0 ? `a bare visit scrolled (${Math.round(r.scrollY)} px)` : "";
    if (bad) failures++;
    console.log(`${url} at ${width}px: ${bad ? `FAIL ${bad}` : toAnalyser ? `OK (analyser at ${Math.round(r.top)} px, shows ${sym})` : "OK (stays on the landing)"}`);
  }
}
{
  const { r } = await land(real, "/dashboard?symbol=AMZN#analyser", 390, "reduce");
  const ok = r && Math.abs(r.top) <= 40;
  console.log(`reduced motion, 390px: ${ok ? "OK (jumped to the analyser)" : `FAIL (analyser at ${r ? Math.round(r.top) : "?"} px)`}`);
  if (!ok) failures++;
}

// THE PHONE TAP (#152).
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const STOCK_HREF = chartHref("AMZN");
// The stock page and the dashboard in one document: the tap is caught, the URL
// pushed and the dashboard mounted in place, the way Next's router does it.
const stockPage = (js) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body style="margin:0;background:#05080f;color:#fff;font-family:system-ui"><div id="stock"><div style="height:700px">AMZN stock analysis</div><a id="dash" href="${STOCK_HREF}" style="display:inline-block;padding:12px 16px;background:#2f6bff;color:#fff">Dashboard</a><div style="height:1200px"></div></div><div id="root"></div><script>${js}</script><script>document.getElementById("dash").addEventListener("click",(e)=>{e.preventDefault();history.pushState(null,"",e.currentTarget.getAttribute("href"));document.getElementById("stock").remove();window.mountDashboard();});</script></body></html>`;
const HERO = `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="600" viewBox="0 0 390 600"><rect width="390" height="600" fill="#13213f"/></svg>`;
async function tapFromStock(js, { swipe = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.route("**/*", async (r) => {
    const url = r.request().url();
    if (url === "http://dash.test/stock/AMZN") return r.fulfill({ body: stockPage(js), contentType: "text/html" });
    if (url.startsWith("http://dash.test/dashboard")) return r.fulfill({ body: doc(js), contentType: "text/html" });
    if (url.endsWith("/slow-hero.svg")) { await new Promise((res) => setTimeout(res, 900)); return r.fulfill({ body: HERO, contentType: "image/svg+xml" }); }
    return r.fulfill({ status: 404, body: "{}", contentType: "application/json" });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  await page.goto("http://dash.test/stock/AMZN");
  await page.tap("#dash");
  await page.waitForFunction(() => location.pathname + location.search + location.hash === "/dashboard?symbol=AMZN#analyser");
  await page.waitForSelector("#analyser");
  let swipedTo = null;
  if (swipe) {
    // The reader drags the page down (towards the landing) before the hero arrives.
    await page.waitForTimeout(150);
    await page.touchscreen.tap(195, 400);
    await page.evaluate(() => window.scrollBy(0, -300));
    swipedTo = await page.evaluate(() => document.querySelector("#analyser").getBoundingClientRect().top);
  }
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => { const a = document.querySelector("#analyser"); return { top: a.getBoundingClientRect().top, vh: innerHeight, scrollY, text: a.textContent ?? "", hero: document.querySelector('img[src="/slow-hero.svg"]')?.getBoundingClientRect().height ?? 0 }; });
  await ctx.close();
  return { errors, r, swipedTo, href: page.url() };
}
{
  const { errors, r } = await tapFromStock(realPhone);
  const bad = errors.length ? `the page threw: ${errors[0]}` : r.hero < 500 ? "the late hero never loaded (the test is void)" : r.top < -1 || r.top > 60 ? `the analyser's top is at ${Math.round(r.top)} px (viewport ${r.vh})` : !r.text.includes("AMZN") ? "the analyser does not show AMZN" : "";
  if (bad) failures++;
  console.log(`phone tap, /stock/AMZN "Dashboard" → ${STOCK_HREF}: ${bad ? `FAIL ${bad}` : `OK (after load and hydration the analyser's top is at ${Math.round(r.top)} px of ${r.vh}, shows AMZN; the router's scroll and a 600 px late hero both undone)`}`);
}
{
  const { r, swipedTo } = await tapFromStock(realPhone, { swipe: true });
  // Not pulled back: the analyser stays where the reader's own scroll put it
  // (the browser's scroll anchoring may hold their view as the hero grows).
  const ok = swipedTo > 200 && r.top > 200;
  if (!ok) failures++;
  console.log(`phone tap, then the reader scrolls up: ${ok ? `OK (the analyser stays ${Math.round(r.top)} px down where they left it; no re-scroll)` : `FAIL (the analyser was at ${Math.round(swipedTo)} px after their scroll, ${Math.round(r.top)} px after settling)`}`);
}

// THE SCREENS' "CHART" BUTTON (#153): the shipped PickerResultsGrid on a phone; expand a row, tap
// Chart (its href built as PickerResultPage builds it, through chartHrefFrom → chartHref), land on the analyser.
function gridPoints(seed) {
  const out = [], d = new Date(Date.UTC(2026, 9, 2));
  while (out.length < 120) { if (d.getUTCDay() % 6) out.unshift({ date: d.toISOString().slice(0, 10) }); d.setUTCDate(d.getUTCDate() - 1); }
  out.forEach((p, k) => { const c = 100 + seed + 6 * Math.sin((k + seed) / 9); Object.assign(p, { close: +c.toFixed(2), open: +(c * 1.004).toFixed(2), high: +(c * 1.015).toFixed(2), low: +(c * 0.985).toFixed(2), volume: 1e6 }); });
  return out;
}
const GRID_PAGES = [
  // The builder's stored link for a 200-day screen (tf + indicator), rebuilt as the page rebuilds it.
  { path: "/stocks-near-200-day-moving-average", configTitle: "Stocks near the 200-day moving average", stored: (s) => chartHref(s, { tf: "D", indicator: "MA200" }) },
  { path: "/stock-screener", configTitle: "Advanced stock screener", stored: () => undefined },
];
async function tapGridChart(js, page0, sym = "NVDA") {
  const entries = ["AAPL", "NVDA", "MSFT"].map((symbol, i) => ({ symbol, companyName: `${symbol} Inc.`, note: "fixture", tone: "bullish", stockHref: `/stock/${symbol}`, chartHref: chartHrefFrom(page0.stored(symbol), symbol), chartPoints: gridPoints(i * 4), price: 100 + i, changePct: 1.2, volume: 1e6, marketCap: 1e12, sector: "Technology", industry: "Semiconductors", reasons: ["fixture"] }));
  const props = { entries, configHref: page0.path, configTitle: page0.configTitle, tone: "bullish", emptyText: "None", isEarnings: false };
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body style="margin:0;background:#05080f"><div id="grid" class="resultWrap"></div><div id="root"></div><script>${js}</script><script>window.mountGrid(${JSON.stringify(props)});document.addEventListener("click",(e)=>{const a=e.target.closest('a[href^="/dashboard"]');if(!a)return;e.preventDefault();history.pushState(null,"",a.getAttribute("href"));document.getElementById("grid").remove();window.mountDashboard();},true);</script></body></html>`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.route("**/*", async (r) => {
    const url = r.request().url();
    if (url === `http://dash.test${page0.path}`) return r.fulfill({ body: html, contentType: "text/html" });
    if (url.endsWith("/slow-hero.svg")) { await new Promise((res) => setTimeout(res, 900)); return r.fulfill({ body: HERO, contentType: "image/svg+xml" }); }
    return r.fulfill({ status: 404, body: "{}", contentType: "application/json" });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  await page.goto(`http://dash.test${page0.path}`);
  const row = page.locator(".mRow", { has: page.locator(".mRowSym", { hasText: new RegExp(`^${sym}$`) }) });
  await row.locator(".mRowToggle").tap();
  await row.locator(".mRowPanel").waitFor();
  const href = await row.locator(".mRowAction", { hasText: /^Chart$/ }).getAttribute("href");
  await row.locator(".mRowAction", { hasText: /^Chart$/ }).tap();
  await page.waitForSelector("#analyser", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => { const a = document.querySelector("#analyser"); return a ? { top: a.getBoundingClientRect().top, vh: innerHeight, text: a.textContent ?? "", url: location.pathname + location.search + location.hash } : null; });
  await ctx.close();
  return { errors, r, href };
}
for (const pg of GRID_PAGES) {
  const { errors, r, href } = await tapGridChart(realPhone, pg);
  const bad = errors.length ? `the page threw: ${errors[0]}` : !r ? "no analyser after the tap" : !/^\/dashboard\?symbol=NVDA.*#analyser$/.test(href ?? "") ? `the Chart button's href is ${href}` : r.top < -1 || r.top > 60 ? `the analyser's top is at ${Math.round(r.top)} px (viewport ${r.vh})` : !r.text.includes("NVDA") ? "the analyser does not show NVDA" : "";
  if (bad) failures++;
  console.log(`phone, ${pg.path}: expand NVDA, tap Chart → ${href}: ${bad ? `FAIL ${bad}` : `OK (the analyser's top at ${Math.round(r.top)} px of ${r.vh}, shows NVDA)`}`);
}
if (singleJs) {
  const { r } = await tapGridChart(singleJs, GRID_PAGES[1]);
  const caught = !r || r.top < -1 || r.top > 60;
  console.log(`mutant (#151's single jump) on the screener tap: ${caught ? `caught — the analyser's top ends at ${r ? Math.round(r.top) : "?"} px` : "NOT CAUGHT"}`);
  if (!caught) failures++;
}
if (!singleJs) { console.log("mutant (#151 single jump): did not apply"); failures++; }
else {
  const { r } = await tapFromStock(singleJs);
  const caught = r.top < -1 || r.top > 60;
  console.log(`mutant (#151's single jump, no hold): ${caught ? `caught — on the phone the analyser's top ends at ${Math.round(r.top)} px` : "NOT CAUGHT"}`);
  if (!caught) failures++;
}
if (!mutantJs) { console.log("mutant: did not apply (the analyser jump not found)"); failures++; }
else {
  // Without the hash: Chromium's own fragment scroll would otherwise mask the mutant.
  const { r } = await land(mutantJs, "/dashboard?symbol=AMZN", 1280);
  const caught = !r || Math.abs(r.top) > 40;
  console.log(`mutant (no analyser jump): ${caught ? `caught — the analyser is ${r ? Math.round(r.top) : "?"} px from the top` : "NOT CAUGHT"}`);
  if (!caught) failures++;
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
