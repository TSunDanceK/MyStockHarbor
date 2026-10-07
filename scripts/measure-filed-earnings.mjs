// THE "FILED EARNINGS" TAB AND THE PHONE TABS, HYDRATED (#563 COWORK #154 §5, §6).
//
// Bundles the REAL DashboardClient (esbuild, as measure-dashboard-search does),
// mounts it with a landing, answers its two earnings routes from fixtures (no
// network), opens the "Filed earnings" tab and checks, at 1280, 390 and 320 px:
//   - AMZN: the chart with 8 EPS bars, only the newest highlighted, the margin
//     line, the snapshot's verdict chip ("Good"), and "Full earnings →" to
//     /stock/AMZN/earnings; nothing scrolls the page sideways;
//   - SPY (a fund, available: false): "Filed figures not available for SPY.";
//   - the five tabs on one line at 390 and 320 px, each with its full name as
//     its accessible name; at 390 px they fit without scrolling.
// (The card is called, not mounted, and the chart keeps one answer per symbol,
// so a re-render never refetches: check-dashboard-landing holds both.)
// With --shots DIR it saves the tab at 1280 and 390 px.
// The fixture's figures are illustrative, not AMZN's filings.
//
//   node scripts/measure-filed-earnings.mjs [--shots DIR]
//
// NOT IN check-all: it needs a browser and esbuild (ESBUILD_BIN, or fetched by npx).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? path.resolve(process.argv[i + 1]) : null; })();
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const tmp = fs.mkdtempSync(path.join("scripts", ".filed-earnings-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
fs.writeFileSync(path.join(tmp, "nav.js"), `const r={push(){},replace(){},prefetch(){},back(){},refresh(){}};export const useRouter=()=>r;export const usePathname=()=>"/dashboard";export const useSearchParams=()=>new URLSearchParams(location.search);export const useParams=()=>({});export const notFound=()=>{};export const redirect=()=>{};`);
fs.writeFileSync(path.join(tmp, "link.js"), `import React from "react";export default React.forwardRef(function Link({href,prefetch,scroll,replace,...p},ref){return React.createElement("a",{...p,href:typeof href==="string"?href:"#",ref});});`);
function bundle(client, name) {
const entry = `scripts/.filed-earnings-entry-${name}.tsx`, out = path.join(tmp, `${name}.js`);
fs.writeFileSync(entry, `import React from "react";
import { createRoot } from "react-dom/client";
import DashboardClient from "@/${client.replace(/\.tsx$/, "")}";
const landing = { market: React.createElement("div", { "data-market-now": "" }, "Market right now"), cards: React.createElement("div", { className: "dlCards" }, "cards"), mapped: 109, bottlenecks: {}, css: "" };
const sym = (new URLSearchParams(location.search).get("symbol") || "AMZN").toUpperCase();
createRoot(document.getElementById("root")!).render(React.createElement(DashboardClient, { defaultSymbol: sym, landing }));
`);
try {
  const args = [entry, "--bundle", "--platform=browser", "--format=iife", "--jsx=automatic", "--alias:@=.", `--alias:next/navigation=./${path.join(tmp, "nav.js")}`, `--alias:next/link=./${path.join(tmp, "link.js")}`, '--define:process.env.NODE_ENV="production"', '--banner:js=var process={env:{NODE_ENV:"production"}};', `--outfile=${out}`, "--log-level=error"];
  if (process.env.ESBUILD_BIN) execFileSync(process.env.ESBUILD_BIN, args, { stdio: "inherit" });
  else execFileSync("npx", ["--yes", "esbuild@0.24.2", ...args], { stdio: "inherit" });
} finally { fs.rmSync(entry, { force: true }); }
return fs.readFileSync(out, "utf8");
}
const CLIENT = "app/components/DashboardClient.tsx";
const realJs = bundle(CLIENT, "real");
const css = fs.readFileSync("app/globals.css", "utf8").replace(/@tailwind[^;]*;|@import[^;]*;/g, "");
// The landing's own stylesheet (its server module does not bundle for the browser), as the page has it.
const LANDING_CSS = fs.readFileSync("app/dashboard/DashboardLanding.tsx", "utf8").match(/export const LANDING_CSS = `([\s\S]*?)`;/)[1];
const docOf = (js) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>${LANDING_CSS}</style></head><body style="margin:0;background:#05080f"><div class="msh-wrap" id="root"></div><script>${js}</script></body></html>`;

// Illustrative figures (the shape the route returns), oldest first.
const Q = ["Q4 FY2024", "Q1 FY2025", "Q2 FY2025", "Q3 FY2025", "Q4 FY2025", "Q1 FY2026", "Q2 FY2026", "Q3 FY2026"];
const EPS = [1.43, 1.26, 1.68, 1.95, 1.86, 1.59, 1.74, 2.05], OP = [11.3, 10.8, 11.4, 11.1, 11.8, 11.6, 12.2, 12.9];
const AMZN = { symbol: "AMZN", available: true, many: "quarters", periods: Q.map((label, i) => ({ label, short: label.replace(/ FY20(\d\d)/, " '$1"), eps: EPS[i], epsText: `$${EPS[i].toFixed(2)}`, opPct: Math.round(OP[i]), opText: `${OP[i].toFixed(1)}%` })) };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
async function openTab(sym, width, js = realJs) {
  const phone = width < 700;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  await page.route("**/*", (r) => {
    const url = r.request().url();
    if (url.startsWith("http://dash.test/dashboard")) return r.fulfill({ body: docOf(js), contentType: "text/html" });
    if (url.endsWith("/api/dashboard-earnings/AMZN")) return r.fulfill({ body: JSON.stringify(AMZN), contentType: "application/json" });
    if (url.endsWith("/api/dashboard-earnings/SPY")) return r.fulfill({ body: JSON.stringify({ symbol: "SPY", available: false }), contentType: "application/json" });
    if (url.endsWith("/api/stock-earnings/AMZN")) return r.fulfill({ body: JSON.stringify({ hasStructuredData: true, tone: "green", toneLabel: "Good" }), contentType: "application/json" });
    if (url.endsWith("/api/stock-earnings/SPY")) return r.fulfill({ body: JSON.stringify({ hasStructuredData: false, tone: "yellow", toneLabel: "Unavailable" }), contentType: "application/json" });
    return r.fulfill({ status: 404, body: "{}", contentType: "application/json" });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  await page.goto(`http://dash.test/dashboard?symbol=${sym}`);
  await page.waitForSelector('[data-tab="earnings"]', { state: "attached" });
  const tabs = await page.evaluate(() => {
    const t = [...document.querySelectorAll(".dlTab")].filter((e) => e.getClientRects().length).map((e) => ({ top: e.getBoundingClientRect().top, name: e.getAttribute("aria-label") }));
    const strip = [...document.querySelectorAll(".dlTabs")].find((e) => e.getClientRects().length);
    return { oneLine: t.length === 5 && t.every((x) => Math.abs(x.top - t[0].top) < 1), names: t.map((x) => x.name), scrolls: strip.scrollWidth > strip.clientWidth + 1 };
  });
  // The analyser re-renders as its own data settles (the 404s here), so the tab is clicked in the page.
  await page.waitForTimeout(500);
  await page.evaluate(() => [...document.querySelectorAll('[data-tab="earnings"]')].find((e) => e.getClientRects().length).click());
  await page.waitForFunction(() => [...document.querySelectorAll("[data-filed-earnings]")].some((x) => x.getClientRects().length && x.getAttribute("data-filed-earnings") !== "loading"), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const fe = [...document.querySelectorAll("[data-filed-earnings]")].find((x) => x.getClientRects().length);
    const bars = fe ? [...fe.querySelectorAll("[data-eps-bar]")] : [];
    return {
      state: fe?.getAttribute("data-filed-earnings"),
      bars: bars.length, latest: bars.map((b) => b.getAttribute("data-eps-bar")).join(","),
      line: !!document.querySelector("[data-op-line]"),
      chip: document.querySelector("[data-verdict-chip]")?.textContent ?? null,
      more: [...document.querySelectorAll("[data-filed-earnings] a")].map((a) => [a.textContent, a.getAttribute("href")]),
      empty: document.querySelector("[data-filed-empty]")?.textContent ?? null,
      sideways: document.documentElement.scrollWidth > innerWidth,
    };
  });
  if (SHOTS && sym === "AMZN" && (width === 1280 || width === 390)) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const box = await page.evaluate(() => { const e = [...document.querySelectorAll(".dlTabbed")].find((x) => x.getClientRects().length); e.scrollIntoView({ block: "start" }); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top + scrollY, width: b.width, height: Math.min(b.height, 760) }; });
    await page.screenshot({ path: path.join(SHOTS, `filed-earnings-${width}.png`), fullPage: true, clip: box });
  }
  await ctx.close();
  return { errors, tabs, r };
}

