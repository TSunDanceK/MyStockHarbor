// THE INSIGHT POST PAGE IN CHROMIUM (#563 COWORK #132/#133).
//
// Renders the real page (app/insights/[slug]/page.tsx, server markup) with the
// repo's render hooks and stubbed stores (scripts/lib/measure-stubs/: fixture
// daily bars for every symbol, the AAPL fact set, a sector table, a few picker
// flags), for the posts Cowork previews: AMZN, RIOT, BBAI (old format) and the
// new-format fixture. At 320–1280 px, 16 and 20 px roots, it fails when:
//   - the page scrolls sideways, or a block spills out of its card;
//   - reading text (six words or more, or a sentence) is under 16 px outside
//     fine print, or anything is under 12 px;
//   - a section the page always draws is missing (hero, the one setup label,
//     the "Since" strip, the short version once, the chart, the end links);
//   - the summary appears more than once;
//   - (#138/#139) the news card is missing; the JSON-LD has no Article with its
//     image, dates and author, or its breadcrumb is not Insights › TICKER ›
//     post; there is more than one h1; the level discussed is not on the rail's
//     pole (or its marker); the filed tiles show without facts, or hide with them;
//   - (PR 2) the reader vote's three buttons or its fine print are missing;
//   - (#149 §3) a post with an update (AMZN) does not open its body with the
//     "Update · {date}" box, then the chart and news, then "The original post ·
//     {date}" over the short version; a post without one shows either.
// With --shots DIR it saves 1280 and 390 px screenshots. A mutant (a 700 px
// wide block) must be caught as sideways scroll.
//
//   node scripts/measure-insight-page.mjs [--shots DIR]
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
  // secEarningsSnapshot.ts reads it by a relative specifier.
  "./secColdFetch": "scripts/lib/measure-stubs/insight-sec-cold.mjs",
  "@/lib/server/sectorPanels": "scripts/lib/measure-stubs/sector-panels.mjs",
  "@/lib/server/peSectorMedians": "scripts/lib/measure-stubs/pe-sector-medians.mjs",
  "@/lib/server/pickersBuilder": "scripts/lib/measure-stubs/insight-pickers.mjs",
  "@/lib/stock-news-data": "scripts/lib/measure-stubs/insight-news.mjs",
  // Follow the money (#156 §2): AMZN as the top spender, three receivers' lines.
  "@/lib/server/capexSpending": "scripts/lib/measure-stubs/insight-capex.mjs",
  "@/lib/server/capexReceivers": "scripts/lib/measure-stubs/insight-capex.mjs",
});
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
register("./lib/tsx-render-hooks.mjs", import.meta.url);
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const { renderToPipeableStream } = await import("react-dom/server");
const { Writable } = await import("node:stream");
// The whole page, Suspense boundaries resolved (the Screens list streams in, #156): wait for all of it.
const renderAll = (el) => new Promise((resolve, reject) => {
  let html = "";
  const sink = new Writable({ write(chunk, _e, cb) { html += chunk; cb(); } });
  sink.on("finish", () => resolve(html));
  const { pipe } = renderToPipeableStream(el, { onAllReady() { pipe(sink); }, onShellError: reject, onError: reject });
});
const { fixtureBars } = await import("./lib/measure-stubs/fixture-bars.mjs");
const { default: Page } = await import("../app/insights/[slug]/page.tsx");

// Fixture bars to 2 Oct 2026 for every symbol; long enough for the 200-week average.
globalThis.__SPX_BARS = fixtureBars(230, "2021-06-01");
export const SLUGS = ["amzn-daily-ma200-buy-zone-july-2026", "riot-daily-bollinger-accumulation-july-2026", "bbai-daily-bollinger-base-july-2026", "fixture-aapl-new-format"];
const pages = [];
for (const slug of SLUGS) pages.push([slug, await renderAll(await Page({ params: Promise.resolve({ slug }) }))]);

