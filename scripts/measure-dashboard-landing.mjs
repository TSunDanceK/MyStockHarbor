// THE DASHBOARD LANDING IN CHROMIUM (#563 COWORK #134; v2, #164).
//
// Renders the real /dashboard (app/dashboard/page.tsx, server markup) with the
// repo's render hooks and stubbed reads (scripts/lib/measure-stubs/: the
// landing's data filled, or all missing with MEASURE_LANDING=empty; a fixture
// quote; daily bars for every symbol), for ?symbol=TSLA. At 1280, 1024, 768,
// 640, 390 and 320 px, 16 and 20 px roots, it fails when:
//   - the page scrolls sideways, or a block spills out of its card or feature;
//   - reading text (six words or more, or a sentence) is under 16 px outside
//     fine print, or anything is under 12 px;
//   - there is not exactly one h1, or it is not the hero's;
//   - (#164 A) "Market today" lacks its four index tiles (one row; 2 × 2 at
//     560 px and under), or the ticker tape or the "Market Benchmarks" row is back;
//   - (#164 B) the two open features are missing or sit in a card (a border or
//     a background), or a card is missing, or (empty run) shows no empty state;
//   - (#164 B, C) at 1280 px the cards in a row differ in height by more than
//     4 px, or their footer links do not line up;
//   - (#164 C) a week lists other than 3 companies, the insight card shows other
//     than one featured post (plus its "Also:" row), a headline wraps, or a
//     thumbnail is not a 40–48 px square left of its headline;
//   - (#164 D) the analyser card is missing; the tabs wrap or (at 390 px) need
//     scrolling; the icon is not beside its label at 641 px and up, or not over
//     it at 640 px and under; the Breakdown is open on arrival;
//   - at 560 px and under the order is not hero, Market today, Only on
//     MyStockHarbor, This week, then the analyser;
//   - (#154) the capex hub, drawn, is off the middle row or its label wraps or
//     crowds a bar; an earnings name is cut off without an ellipsis.
// "/" (#149 §1), rendered from app/page.tsx and opened at 390 px with a phone's
// user agent, must be this same landing. With --shots DIR it saves 1280 and 390 px
// screenshots. A mutant (a 700 px wide block) must be caught as sideways scroll.
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