let failures = 0;
const say = (label, bad) => { if (bad) failures++; console.log(`${label}: ${bad ? `FAIL ${bad}` : "OK"}`); };
const FULL = ["Chart", "Key levels", "Price zones", "Filed earnings", "News"];
for (const width of [1280, 390, 320]) {
  const { errors, tabs, r } = await openTab("AMZN", width);
  say(`AMZN at ${width}px`, errors.length ? `the page threw: ${errors[0]}`
    : r.state !== "chart" ? `the tab shows "${r.state}"`
    : r.bars !== 8 || r.latest !== ",,,,,,,latest" ? `${r.bars} bars, highlighted: ${r.latest}`
    : !r.line ? "no margin line" : r.chip !== "Good" ? `verdict chip "${r.chip}"`
    : !r.more.some(([t, h]) => t === "Full earnings →" && h === "/stock/AMZN/earnings") ? "no Full earnings link"
    : r.sideways ? "the page scrolls sideways"
    : width <= 480 && !tabs.oneLine ? "the tabs wrap"
    : tabs.names.join("|") !== FULL.join("|") ? `tab names ${tabs.names.join("|")}`
    : width === 390 && tabs.scrolls ? "the tabs need scrolling at 390px" : "");
}
{
  const { errors, r } = await openTab("SPY", 390);
  say("SPY at 390px (a fund)", errors.length ? `the page threw: ${errors[0]}` : r.empty !== "Filed figures not available for SPY." ? `empty state "${r.empty}"` : r.bars ? "bars drawn for a fund" : "");
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