const CSS = fs.readFileSync("app/globals.css", "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
// Which posts have a level discussed, and which symbols have a fact set in the stub (AAPL only).
const FLAGS = { amzn: { level: 1, facts: 0, drivers: 1, update: 1 }, riot: { level: 1, facts: 0, drivers: 0, update: 0 }, bbai: { level: 1, facts: 0, drivers: 0, update: 0 }, fixture: { level: 1, facts: 1, drivers: 0, update: 0 } };
let flags = { level: 0, facts: 0, drivers: 0, update: 0 };
const doc = (body, root) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style><style>html{font-size:${root}px}body{margin:0}</style></head><body data-level="${flags.level}" data-facts="${flags.facts}" data-drivers="${flags.drivers}" data-update="${flags.update}">${body}</body></html>`;

function probe() {
  const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const bad = [];
  const q = (s) => document.querySelector(s);
  for (const [sel, what] of [["[data-insight-hero]", "hero"], ["[data-setup-label]", "setup label"], ["[data-insight-summary]", "short version"], ["[data-insight-chart]", "chart"], [".inEndLinks", "end links"]]) if (!q(sel)) bad.push(`missing: ${what}`);
  const summary = q("[data-insight-summary-text]")?.textContent?.trim() ?? "";
  if (summary && document.querySelector(".inPage").innerText.split(summary).length - 1 > 1) bad.push("the summary appears more than once");
  if (document.documentElement.scrollWidth > innerWidth) {
    const texts = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t; t = tw.nextNode()) { const r = document.createRange(); r.selectNodeContents(t); if ([...r.getClientRects()].some((x) => x.right > innerWidth + 1)) texts.push(`text "${t.textContent.trim().slice(0, 30)}" in ${t.parentElement.className}`); }
    const wide = [...texts, ...document.querySelectorAll("body *")].filter((e) => typeof e === "string" || e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map((e) => typeof e === "string" ? e : `${e.tagName.toLowerCase()}.${typeof e.className === "string" ? e.className.split(" ")[0] : ""}[${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}] ${e.textContent.trim().slice(0, 25)}`);
    bad.push(`scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth}: ${wide.join(", ")})`);
  }
  // #138/#139: the news card; the Article JSON-LD (image, dateModified, a 3-step breadcrumb); the rail's
  // pole with the level discussed drawn (or its marker); filed tiles, or "not available yet" without facts.
  if (!q("[data-insight-news]")) bad.push("missing: news card");
  // PR 2: the reader vote, three buttons and its fine print, with no tally in the HTML.
  if ((document.querySelectorAll("[data-insight-vote] .inVoteBtn").length !== 3) || !q("[data-insight-vote-card] [data-fine-print]")) bad.push("missing: the reader vote");
  // #146: the dated paragraph and its sources when the post has one, the old layout when not; never more than 3 headlines.
  if (document.body.dataset.drivers === "1" ? !q("[data-insight-drivers]") || !/^As of \d/.test(q("[data-insight-drivers-asof]")?.textContent ?? "") || !q('[data-insight-news] a[rel="nofollow noopener"]') : !!q("[data-insight-drivers]")) bad.push("the drivers paragraph shown / hidden wrongly");
  if (document.querySelectorAll("[data-insight-news] .inNews li").length > 3) bad.push("more than 3 headlines");
  // #149 §3: the update box first, then the live cards, then the original post under its dated heading.
  if (document.body.dataset.update === "1") {
    const main = q(".inMain"), top = (s) => q(s)?.getBoundingClientRect().top ?? NaN;
    const order = [top("[data-insight-update]"), top("[data-insight-chart]"), top("[data-insight-news]"), top("[data-insight-original]"), top("[data-insight-summary]")];
    if (main?.firstElementChild !== q("[data-insight-update]") || !order.every((v, i) => i === 0 || v > order[i - 1])) bad.push("update box, live cards, original post: wrong order");
    if (!/^Update · \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(q("[data-insight-update] .inEyebrow")?.textContent ?? "")) bad.push("the update box has no dated label");
    if (!/^The original post · \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(q("[data-insight-original] > h2")?.textContent ?? "") || !q("[data-insight-original] [data-insight-summary]")) bad.push("the original post is not under its dated heading");
  } else if (q("[data-insight-update], [data-insight-original]")) bad.push("an update box on a post without one");
  try {
    const ld = JSON.parse(q('script[type="application/ld+json"]')?.textContent ?? "{}")["@graph"] ?? [];
    const art = ld.find((x) => x["@type"] === "Article"), crumbs = ld.find((x) => x["@type"] === "BreadcrumbList");
    if (!art || !art.image?.length || !art.dateModified || !art.datePublished || art.author?.name !== "MyStockHarbor") bad.push("JSON-LD: no Article with image, dates and author");
    if (crumbs?.itemListElement?.map((i) => i.name)[0] !== "Insights" || crumbs.itemListElement.length !== 3) bad.push("JSON-LD: breadcrumb is not Insights › TICKER › post");
  } catch { bad.push("JSON-LD does not parse"); }
  if (document.querySelectorAll("h1").length !== 1) bad.push(`${document.querySelectorAll("h1").length} h1s`);
  if (q("[data-insight-levels]") && !q('.klTick[data-discussed], [data-discussed-off]') && document.body.dataset.level === "1") bad.push("the level discussed is not on the pole");
  const tiles = q("[data-insight-earnings] .inTile"), none = q("[data-insight-no-facts]");
  if (document.body.dataset.facts === "1" ? !tiles || none : tiles || !none) bad.push("filed tiles shown / hidden wrongly for this symbol's facts");
  for (const card of document.querySelectorAll(".inOriginal, .inCard, .inStat, .inMoreCard, .inSince, .klCard")) {
    const c = card.getBoundingClientRect();
    for (const el of card.querySelectorAll("*")) {
      if (!vis(el) || el.closest("svg") || el.closest("details:not([open])")) continue;
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > c.right + 1 || r.left < c.left - 1)) { bad.push(`spills out of its card: ${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().slice(0, 30)}"`); break; }
    }
  }
  const walk = document.createTreeWalker(document.querySelector(".inPage"), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = n.textContent.replace(/\s+/g, " ").trim(), el = n.parentElement;
    if (!t || el.closest("style,script,title,svg,details:not([open])") || !vis(el)) continue;
    const px = parseFloat(getComputedStyle(el).fontSize), words = t.split(" ").filter((w) => /[A-Za-z0-9]/.test(w)).length;
    if (px < 11.99) bad.push(`under 12px (${px}px): "${t.slice(0, 40)}"`);
    else if ((words >= 6 || /[.?!]$/.test(t)) && px < 15.99 * (parseFloat(getComputedStyle(document.documentElement).fontSize) / 16) && !el.closest("[data-fine-print]")) bad.push(`sentence at ${px}px: "${t.slice(0, 40)}"`);
  }
  return [...new Set(bad)].slice(0, 8);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
