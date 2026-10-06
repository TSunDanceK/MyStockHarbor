// THE DASHBOARD LANDING IN CHROMIUM (#563 COWORK #134).
//
// Renders the real /dashboard (app/dashboard/page.tsx, server markup) with the
// repo's render hooks and stubbed reads (scripts/lib/measure-stubs/: the
// landing's data filled, or all missing with MEASURE_LANDING=empty; a fixture
// quote; daily bars for every symbol), for ?symbol=TSLA. At 1280, 1024, 768 and
// 390 px (and 320), 16 and 20 px roots, it fails when:
//   - the page scrolls sideways, or a block spills out of its card;
//   - reading text (six words or more, or a sentence) in the landing or the
//     analyser's head is under 16 px outside fine print, or anything is under 12 px;
//   - there is not exactly one h1, or it is not the landing's;
//   - a card is missing, or (empty run) a card shows no empty state;
//   - the analyser is missing, or opening #analyser does not land on it;
//   - at 560 px and under, the order is not hero, Market right now, the cards,
//     then the analyser.
// With --shots DIR it saves 1280 and 390 px screenshots. A mutant (a 700 px
// wide block) must be caught as sideways scroll.
//
//   node scripts/measure-dashboard-landing.mjs [--shots DIR]
//
// NOT IN check-all: it needs Chromium and Playwright.
import fs from "node:fs";
import path from "node:path";
import { createRequire, register } from "node:module";

const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? path.resolve(process.argv[i + 1]) : null; })();
process.env.MEASURE_STUBS = JSON.stringify({
  "@/lib/server/historyCache": "scripts/lib/measure-stubs/history-cache.mjs",
  "@/lib/server/marketData/read": "scripts/lib/measure-stubs/tiingo-read-variant.mjs",
  "@/lib/server/secColdFetch": "scripts/lib/measure-stubs/insight-sec-cold.mjs",
  "./secColdFetch": "scripts/lib/measure-stubs/insight-sec-cold.mjs",
  "@/lib/server/dashboardCards": "scripts/lib/measure-stubs/dashboard-landing.mjs",
  "@/lib/server/quoteData": "scripts/lib/measure-stubs/dashboard-reads.mjs",
  "@/lib/server/benchmarksBuilder": "scripts/lib/measure-stubs/dashboard-reads.mjs",
  "@/lib/server/internalNews": "scripts/lib/measure-stubs/dashboard-reads.mjs",
});
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
register("./lib/tsx-render-hooks.mjs", import.meta.url);
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const { renderToStaticMarkup } = await import("react-dom/server");
const { fixtureBars } = await import("./lib/measure-stubs/fixture-bars.mjs");
const { default: Page } = await import("../app/dashboard/page.tsx");

globalThis.__SPX_BARS = fixtureBars(260, "2021-06-01");
const render = async () => renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ symbol: "TSLA" }) }));
const runs = [["full", await render()]];
process.env.MEASURE_LANDING = "empty";
runs.push(["empty", await render()]);
delete process.env.MEASURE_LANDING;

