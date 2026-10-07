// A "CHART" LINK LANDS ON THE CHART, IN CHROMIUM (#563 COWORK #151).
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
// MUTANT: a copy without the analyser jump must fail on the ?symbol= link
// (on #analyser the browser's own fragment scroll also lands there).
//
//   node scripts/measure-chart-links.mjs
//
// NOT IN check-all: it needs a browser and esbuild (ESBUILD_BIN, or fetched by
// npx).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const CLIENT = "app/components/DashboardClient.tsx";
const MUTANT = "app/components/.DashboardClient.chart-links-mutant.tsx";
const tmp = fs.mkdtempSync(path.join("scripts", ".chart-links-"));
// useSearchParams reads the real URL, as Next's does.
fs.writeFileSync(path.join(tmp, "nav.js"), `const r={push(){},replace(){},prefetch(){},back(){},refresh(){}};export const useRouter=()=>r;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useParams=()=>({});export const notFound=()=>{};export const redirect=()=>{};`);
fs.writeFileSync(path.join(tmp, "link.js"), `import React from "react";export default React.forwardRef(function Link({href,prefetch,scroll,replace,...p},ref){return React.createElement("a",{...p,href:typeof href==="string"?href:"#",ref});});`);

function bundle(clientPath, name) {
  const entry = `scripts/.chart-links-entry-${name}.tsx`, out = path.join(tmp, `${name}.js`);
  fs.writeFileSync(entry, `import React from "react";
import { createRoot } from "react-dom/client";
import DashboardClient from "@/${clientPath.replace(/\.tsx$/, "")}";
const tall = { style: { minHeight: "140vh" } };
const landing = { market: React.createElement("div", { "data-market-now": "", ...tall }, "Market right now"), cards: React.createElement("div", { className: "dlCards", ...tall }, "cards"), mapped: 109, bottlenecks: {}, css: "" };
const sym = (new URLSearchParams(location.search).get("symbol") || "SPY").toUpperCase();
createRoot(document.getElementById("root")!).render(React.createElement(DashboardClient, { defaultSymbol: sym, landing }));
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
const src = fs.readFileSync(CLIENT, "utf8");
const mutated = src.replace(/useLayoutEffect\(\(\) => \{\s*if \(!landing \|\| !wantsAnalyser\(window\.location\.hash, deepSymbol\)\) return;\s*analyserRef\.current\?\.scrollIntoView\(\{ behavior: "instant", block: "start" \}\);\s*\}, \[landing, deepSymbol\]\);/, "");
let mutantJs = null;
if (mutated !== src) {
  fs.writeFileSync(MUTANT, mutated);
  try { mutantJs = bundle(MUTANT, "mutant"); } finally { fs.rmSync(MUTANT, { force: true }); }
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
