// READING TEXT AT READING SIZE, MEASURED IN A REAL BROWSER (#563 COWORK #100/#101).
//
// The owner's floor: anything meant to be READ is at least the earnings page's
// "Investor read" bullet, 16px with a 1.65 line height (the --fs-read token,
// 1rem). Titles may be larger; labels sit at --fs-label (13px); only fine print
// nobody needs to read (data credits, "as of" stamps, disclaimers, axis ticks)
// may use --fs-fine (12px), and nothing goes below 12px.
//
// Renders the real components with fixture data (no Redis, no network:
// scripts/lib/tsx-render-hooks.mjs and scripts/lib/measure-stubs/):
//   /stock/AAPL     StockSymbolPageClient, with fixture bars, quote and the
//                   AAPL earnings snapshot built from SEC's own figures
//   /markets/spx    the SPX server page, with fixture SPY bars and a fixture
//                   Market Mood series
//   /stock/AAPL/earnings   A's page, ENFORCED since A's PR (#552 COWORK #153),
//                   rendered from the committed AAPL fact-set fixture
//                   (measure-stubs/sec-cold-fetch.mjs)
// and checks each at 390 and 1280 px (and 320–430 px for sideways scroll and
// content spilling out of its card). FAILS when a visible text node of six
// words or more, or one ending in . ? !, computes under 16px outside an
// element marked data-fine-print; or when any visible text computes under
// 12px. Then the root is set to 20px (a large-text browser setting): reading
// text must compute at 20px or more, proving the sizes are rem, not px. A
// mutant forces one sentence to 14px and must be caught.
//
// Prints the words-by-size table for each page (the PR's before/after).
//
//   node scripts/measure-reading-size.mjs [--shots DIR]
//
// NOT IN check-all: it needs Chromium and Playwright (installed globally in the sandbox).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { register } from "node:module";

const ROOT = process.cwd();
const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? path.resolve(process.argv[i + 1]) : null; })();
process.env.MEASURE_STUBS = JSON.stringify({
  "@/lib/server/historyCache": "scripts/lib/measure-stubs/history-cache.mjs",
  "@/lib/server/marketData/read": "scripts/lib/measure-stubs/tiingo-read.mjs",
  "@/lib/server/marketMoodRead": "scripts/lib/measure-stubs/mood-read.mjs",
  "@/lib/server/secColdFetch": "scripts/lib/measure-stubs/sec-cold-fetch.mjs",
});
process.env.PRICE_PROVIDER_SPX = "tiingo";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
register("./lib/tsx-render-hooks.mjs", import.meta.url);

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");