let failures = 0;
for (const [slug, body] of pages) {
  flags = FLAGS[slug.split("-")[0]];
  for (const root of [16, 20]) {
    for (const width of [320, 390, 768, 1024, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      // The site's own images from public/ (art, logos); nothing else reaches the network.
      await page.route("**/*", (r) => {
        const url = r.request().url();
        if (url === "http://insight.test/") return r.fulfill({ body: doc(body, root), contentType: "text/html" });
        const m = url.match(/^http:\/\/insight\.test(\/(?:news-art|logos)\/[^?#]+)$/), file = m && path.join("public", decodeURIComponent(m[1]));
        return file && fs.existsSync(file) ? r.fulfill({ path: file }) : r.abort();
      });
      await page.goto("http://insight.test/");
      await page.waitForLoadState("networkidle").catch(() => {});
      const bad = await page.evaluate(probe);
      if (bad.length) failures++;
      console.log(`${slug} ${width}px @ ${root}px: ${bad.length ? `FAIL ${bad.join("; ")}` : "OK"}`);
      if (SHOTS && root === 16 && (width === 1280 || width === 390)) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `insight-${slug.split("-")[0]}-${width}.png`), fullPage: true }); }
      await page.close();
    }
  }
}
{
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.setContent(doc(pages[0][1].replace('<div class="inWrap">', '<div class="inWrap"><div style="width:700px">x</div>'), 16));
  const caught = (await page.evaluate(probe)).some((b) => /scrolls sideways/.test(b));
  console.log(`mutant (a 700 px block): ${caught ? "caught" : "NOT CAUGHT"}`);
  if (!caught) failures++;
  await page.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
