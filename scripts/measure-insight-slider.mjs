// "DID THE LEVEL HOLD?": THE SLIDER LINES UP WITH THE CHART (#563 COWORK #155).
//
// Bundles the REAL InsightChart (and the PriceChart it draws) for the browser,
// mounts it with 120 fixture sessions (publication at session 80), and at 390
// and 1280 px sets the thumb to the first, middle and last positions. It fails
// when the chart's marker dot is more than 2 px (x) from the thumb's centre,
// when the readout's date is not that bar's date, or when a session before
// publication is not labelled "before publication".
//
// MUTANT: the track at the card's full width (no plot inset) must fail.
//
//   node scripts/measure-insight-slider.mjs [--shots DIR]
//
// NOT IN check-all: it needs a browser and esbuild.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? path.resolve(process.argv[i + 1]) : null; })();
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const CHART = "app/insights/[slug]/InsightChart.tsx", MUTANT = "app/insights/[slug]/.InsightChart.slider-mutant.tsx";
const tmp = fs.mkdtempSync(path.join("scripts", ".insight-slider-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));

// 120 weekday sessions to 2 Oct 2026; publication at 80.
const days = [];
for (const d = new Date(Date.UTC(2026, 9, 2)); days.length < 120; d.setUTCDate(d.getUTCDate() - 1)) if (d.getUTCDay() % 6) days.unshift(d.toISOString().slice(0, 10));
const closes = days.map((_, k) => +(200 + 12 * Math.sin(k / 9) + k * 0.15).toFixed(2));
const ma = (n) => closes.map((_, k) => (k < n - 1 ? null : +(closes.slice(k - n + 1, k + 1).reduce((a, b) => a + b, 0) / n).toFixed(2)));
const PROPS = { symbol: "AMZN", points: days.map((date, k) => ({ date, close: closes[k] })), fullCloses: closes, displayStart: 0, ma50: ma(50), ma200: closes.map(() => null), wma200: null, bbMid: null, publishIndex: 80, level: null, todayLevels: [] };

function bundle(file, name) {
  const entry = `scripts/.insight-slider-entry-${name}.tsx`, out = path.join(tmp, `${name}.js`);
  fs.writeFileSync(entry, `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport InsightChart from "@/${file.replace(/\.tsx$/, "")}";\ncreateRoot(document.getElementById("root")!).render(React.createElement(InsightChart, ${JSON.stringify(PROPS)}));\n`);
  try {
    const args = [entry, "--bundle", "--platform=browser", "--format=iife", "--jsx=automatic", "--alias:@=.", '--define:process.env.NODE_ENV="production"', '--banner:js=var process={env:{NODE_ENV:"production"}};', `--outfile=${out}`, "--log-level=error"];
    if (process.env.ESBUILD_BIN) execFileSync(process.env.ESBUILD_BIN, args, { stdio: "inherit" });
    else execFileSync("npx", ["--yes", "esbuild@0.24.2", ...args], { stdio: "inherit" });
  } finally { fs.rmSync(entry, { force: true }); }
  return fs.readFileSync(out, "utf8");
}
const real = bundle(CHART, "real");
const src = fs.readFileSync(CHART, "utf8");
const mutated = src.replace(/style=\{\{ paddingLeft: `calc\([^`]*`, paddingRight: `calc\([^`]*` \}\}/, "style={{}}");
let mutantJs = null;
if (mutated !== src) { fs.writeFileSync(MUTANT, mutated); try { mutantJs = bundle(MUTANT, "mutant"); } finally { fs.rmSync(MUTANT, { force: true }); } }

// The page's own rules for the chart card and the slider, from InsightPage's stylesheet.
const pageCss = fs.readFileSync("app/insights/[slug]/InsightPage.tsx", "utf8").match(/const CSS = `([\s\S]*?)`;/)?.[1] ?? "";
const css = fs.readFileSync("app/globals.css", "utf8").replace(/@tailwind[^;]*;|@import[^;]*;/g, "");
const doc = (js) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>${pageCss}</style></head><body style="margin:0;background:#05080f;color:#e2e8f0"><div style="padding:16px"><section class="inCard"><div id="root"></div></section></div><script>${js}</script></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
async function probe(js, width, shot) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route("**/*", (r) => (r.request().url() === "http://chart.test/" ? r.fulfill({ body: doc(js), contentType: "text/html" }) : r.fulfill({ status: 404, body: "" })));
  await page.goto("http://chart.test/");
  await page.waitForSelector("#inSliderRange");
  const out = [];
  for (const v of [0, 60, 119]) {
    await page.evaluate((val) => {
      const el = document.querySelector("#inSliderRange");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(val));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, v);
    await page.waitForTimeout(80);
    out.push(await page.evaluate(({ val, thumb }) => {
      const el = document.querySelector("#inSliderRange"), r = el.getBoundingClientRect();
      const thumbX = r.left + thumb / 2 + (val / Number(el.max)) * (r.width - thumb);
      const dot = document.querySelector("[data-chart-marker-dot]")?.getBoundingClientRect();
      const readout = document.querySelector("[data-slider-readout]");
      return { val, thumbX, dotX: dot ? dot.left + dot.width / 2 : null, date: readout?.getAttribute("data-slider-readout"), text: readout?.textContent ?? "" };
    }, { val: v, thumb: 18 }));
    if (shot && SHOTS && v === 60) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `insight-slider-${width}.png`), fullPage: true }); }
  }
  await page.close();
  return out;
}

let failures = 0;
for (const width of [390, 1280]) {
  const res = await probe(real, width, true);
  for (const r of res) {
    const bad = r.dotX === null ? "no marker on the chart" : Math.abs(r.dotX - r.thumbX) > 2 ? `the dot is ${(r.dotX - r.thumbX).toFixed(1)} px from the thumb` : r.date !== days[r.val] ? `the readout says ${r.date}, the bar is ${days[r.val]}` : r.val < 80 && !/before publication/.test(r.text) ? "a pre-publication session not labelled" : r.val >= 80 && !/vs publication/.test(r.text) ? "no vs-publication figure" : "";
    if (bad) failures++;
    console.log(`${width}px, position ${r.val}: ${bad ? `FAIL ${bad}` : `OK (dot ${r.dotX.toFixed(1)} vs thumb ${r.thumbX.toFixed(1)}, ${r.date})`}`);
  }
}
if (!mutantJs) { console.log("mutant: did not apply"); failures++; }
else {
  const res = await probe(mutantJs, 1280, false);
  const off = Math.max(...res.map((r) => Math.abs((r.dotX ?? 1e9) - r.thumbX)));
  console.log(`mutant (the track at the card's full width): ${off > 2 ? `caught — the dot is up to ${off.toFixed(1)} px from the thumb` : "NOT CAUGHT"}`);
  if (off <= 2) failures++;
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