// ── the pages ───────────────────────────────────────────────────────────────
async function stockPage() {
  const { default: Client } = await import("../app/stock/[symbol]/StockSymbolPageClient.tsx");
  const { performanceStrip } = await import("../lib/ta/performance.ts");
  const { fixtureBars } = await import("./lib/measure-stubs/fixture-bars.mjs");
  const bars = fixtureBars(230, "2025-01-02").map(([date, open, high, low, close, volume]) => ({ date, open, high, low, close, volume }));
  const spy = fixtureBars(560, "2025-01-02").map(([date, open, high, low, close, volume]) => ({ date, open, high, low, close, volume }));
  const last = bars[bars.length - 1];
  const earningsSnapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fixtures/measure-earnings-snapshot-AAPL.json"), "utf8"));
  return renderToStaticMarkup(React.createElement(Client, {
    symbol: "AAPL",
    earningsSnapshot,
    profile: { description: "Apple designs, makes and sells smartphones, personal computers, tablets, wearables and accessories, and sells a range of related services. ".repeat(3), sector: "Technology", industry: "Consumer Electronics", marketCap: 3.2e12, exchange: "NASDAQ", country: "US" },
    dividend: { state: "hidden", why: "none" },
    shareHistory: null,
    valuation: null,
    initialHistory: bars,
    initialQuote: { price: last.close, change: 1.2, changePercentage: 0.4, dayLow: last.low, dayHigh: last.high, volume: 5e7, avgVolume: 4.5e7, yearLow: 180, yearHigh: 260 },
    historyProvider: "tiingo",
    performance: performanceStrip(bars, spy),
    strength: await strengthFixture(bars, spy, earningsSnapshot),
    renderedAt: Date.parse("2026-10-04T12:00:00Z"),
  }));
}
/** The strength badge (#563 COWORK #105), scored as the page scores it. */
async function strengthFixture(bars, spy, snapshot) {
  const { strengthBadge } = await import("../lib/strengthBadge.ts");
  const { earningsBadgeInput } = await import("../lib/earningsBadge.ts");
  return strengthBadge(bars, spy, earningsBadgeInput(snapshot));
}
/** The badge's tap note, open (static markup can't tap): its panel and body as the page draws them. */
async function strengthNote() {
  const { NotePanel } = await import("../app/stock/[symbol]/TapNote.tsx");
  const { StrengthNoteBody } = await import("../app/stock/[symbol]/StrengthBadge.tsx");
  const { fixtureBars } = await import("./lib/measure-stubs/fixture-bars.mjs");
  const toBar = ([date, open, high, low, close, volume]) => ({ date, open, high, low, close, volume });
  const badge = await strengthFixture(fixtureBars(300, "2025-01-02").map(toBar), fixtureBars(560, "2025-01-02").map(toBar), null);
  const note = { id: "sn", open: true, owner: {}, toggle() {}, close() {} };
  const credit = React.createElement("a", { href: "#" }, "Daily prices from Tiingo");
  return renderToStaticMarkup(React.createElement("main", { style: { padding: 16 } },
    React.createElement("section", null, React.createElement(NotePanel, { note, label: "Strength", mode: "inline" }, React.createElement(StrengthNoteBody, { badge, credit })))));
}
/** The Performance card's tap note, open (static markup can't tap), with the card's own body (#563 COWORK #111). */
async function performanceNote() {
  const { NotePanel } = await import("../app/stock/[symbol]/TapNote.tsx");
  const { performanceStrip } = await import("../lib/ta/performance.ts");
  const { performanceCard } = await import("../lib/ta/performanceCard.ts");
  const { fixtureBars } = await import("./lib/measure-stubs/fixture-bars.mjs");
  const toBar = ([date, open, high, low, close, volume]) => ({ date, open, high, low, close, volume });
  const c = performanceCard(performanceStrip(fixtureBars(230, "2025-01-02").map(toBar), fixtureBars(560, "2025-01-02").map(toBar)));
  const note = { id: "pn", open: true, owner: {}, toggle() {}, close() {} };
  return renderToStaticMarkup(React.createElement("main", { style: { padding: 16 } },
    React.createElement("section", null, React.createElement(NotePanel, { note, label: "How these are measured", mode: "inline" },
      React.createElement("div", { className: "pcNote", style: { fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)" } }, c.note.map((t) => React.createElement("p", { key: t, style: { margin: "0 0 6px" } }, t)))))));
}
/** The capex page's "Why follow the money?" card (#563 COWORK #110), in the page's card frame; `open` taps "How to use this page". */
async function capexWhy(open) {
  const { default: Why } = await import("../app/bottlenecks/capex/WhyFollowMoney.tsx");
  const css = ".capexCard{border:1px solid rgba(255,255,255,.08);border-radius:22px;padding:18px}.capexCard h3{margin:6px 0 0 0;font-size:18px}.cardEyebrow{font-size:12px;font-weight:950;text-transform:uppercase}";
  const html = renderToStaticMarkup(React.createElement("main", { style: { padding: 16 } }, React.createElement("style", null, css), React.createElement("aside", null, React.createElement(Why))));
  return open ? html.replace("<details ", "<details open ") : html;
}
async function spxPage() {
  const { default: Page } = await import("../app/markets/spx/page.tsx");
  return renderToStaticMarkup(await Page());
}
async function earningsPage() {
  const { default: Page } = await import("../app/stock/[symbol]/earnings/page.tsx");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ symbol: "AAPL" }) }));
}

const PAGES = [
  { name: "/stock/AAPL", render: stockPage, enforce: true },
  { name: "/markets/spx", render: spxPage, enforce: true },
  { name: "/stock/AAPL/earnings", render: earningsPage, enforce: true },
  { name: "/stock/AAPL strength note (open)", render: strengthNote, enforce: true },
  { name: "/stock/AAPL performance note (open)", render: performanceNote, enforce: true },
  { name: "/bottlenecks/capex why card", render: () => capexWhy(false), enforce: true },
  { name: "/bottlenecks/capex why card (How to use, open)", render: () => capexWhy(true), enforce: true },
];

// ── the browser pass ────────────────────────────────────────────────────────
const CSS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8").replace(/@import[^;]*;|@tailwind[^;]*;|@theme inline \{[^}]*\}/g, "");
const doc = (body, extraCss = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style><style>${extraCss}</style></head><body>${body}</body></html>`;

/** In the page: every visible text node under <main>, with its computed size and whether it is fine print. */
function scan() {
  const out = [];
  const walk = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || el.closest("script,style,noscript,[aria-hidden='true'] svg")) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const words = text.split(" ").filter((w) => /[A-Za-z0-9]/.test(w)).length;
    out.push({ text: text.slice(0, 90), px: parseFloat(cs.fontSize), words, sentence: words >= 6 || /[.?!]$/.test(text), fine: !!el.closest("[data-fine-print]"), a: el.closest("[data-reading-owner]")?.getAttribute("data-reading-owner") === "a", where: (el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : el.tagName.toLowerCase()) });
  }
  return out;
}

/** Every node is judged; A's components (data-reading-owner="a") are enforced since A's PR (#552 COWORK #153). */
function judge(nodes, readMin = 16, floor = 12) {
  const bad = [];
  for (const x of nodes) {
    if (x.px < floor - 0.01) bad.push(`under ${floor}px (${x.px}px): "${x.text}" ${x.where}`);
    else if (x.sentence && !x.fine && x.px < readMin - 0.01) bad.push(`sentence under ${readMin}px (${x.px}px): "${x.text}" ${x.where}`);
  }
  return bad;
}
function table(nodes) {
  const by = new Map();
  for (const x of nodes) by.set(Math.round(x.px), (by.get(Math.round(x.px)) ?? 0) + x.words);
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  const under = [...by.entries()].filter(([px]) => px < 16).reduce((a, [, w]) => a + w, 0);
  return `${total} words, ${total ? Math.round((under / total) * 100) : 0}% under 16px · ${[...by.entries()].sort((a, b) => a[0] - b[0]).map(([px, w]) => `${px}px: ${w}`).join(" · ")}`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
for (const pg of PAGES) {
  let html;
  try { html = await pg.render(); } catch (e) {
    console.log(`\n${pg.name}: not rendered offline (${String(e?.message ?? e).split("\n")[0].slice(0, 140)})${pg.enforce ? " — FAIL" : " — report-only"}`);
    if (pg.enforce) failures++;
    continue;
  }
  console.log(`\n${pg.name}${pg.enforce ? "" : " (report-only until A's PR, #552 COWORK #153)"}`);
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(doc(html));
    const nodes = await page.evaluate(scan);
    const bad = judge(nodes);
    const aPending = judge(nodes.map((x) => ({ ...x, a: false }))).length - bad.length;
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    console.log(`  ${width}px: ${table(nodes)}${scrolls ? " · SCROLLS SIDEWAYS" : ""}${aPending ? ` · ${aPending} in A's components (report-only)` : ""}`);
    for (const b of (process.env.ALL ? bad : bad.slice(0, 40))) console.log(`    ${pg.enforce ? "FAIL" : "note"}  ${b}`);
    if (bad.length > 40) console.log(`    … and ${bad.length - 40} more`);
    if (pg.enforce && (bad.length || scrolls)) failures++;
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `reading-size-${pg.name.replace(/\W+/g, "-").replace(/^-|-$/g, "")}-${width}.png`), fullPage: true });
    await page.close();
  }
  // Taller text must not push anything sideways at phone widths, nor out of its card.
  for (const width of [320, 360, 414, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(doc(html));
    const r = await page.evaluate(() => ({
      scrolls: document.documentElement.scrollWidth > innerWidth,
      spill: [...document.querySelectorAll("main section, main aside, main .sp-slot")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== "auto").map((e) => {
        const R = e.getBoundingClientRect(), name = (typeof e.className === "string" && e.className.split(" ")[0]) || e.tagName.toLowerCase();
        const wide = [...e.querySelectorAll("*")].find((c) => c.getBoundingClientRect().right > R.right + 1 && c.getClientRects().length);
        return wide ? `${name} (${(typeof wide.className === "string" && wide.className.split(" ")[0]) || wide.tagName.toLowerCase()}: "${wide.textContent.trim().slice(0, 40)}")` : name;
      }).slice(0, 4),
    }));
    if (r.scrolls || r.spill.length) { console.log(`  ${width}px: ${r.scrolls ? "SCROLLS SIDEWAYS " : ""}${r.spill.length ? `content wider than its card: ${r.spill.join(", ")}` : ""}${pg.enforce ? " — FAIL" : " (report-only)"}`); if (pg.enforce) failures++; }
    else console.log(`  ${width}px: no sideways scroll, nothing wider than its card`);
    await page.close();
  }
  if (!pg.enforce) continue;
  // A large-text browser setting: the root at 20px. Reading text must follow (rem, not px).
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(doc(html, "html { font-size: 20px; }"));
    const nodes = await page.evaluate(scan);
    const bad = judge(nodes, 20, 15);
    console.log(`  root 20px: ${bad.length ? `${bad.length} node(s) did not scale` : "reading text scales with the root"}`);
    for (const b of bad.slice(0, 15)) console.log(`    FAIL  ${b}`);
    if (bad.length) failures++;
    await page.close();
  }
  // The mutant: one sentence forced to 14px must be caught.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(doc(html));
    const caught = await page.evaluate((scanSrc) => {
      const scanFn = new Function(`return (${scanSrc})`)();
      const before = scanFn().filter((x) => x.sentence && !x.fine && x.px < 16).length;
      const target = [...document.querySelectorAll("main p, main li")].find((e) => !e.closest("[data-fine-print]") && e.textContent.trim().split(/\s+/).length >= 6 && e.getClientRects().length);
      if (!target) return null;
      target.style.setProperty("font-size", "14px", "important");
      return scanFn().filter((x) => x.sentence && !x.fine && x.px < 16).length > before;
    }, scan.toString());
    console.log(`  mutant (a sentence forced to 14px): ${caught ? "caught" : caught === null ? "no sentence to mutate — FAIL" : "MISSED — FAIL"}`);
    if (!caught) failures++;
    await page.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
