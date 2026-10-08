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
//     then the analyser;
//   - (#154) the capex hub (where the card is wide enough to draw it) is off the middle row, or its label wraps or crowds
//     a bar; an earnings row wraps or a long name has no ellipsis; the insight
//     card does not show 2 posts at 1024 px and up and 1 below; the analyser
//     tabs wrap at 480 px and under (and at 390 px need scrolling).
// The news thumbnails (#149 §2) must draw 56–64 px square, left of their
// headline, at every width. And "/" (#149 §1), rendered from app/page.tsx and
// opened at 390 px with a phone's user agent, must be this same landing: its
// H1, its cards and the analyser, with no old tile page.
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
const { default: RootPage } = await import("../app/page.tsx");

globalThis.__SPX_BARS = fixtureBars(260, "2021-06-01");
const render = async () => renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ symbol: "TSLA" }) }));
const runs = [["full", await render()]];
// "/" returns the JSON-LD and <DashboardPage /> (a server component): resolve that child, as Next would.
const rootTree = await RootPage({ searchParams: Promise.resolve({}) });
const { createElement, Fragment } = await import("react");
const rootKids = await Promise.all([].concat(rootTree.props.children).map(async (c) => (c && c.type === Page ? Page(c.props) : c)));
const rootHtml = renderToStaticMarkup(createElement(Fragment, null, ...rootKids));
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
  // #149 §2: each news thumbnail 56–64 px square, left of its headline.
  for (const row of document.querySelectorAll(".dlNewsRow")) {
    const t = row.querySelector("[data-news-thumb]")?.getBoundingClientRect(), a = row.querySelector("a")?.getBoundingClientRect();
    if (!t || !a) { bad.push("a news item has no thumbnail"); break; }
    if (t.width < 56 || t.width > 64 || Math.abs(t.width - t.height) > 1 || t.right > a.left) { bad.push(`news thumbnail ${Math.round(t.width)}x${Math.round(t.height)}, or not left of its headline`); break; }
  }
  // #154 §1: the hub on the middle spender row's centre; the label under it, one line, clear of the bars.
  // Stacked (no hub drawn): no lines either, and the label sits between the two lists.
  if (!empty && q(".dlCxHub") && !vis(q(".dlCxHub")) && q(".dlCxLines") && vis(q(".dlCxLines"))) bad.push("the stacked capex chart still draws the star's lines");
  // (A card too narrow for the star, a phone or a large text size, stacks it: the hub is not drawn.)
  if (!empty && q(".dlCxHub") && vis(q(".dlCxHub"))) {
    const hub = q(".dlCxHub")?.getBoundingClientRect(), mid = document.querySelectorAll('[data-side="spend"] .dlCxRow')[1]?.getBoundingClientRect();
    const label = q(".dlCxNodeLabel")?.getBoundingClientRect();
    if (!hub || !mid || Math.abs((hub.top + hub.height / 2) - (mid.top + mid.height / 2)) > 2) bad.push(`the hub is not on the middle row (${hub ? Math.round(hub.top + hub.height / 2) : "?"} vs ${mid ? Math.round(mid.top + mid.height / 2) : "?"})`);
    if (!label || !hub || label.top < hub.bottom || label.height > 26) bad.push("the hub label is not one line under the hub");
    for (const r of document.querySelectorAll(".dlCxRow")) { const b = r.getBoundingClientRect(); if (label && label.right > b.left && label.left < b.right && label.bottom > b.top && label.top < b.bottom) { bad.push("the hub label crowds a bar"); break; } }
  }
  // #154 §2: each earnings row on one line; a long name ends in an ellipsis.
  if (!empty) {
    for (const r of document.querySelectorAll(".dlEarnRow")) {
      // #163: no date beside the name any more; the name is the row's last item.
      const co = r.querySelector(".dlEarnCo"), tk = r.querySelector("strong");
      if (!co || !tk || co.getBoundingClientRect().height > parseFloat(getComputedStyle(co).fontSize) * 1.6 || Math.abs(co.getBoundingClientRect().top - tk.getBoundingClientRect().top) > 8) { bad.push(`an earnings row wraps: ${r.textContent.trim().slice(0, 30)}`); break; }
    }
    // #163 gave the name the row's freed width, so a long name may now fit; one that does not must end in an ellipsis.
    const cut = [...document.querySelectorAll(".dlEarnCo")].find((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis");
    if (cut) bad.push(`a company name is cut off without an ellipsis: ${cut.textContent.slice(0, 30)}`);
  }
  // #154 §4: two posts at 1024 px and up, one below.
  if (!empty) {
    const shown = [...document.querySelectorAll(".dlInsight")].filter(vis).length;
    if (shown !== (innerWidth >= 1024 ? 2 : 1)) bad.push(`${shown} insight posts shown at ${innerWidth}px`);
  }
  // #154 §5, #161: the analyser's icon tabs on one line at every width, never the page sideways.
  {
    const tabs = [...document.querySelectorAll(".dlTab")].filter(vis).map((t) => t.getBoundingClientRect());
    if (tabs.length !== 5 || tabs.some((t) => Math.abs(t.top - tabs[0].top) > 1)) bad.push("the analyser tabs wrap onto two lines");
    const strip = [...document.querySelectorAll(".dlTabs")].find(vis);
    if (innerWidth >= 390 && strip && strip.scrollWidth > strip.clientWidth + 1) bad.push(`the tabs need scrolling at ${innerWidth}px`);
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
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const open = async (body, root, width, hash = "", userAgent = undefined) => {
  const page = await browser.newPage({ viewport: { width, height: 900 }, userAgent, isMobile: !!userAgent, hasTouch: !!userAgent });
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
      if (SHOTS && root === 16 && (width === 1280 || width === 390)) {
        // Lazy logos load only once scrolled near: walk the page first, as a reader would.
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } scrollTo(0, 0); });
        await page.waitForLoadState("networkidle").catch(() => {});
        fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `dashboard-${name}-${width}.png`), fullPage: true });
      }
      await page.close();
    }
  }
}
// "/" on a phone (#149 §1): the same landing, H1 and all, not the old tile page.
{
  mode = "full";
  const page = await open(rootHtml, 16, 390, "", IPHONE);
  const bad = await page.evaluate(probe, CARDS);
  const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent ?? "");
  const ld = /"@type":"WebApplication"/.test(rootHtml);
  const ok = !bad.length && h1 === "Stock research from the filings, not the hype." && ld && !/msh-mobile-home|MobileHomePage/.test(rootHtml);
  console.log(`"/" at 390px, phone UA: ${ok ? `OK (h1 "${h1}")` : `FAIL h1 "${h1}"${ld ? "" : ", no structured data"}; ${bad.join("; ")}`}`);
  if (!ok) failures++;
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, "root-phone-390.png"), fullPage: false }); }
  await page.close();
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
