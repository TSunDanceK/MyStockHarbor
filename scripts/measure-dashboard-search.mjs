// THE DASHBOARD HERO'S SEARCH KEEPS ITS FOCUS (#563 COWORK #148 §1).
//
// The bug: typing one letter in the landing hero's search threw the focus out,
// so every letter needed another click. The hero was declared inside
// DashboardClient and mounted as <LandingHero />, a new component type on every
// render, so each keystroke remounted the input. This measure bundles the REAL
// DashboardClient for the browser (esbuild, as tap-notes-measure does), mounts
// it with a landing, and types "AMZN" key by key at 1280 and 390 px. It fails
// when, after any key, document.activeElement is not the hero's input, or the
// value is not what was typed so far.
//
// MUTANT: a copy with the hero mounted as <LandingHero /> again must fail.
//
//   node scripts/measure-dashboard-search.mjs
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
const MUTANT = "app/components/.DashboardClient.search-mutant.tsx";
// Inside the repo, so the stubs resolve react from its node_modules; removed at the end.
const tmp = fs.mkdtempSync(path.join("scripts", ".dash-search-"));
fs.writeFileSync(path.join(tmp, "nav.js"), `const r={push(){},replace(){},prefetch(){},back(){},refresh(){}};export const useRouter=()=>r;export const usePathname=()=>"/dashboard";export const useSearchParams=()=>new URLSearchParams();export const useParams=()=>({});export const notFound=()=>{};export const redirect=()=>{};`);
// ColdFill (the not-yet-read prompt inside A's earnings card, in the Filed earnings tab since
// #160) calls a server action, which Next compiles to a reference and esbuild cannot bundle.
fs.writeFileSync(path.join(tmp, "coldfill.js"), `export default function ColdFill(){return null;}`);
fs.writeFileSync(path.join(tmp, "link.js"), `import React from "react";export default React.forwardRef(function Link({href,prefetch,scroll,replace,...p},ref){return React.createElement("a",{...p,href:typeof href==="string"?href:"#",ref});});`);

function bundle(clientPath, name) {
  const entry = `scripts/.dash-search-entry-${name}.tsx`, out = path.join(tmp, `${name}.js`);
  fs.writeFileSync(entry, `import React from "react";
import { createRoot } from "react-dom/client";
import DashboardClient from "@/${clientPath.replace(/\.tsx$/, "")}";
const landing = { market: React.createElement("div", { "data-market-now": "" }, "Market right now"), cards: React.createElement("div", { className: "dlCards" }, "cards"), mapped: 109, bottlenecks: {}, css: "" };
createRoot(document.getElementById("root")!).render(React.createElement(DashboardClient, { defaultSymbol: "TSLA", landing }));
`);
  try {
    const args = [entry, "--bundle", "--platform=browser", "--format=iife", "--jsx=automatic", "--alias:@=.", `--alias:next/navigation=./${path.join(tmp, "nav.js")}`, `--alias:next/link=./${path.join(tmp, "link.js")}`, `--alias:@/app/stock/[symbol]/ColdFill=./${path.join(tmp, "coldfill.js")}`, '--define:process.env.NODE_ENV="production"', '--banner:js=var process={env:{NODE_ENV:"production"}};', `--outfile=${out}`, "--log-level=error"];
    if (process.env.ESBUILD_BIN) execFileSync(process.env.ESBUILD_BIN, args, { stdio: "inherit" });
    else execFileSync("npx", ["--yes", "esbuild@0.24.2", ...args], { stdio: "inherit" });
  } finally { fs.rmSync(entry, { force: true }); }
  return fs.readFileSync(out, "utf8");
}

process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const real = bundle(CLIENT, "real");
const src = fs.readFileSync(CLIENT, "utf8");
const mutated = src.replace("{LandingHero()}", "<LandingHero />");
let mutantJs = null;
if (mutated !== src) {
  fs.writeFileSync(MUTANT, mutated);
  try { mutantJs = bundle(MUTANT, "mutant"); } finally { fs.rmSync(MUTANT, { force: true }); }
}

const css = fs.readFileSync("app/globals.css", "utf8").replace(/@tailwind[^;]*;|@import[^;]*;/g, "");
const doc = (js) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body style="margin:0;background:#05080f"><div id="root"></div><script>${js}</script></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
/** Type key by key; after each key, is the hero input still focused, with the text so far? */
async function typeKeeps(js, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  // No network: every fetch (symbol search, quote, history) answers empty.
  await page.route("**/*", (r) => (r.request().url().startsWith("http://dash.test/") ? r.fulfill({ body: doc(js), contentType: "text/html" }) : r.fulfill({ status: 404, body: "{}", contentType: "application/json" })));
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  await page.goto("http://dash.test/");
  await page.waitForTimeout(500);
  if (errors.length) { await page.close(); return [`the page threw: ${errors[0]}`]; }
  const sel = 'input[aria-label="Search a ticker or company"]';
  await page.waitForSelector(sel);
  await page.click(sel);
  await page.fill(sel, "");
  const bad = [];
  let typed = "";
  for (const k of "AMZN") {
    await page.keyboard.press(k === k.toUpperCase() ? `Shift+${k}` : k);
    typed += k;
    await page.waitForTimeout(60);
    const st = await page.evaluate((s) => ({ focused: document.activeElement === document.querySelector(s), value: document.querySelector(s)?.value ?? null }), sel);
    if (!st.focused) bad.push(`after "${typed}" the focus left the input`);
    if (st.value !== typed) bad.push(`after "${typed}" the value is "${st.value}"`);
  }
  await page.close();
  return [...new Set(bad)];
}

let failures = 0;
for (const width of [1280, 390]) {
  const bad = await typeKeeps(real, width);
  if (bad.length) failures++;
  console.log(`typing AMZN at ${width}px: ${bad.length ? `FAIL ${bad.slice(0, 3).join("; ")}` : "OK (focused, value AMZN, after every key)"}`);
}
if (!mutantJs) { console.log("mutant: did not apply ({LandingHero()} not found)"); failures++; }
else {
  const bad = await typeKeeps(mutantJs, 1280);
  console.log(`mutant (the hero mounted as <LandingHero />): ${bad.length ? `caught — ${bad[0]}` : "NOT CAUGHT"}`);
  if (!bad.length) failures++;
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