const CSS = fs.readFileSync("app/globals.css", "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
let mode = "full";
const doc = (body, root) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style><style>html{font-size:${root}px}body{margin:0}</style></head><body data-mode="${mode}">${body}</body></html>`;

const CARDS = ["hub", "capex", "pickers", "earnings", "sectors", "insight", "news"];
function probe(cards) {
  const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const bad = [];
  const q = (s) => document.querySelector(s);
  const empty = document.body.dataset.mode === "empty";
  for (const [sel, what] of [["[data-landing]", "hero"], ["[data-market-now]", "Market right now"], [".dlCards", "the cards"], ["#analyser", "the analyser"], ["[data-verdict]", "the verdict line"], [".dlTabs", "the analyser's tabs"]]) if (!q(sel)) bad.push(`missing: ${what}`);
  for (const c of cards) {
    const el = q(`[data-card="${c}"]`);
    if (!el) bad.push(`missing card: ${c}`);
    else if (empty !== el.hasAttribute("data-empty")) bad.push(`card ${c}: ${empty ? "no empty state" : "shows its empty state"}`);
  }
  const h1s = document.querySelectorAll("h1");
  if (h1s.length !== 1 || !h1s[0].closest("[data-landing]")) bad.push(`${h1s.length} h1s, or not the landing's`);
  if (document.documentElement.scrollWidth > innerWidth) {
    const wide = [...document.querySelectorAll("body *")].filter((e) => vis(e) && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3)
      .map((e) => `${e.tagName.toLowerCase()}.${typeof e.className === "string" ? e.className.split(" ")[0] : ""}[${Math.round(e.getBoundingClientRect().right)}] ${e.textContent.trim().slice(0, 25)}`);
    bad.push(`scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth}: ${wide.join(", ")})`);
  }
  for (const card of document.querySelectorAll(".dlCard, .dlTile, .dlPoint, .dlHeroLeft, .dlWeek")) {
    const c = card.getBoundingClientRect();
    for (const el of card.querySelectorAll("*")) {
      if (!vis(el) || el.closest("svg")) continue;
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > c.right + 1 || r.left < c.left - 1)) { bad.push(`spills out of its card: ${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().slice(0, 30)}"`); break; }
    }
  }
  // At 560 px and under: hero, Market right now, the cards, then the analyser.
  if (innerWidth <= 560) {
    const top = (s) => q(s)?.getBoundingClientRect().top ?? NaN;
    const order = [top(".dlHeroLeft"), top("[data-market-now]"), top(".dlCards"), top("#analyser")];
    if (!order.every((v, i) => i === 0 || v > order[i - 1])) bad.push(`mobile order is not hero, market, cards, analyser (${order.map(Math.round).join(", ")})`);
  }
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  for (const scope of document.querySelectorAll("[data-landing], .dlCards, .dlAnalyserHead")) {
    const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent.replace(/\s+/g, " ").trim(), el = n.parentElement;
      if (!t || el.closest("style,script,title,svg,details:not([open])") || !vis(el)) continue;
      const px = parseFloat(getComputedStyle(el).fontSize), words = t.split(" ").filter((w) => /[A-Za-z0-9]/.test(w)).length;
      if (px < 11.99) bad.push(`under 12px (${px}px): "${t.slice(0, 40)}"`);
      else if ((words >= 6 || /[.?!]$/.test(t)) && px < 15.99 * (rootPx / 16) && !el.closest("[data-fine-print]")) bad.push(`sentence at ${px}px: "${t.slice(0, 40)}"`);
    }
  }
  return [...new Set(bad)].slice(0, 8);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const open = async (body, root, width, hash = "") => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route("**/*", (r) => {
    const url = r.request().url();
    if (url.startsWith("http://dash.test/") && !/\/(news-art|logos)\//.test(url)) return r.fulfill({ body: doc(body, root), contentType: "text/html" });
    const m = url.match(/^http:\/\/dash\.test(\/(?:news-art|logos)\/[^?#]+)$/), file = m && path.join("public", decodeURIComponent(m[1]));
    return file && fs.existsSync(file) ? r.fulfill({ path: file }) : r.abort();
  });
  await page.goto(`http://dash.test/${hash}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
};
let failures = 0;
for (const [name, body] of runs) {
  mode = name;
  for (const root of [16, 20]) {
    for (const width of [320, 390, 768, 1024, 1280]) {
      const page = await open(body, root, width);
      const bad = await page.evaluate(probe, CARDS);
      if (bad.length) failures++;
      console.log(`${name} ${width}px @ ${root}px: ${bad.length ? `FAIL ${bad.join("; ")}` : "OK"}`);
      if (SHOTS && root === 16 && (width === 1280 || width === 390)) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `dashboard-${name}-${width}.png`), fullPage: true }); }
      await page.close();
    }
  }
}
// The deep link's anchor: opening #analyser lands on the analyser (the ?symbol=
// scroll itself is DashboardClient's effect, held by check-dashboard-landing).
{
  mode = "full";
  const page = await open(runs[0][1], 16, 1280, "#analyser");
  const top = await page.evaluate(() => document.querySelector("#analyser").getBoundingClientRect().top);
  const ok = Math.abs(top) < 40;
  console.log(`#analyser lands on the analyser: ${ok ? "OK" : `FAIL (its top is ${Math.round(top)} px from the viewport's)`}`);
  if (!ok) failures++;
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.setContent(doc(runs[0][1].replace('<div class="msh-wrap">', '<div class="msh-wrap"><div style="width:700px">x</div>'), 16));
  const caught = (await page.evaluate(probe, CARDS)).some((b) => /scrolls sideways/.test(b));
  console.log(`mutant (a 700 px block): ${caught ? "caught" : "NOT CAUGHT"}`);
  if (!caught) failures++;
  await page.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