function probe() {
  const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const bad = [];
  const q = (s) => document.querySelector(s);
  const empty = document.body.dataset.mode === "empty";
  for (const [sel, what] of [["[data-landing]", "hero"], ["[data-market-now]", "Market today"], ['[data-section="only"]', "Only on MyStockHarbor"], ['[data-section="week"]', "This week"], ["#analyser", "the analyser"], ["[data-analyser-card]", "the analyser card"], ["[data-verdict]", "the verdict line"], [".dlTabs", "the analyser's tabs"]]) if (!q(sel)) bad.push(`missing: ${what}`);
  for (const c of ["pickers", "sectors", "earnings", "insight", "news"]) {
    const el = q(`[data-card="${c}"]`);
    if (!el) bad.push(`missing card: ${c}`);
    else if (empty !== el.hasAttribute("data-empty")) bad.push(`card ${c}: ${empty ? "no empty state" : "shows its empty state"}`);
  }
  // #164 B: two OPEN features, on the page background (no border, no background of their own).
  for (const o of ["hub", "capex"]) {
    const el = q(`[data-open="${o}"]`);
    if (!el) { bad.push(`missing feature: ${o}`); continue; }
    const cs = getComputedStyle(el);
    if (el.closest(".dlCard") || parseFloat(cs.borderTopWidth) > 0 || (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") || cs.backgroundImage !== "none") bad.push(`the ${o} feature sits in a card`);
    if (empty && !el.querySelector(`[data-card="${o}"][data-empty]`)) bad.push(`feature ${o}: no empty state`);
  }
  const row = q("[data-open-row]");
  if (row && !(parseFloat(getComputedStyle(row).borderBottomWidth) > 0)) bad.push("no divider under the open features");
  const h1s = document.querySelectorAll("h1");
  if (h1s.length !== 1 || !h1s[0].closest("[data-landing]")) bad.push(`${h1s.length} h1s, or not the hero's`);
  if (document.documentElement.scrollWidth > innerWidth) {
    const wide = [...document.querySelectorAll("body *")].filter((e) => vis(e) && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3)
      .map((e) => `${e.tagName.toLowerCase()}.${typeof e.className === "string" ? e.className.split(" ")[0] : ""}[${Math.round(e.getBoundingClientRect().right)}] ${e.textContent.trim().slice(0, 25)}`);
    bad.push(`scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth}: ${wide.join(", ")})`);
  }
  for (const card of document.querySelectorAll(".dlCard, .dlIdxTile, .dlHeroLeft, .dlWeek, .dlMarket, .dlOpen, [data-analyser-card]")) {
    const c = card.getBoundingClientRect();
    for (const el of card.querySelectorAll("*")) {
      // The tab strip scrolls inside itself at 480 px and under (#154 §5): its tabs may run past it; the strip may not.
      if (!vis(el) || el.closest("svg") || el.closest('[role="listbox"]') || el.parentElement?.closest(".dlTabs")) continue;
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > c.right + 1 || r.left < c.left - 1)) { bad.push(`spills out of its card: ${el.tagName.toLowerCase()}.${typeof el.className === "string" ? el.className : ""} "${el.textContent.trim().slice(0, 30)}"`); break; }
    }
  }
  // #164 A: the ticker tape and the "Market Benchmarks" row are gone; the index row is in Market today.
  if ([...document.querySelectorAll("body *")].some((e) => e.children.length === 0 && /^(Market Benchmarks|Crypto Benchmarks)$/.test(e.textContent.trim()))) bad.push("the Market Benchmarks row is back");
  if (/\b(sell|buy) signals?\b/i.test(document.body.textContent)) bad.push("signal wording on the page (the ticker tape?)");
  if (!empty) {
    const tiles = [...document.querySelectorAll("[data-index-row] .dlIdxTile")].filter(vis).map((t) => t.getBoundingClientRect());
    const rowsOf = new Set(tiles.map((t) => Math.round(t.top))).size;
    if (tiles.length !== 4 || rowsOf !== (innerWidth <= 560 ? 2 : 1)) bad.push(`index row: ${tiles.length} tiles on ${rowsOf} rows`);
    if (!q("[data-market-line]")) bad.push("no trend / best-sector line");
  }
  // #164 B, C: equal heights in a row, footers aligned (where the cards sit side by side).
  if (innerWidth >= 1024) {
    for (const r of document.querySelectorAll("[data-row]")) {
      const cs = [...r.children].filter(vis).map((c) => ({ box: c.getBoundingClientRect(), more: c.querySelector(".dlMore")?.getBoundingClientRect() }));
      const tops = new Set(cs.map((c) => Math.round(c.box.top)));
      if (tops.size !== 1) continue;
      const hs = cs.map((c) => c.box.height);
      if (Math.max(...hs) - Math.min(...hs) > 4) bad.push(`row ${r.dataset.row}: card heights ${hs.map(Math.round).join("/")}`);
      const fb = cs.map((c) => c.more?.bottom ?? NaN);
      if (Math.max(...fb) - Math.min(...fb) > 4) bad.push(`row ${r.dataset.row}: footers not aligned (${fb.map(Math.round).join("/")})`);
    }
  }
  // #164 C: each news row's thumbnail (or logo) a 40–48 px square, left of its one-line headline.
  for (const r of document.querySelectorAll(".dlNewsRow")) {
    const t = r.querySelector("[data-news-thumb]")?.getBoundingClientRect(), a = r.querySelector(".dlNewsTitle");
    if (!t || !a) { bad.push("a headline has no thumbnail"); break; }
    const ab = a.getBoundingClientRect();
    if (t.width < 40 || t.width > 48 || Math.abs(t.width - t.height) > 1 || t.right > ab.left) { bad.push(`news thumbnail ${Math.round(t.width)}x${Math.round(t.height)}, or not left of its headline`); break; }
    if (ab.height > parseFloat(getComputedStyle(a).fontSize) * 1.7 || getComputedStyle(a).textOverflow !== "ellipsis") { bad.push(`a headline wraps or has no ellipsis: ${a.textContent.slice(0, 30)}`); break; }
  }
  if (!empty) {
    const newsRows = document.querySelectorAll(".dlNewsRow").length;
    if (newsRows !== 4) bad.push(`${newsRows} headlines`);
    const weeks = [...document.querySelectorAll("[data-week]")].map((w) => w.querySelectorAll("[data-earn-row]").length);
    if (weeks.length !== 2 || weeks.some((n) => n !== 3)) bad.push(`earnings rows per week: ${weeks.join("+")}`);
    const posts = [...document.querySelectorAll("[data-insight-post]")].filter(vis).length;
    if (posts !== 1 || !q("[data-insight-also]")) bad.push(`${posts} featured insight posts, or no "Also:" row`);
    for (const r of document.querySelectorAll(".dlEarnRow")) {
      const co = r.querySelector(".dlEarnCo"), tk = r.querySelector("strong");
      if (!co || !tk || co.getBoundingClientRect().height > parseFloat(getComputedStyle(co).fontSize) * 1.6 || Math.abs(co.getBoundingClientRect().top - tk.getBoundingClientRect().top) > 8) { bad.push(`an earnings row wraps: ${r.textContent.trim().slice(0, 30)}`); break; }
    }
    const cut = [...document.querySelectorAll(".dlEarnCo")].find((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis");
    if (cut) bad.push(`a company name is cut off without an ellipsis: ${cut.textContent.slice(0, 30)}`);
  }
  // #154 §1: the capex hub on the middle spender row's centre; the label under it, one line, clear of the bars.
  if (!empty && q(".dlCxHub") && !vis(q(".dlCxHub")) && q(".dlCxLines") && vis(q(".dlCxLines"))) bad.push("the stacked capex chart still draws the star's lines");
  if (!empty && q(".dlCxHub") && vis(q(".dlCxHub"))) {
    const hub = q(".dlCxHub")?.getBoundingClientRect(), mid = document.querySelectorAll('[data-side="spend"] .dlCxRow')[1]?.getBoundingClientRect();
    const label = q(".dlCxNodeLabel")?.getBoundingClientRect();
    if (!hub || !mid || Math.abs((hub.top + hub.height / 2) - (mid.top + mid.height / 2)) > 2) bad.push(`the hub is not on the middle row (${hub ? Math.round(hub.top + hub.height / 2) : "?"} vs ${mid ? Math.round(mid.top + mid.height / 2) : "?"})`);
    if (!label || !hub || label.top < hub.bottom || label.height > 26) bad.push("the hub label is not one line under the hub");
    for (const r of document.querySelectorAll(".dlCxRow")) { const b = r.getBoundingClientRect(); if (label && label.right > b.left && label.left < b.right && label.bottom > b.top && label.top < b.bottom) { bad.push("the hub label crowds a bar"); break; } }
  }
  // #164 D: the tabs on one line; icon beside its label at 641 px and up, over it at 640 and under.
  {
    const tabs = [...document.querySelectorAll(".dlTab")].filter(vis);
    const boxes = tabs.map((t) => t.getBoundingClientRect());
    if (boxes.length !== 5 || boxes.some((t) => Math.abs(t.top - boxes[0].top) > 1)) bad.push("the analyser tabs wrap onto two lines");
    const strip = [...document.querySelectorAll(".dlTabs")].find(vis);
    if (innerWidth >= 390 && strip && strip.scrollWidth > strip.clientWidth + 1) bad.push(`the tabs need scrolling at ${innerWidth}px`);
    const t0 = tabs[0], ic = t0?.querySelector(".dlTabIcon")?.getBoundingClientRect(), lb = t0?.querySelector(".dlTabShort")?.getBoundingClientRect();
    if (ic && lb) {
      const beside = ic.right <= lb.left + 1 && Math.abs((ic.top + ic.height / 2) - (lb.top + lb.height / 2)) < 4;
      const over = ic.bottom <= lb.top + 1;
      if (innerWidth >= 641 ? !beside : !over) bad.push(`tab icon ${innerWidth >= 641 ? "not beside" : "not over"} its label at ${innerWidth}px`);
    }
  }
  const bds = [...document.querySelectorAll("[data-breakdown]")].filter(vis);
  if (!bds.length || bds.some((b) => b.dataset.breakdown !== "collapsed")) bad.push("the Breakdown is not collapsed on arrival");
  // At 560 px and under: hero, Market today, Only on, This week, then the analyser.
  if (innerWidth <= 560) {
    const top = (s) => q(s)?.getBoundingClientRect().top ?? NaN;
    const order = [top(".dlHeroLeft"), top("[data-market-now]"), top('[data-section="only"]'), top('[data-section="week"]'), top("#analyser")];
    if (!order.every((v, i) => i === 0 || v > order[i - 1])) bad.push(`mobile order is not hero, market, only, week, analyser (${order.map(Math.round).join(", ")})`);
  }
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  for (const scope of document.querySelectorAll("[data-landing], [data-section], .dlAnalyserHead, [data-analyser-links]")) {
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
    for (const width of [320, 390, 640, 768, 1024, 1280]) {
      const page = await open(body, root, width);
      const bad = await page.evaluate(probe);
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
  const bad = await page.evaluate(probe);
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
  const caught = (await page.evaluate(probe)).some((b) => /scrolls sideways/.test(b));
  console.log(`mutant (a 700 px block): ${caught ? "caught" : "NOT CAUGHT"}`);
  if (!caught) failures++;
  await page.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
