// THE "FILED EARNINGS" TAB AND THE PHONE TABS, HYDRATED (#563 COWORK #154 §5, #160).
//
// Bundles the REAL DashboardClient (esbuild, as measure-dashboard-search does),
// mounts it with a landing, answers its routes from fixtures (no network), opens
// the "Filed earnings" tab and checks, at 1280, 390 and 320 px:
//   - AMZN: the stock page's Earnings snapshot card (#160), whole: its tiles,
//     its yearly chart, "See full report →" to /stock/AMZN/earnings and "About
//     these figures"; no chart of the tab's own; the card inside the tab and
//     nothing scrolling the page sideways;
//   - SPY (a fund, available: false): "Filed figures not available for SPY.";
//   - the five icon tabs (#161: an icon over a short label at every width) on
//     one line at 1280, 390 and 320 px, each with its full name as its
//     accessible name and title; at 390 px they fit without scrolling.
// With --shots DIR it saves the tab at 1280 and 390 px.
// The snapshot is the AAPL measure fixture relabelled AMZN: illustrative, not AMZN's filings.
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
// ColdFill (the not-yet-read prompt inside A's card) calls a server action, which Next
// compiles to a reference and esbuild cannot; the fixture snapshot is read, so it never shows.
fs.writeFileSync(path.join(tmp, "coldfill.js"), `export default function ColdFill(){return null;}`);
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
  const args = [entry, "--bundle", "--platform=browser", "--format=iife", "--jsx=automatic", "--alias:@=.", `--alias:next/navigation=./${path.join(tmp, "nav.js")}`, `--alias:next/link=./${path.join(tmp, "link.js")}`, `--alias:@/app/stock/[symbol]/ColdFill=./${path.join(tmp, "coldfill.js")}`, '--define:process.env.NODE_ENV="production"', '--banner:js=var process={env:{NODE_ENV:"production"}};', `--outfile=${out}`, "--log-level=error"];
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

// The route's answer: A's snapshot (the AAPL measure fixture, relabelled).
const AMZN = { ...JSON.parse(fs.readFileSync("scripts/fixtures/measure-earnings-snapshot-AAPL.json", "utf8")), symbol: "AMZN" };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
async function openTab(sym, width, js = realJs) {
  const phone = width < 700;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  await page.route("**/*", (r) => {
    const url = r.request().url();
    if (url.startsWith("http://dash.test/dashboard")) return r.fulfill({ body: docOf(js), contentType: "text/html" });
    if (url.endsWith("/api/sec/filed-earnings")) return r.fulfill({ body: JSON.stringify({ symbols: ["AMZN"] }), contentType: "application/json" });
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
    const icons = [...document.querySelectorAll(".dlTabIcon")].filter((e) => e.getClientRects().length).length;
    const short = [...document.querySelectorAll(".dlTabShort")].filter((e) => e.getClientRects().length).map((e) => e.textContent).join("|");
    const titles = [...document.querySelectorAll(".dlTab")].filter((e) => e.getClientRects().length).map((e) => e.getAttribute("title")).join("|");
    return { oneLine: t.length === 5 && t.every((x) => Math.abs(x.top - t[0].top) < 1), names: t.map((x) => x.name), scrolls: strip.scrollWidth > strip.clientWidth + 1, icons, short, titles };
  });
  // The analyser re-renders as its own data settles (the 404s here), so the tab is clicked in the page.
  await page.waitForTimeout(500);
  await page.evaluate(() => [...document.querySelectorAll('[data-tab="earnings"]')].find((e) => e.getClientRects().length).click());
  await page.waitForFunction(() => [...document.querySelectorAll("[data-filed-earnings]")].some((x) => x.getClientRects().length && x.getAttribute("data-filed-earnings") !== "loading"), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const fe = [...document.querySelectorAll("[data-filed-earnings]")].find((x) => x.getClientRects().length);
    const tab = [...document.querySelectorAll(".dlTabbed")].find((x) => x.getClientRects().length)?.getBoundingClientRect();
    const card = fe?.querySelector(".snapshotMetricsWrap")?.getBoundingClientRect();
    return {
      state: fe?.getAttribute("data-filed-earnings"),
      card: !!card, inside: !!card && !!tab && card.left >= tab.left - 1 && card.right <= tab.right + 1,
      ownChart: !!fe?.querySelector("[data-eps-bar], [data-op-line], [data-filed-chart]"),
      cardChart: !!fe?.querySelector(".snapshotMetricsWrap svg"),
      about: !!fe && /About these figures/.test(fe.textContent),
      more: [...document.querySelectorAll("[data-filed-earnings] a")].map((a) => [a.textContent.trim(), a.getAttribute("href")]),
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
    : r.state !== "snapshot" ? `the tab shows "${r.state}"`
    : !r.card ? "no snapshot card" : r.ownChart ? "a chart of the tab's own is drawn" : !r.cardChart ? "the card's yearly chart is missing"
    : !r.about ? "no About these figures" : !r.inside ? "the card spills out of the tab"
    : !r.more.some(([t, h]) => t === "See full report →" && h === "/stock/AMZN/earnings") ? "no See full report link"
    : r.sideways ? "the page scrolls sideways"
    : !tabs.oneLine ? "the tabs wrap"
    : tabs.icons !== 5 || tabs.short !== "Chart|Levels|Zones|Earnings|News" ? `icon tabs not drawn at ${width}px (${tabs.icons} icons, labels ${tabs.short})`
    : tabs.titles !== FULL.join("|") ? `tab titles ${tabs.titles}`
    : tabs.names.join("|") !== FULL.join("|") ? `tab names ${tabs.names.join("|")}`
    : width === 390 && tabs.scrolls ? "the tabs need scrolling at 390px" : "");
}
{
  const { errors, r } = await openTab("SPY", 390);
  say("SPY at 390px (a fund)", errors.length ? `the page threw: ${errors[0]}` : r.empty !== "Filed figures not available for SPY." ? `empty state "${r.empty}"` : r.card ? "a card drawn for a fund" : "");
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
