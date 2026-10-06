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
  // /sector (#553 COWORK #157): a fixture sector table, counts, tones and A's medians.
  "@/lib/server/sectorPanels": "scripts/lib/measure-stubs/sector-panels.mjs",
  "@/lib/server/sectorUniverse": "scripts/lib/measure-stubs/sector-universe.mjs",
  "@/lib/server/sectorTone": "scripts/lib/measure-stubs/sector-tone.mjs",
  "@/lib/server/peSectorMedians": "scripts/lib/measure-stubs/pe-sector-medians.mjs",
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
async function sectorIndexPage() {
  const { default: Page } = await import("../app/sector/page.tsx");
  return renderToStaticMarkup(await Page());
}

/** "Earnings this week" (#552 COWORK #170) on fixture data: the page itself reads Redis for its lists. */
async function earningsWeekFixture() {
  const W = await import("../lib/server/earningsWeek.ts");
  const { default: Week } = await import("../app/earnings-calendar/EarningsWeek.tsx");
  const { default: ComingUp } = await import("../app/earnings-calendar/EarningsComingUp.tsx");
  const today = "2026-10-05";
  const rows = [
    { symbol: "AAPL", company: "Apple Inc.", revenue: "$94.04B", revenueYoY: 9.6, eps: "$1.57", since: 2.3 },
    { symbol: "GOOGL", company: "Alphabet Inc.", revenue: "$96.43B", revenueYoY: 13.8, eps: "$2.31", since: -1.4 },
    { symbol: "NEWCO", company: "Newco International Holdings Corporation", revenue: "$11.7M", revenueYoY: null, eps: "−$0.12", since: null },
  ];
  const days = W.weekDays(today).map((date) => {
    const r = date === "2026-10-01" ? rows : [];
    return { date, weekday: W.tileWeekday(date), dateLabel: W.tileDate(date), count: date === "2026-09-30" ? 128 : r.length,
      pill: W.countPill(date === "2026-09-30" ? 128 : r.length, date === today), isToday: date === today,
      eyebrow: W.dayEyebrow(date, r.length), emptyLine: r.length ? null : `No results filed on ${W.dayLong(date)}.`, rows: r };
  });
  const exp = (symbol, daysAway) => ({ symbol, band: "d8_21", daysAway, periodEnd: "2026-09-30", medianLagDays: 15, fromPeriods: 12, precision: 0.9, isFpi: false, lastReportedOn: "2026-07-15", lastReportedPeriodEnd: "2026-06-30" });
  // THE WEEK GRID (#552 COWORK #179): a busy "Next week" (11 names, so "+ 3
  // more"), long names to truncate, a due name, and an empty week.
  const busy = ["BAC", "WFC", "C", "GS", "MS", "PNC", "USB", "SCHW", "BLK", "AXP", "COF"];
  const expected = { kind: "listed", considered: 50, rows: [exp("UNH", 10), exp("JPM", 2), exp("NFLX", 26), exp("BRK-B", 12), exp("TSM", 11), ...busy.map((s) => exp(s, 9))] };
  const due = { kind: "listed", coverage: 1, entries: [{ symbol: "MU", periodEnd: "2026-08-27", dueFrom: "2026-09-15", expectedOn: "2026-09-19", daysOutstanding: 39 }] };
  const names = { UNH: "UnitedHealth Group Incorporated", JPM: "JPMorgan Chase & Co.", NFLX: "Netflix, Inc.", "BRK-B": "Berkshire Hathaway Inc.",
    TSM: "Taiwan Semiconductor Manufacturing Company Limited", MU: "Micron Technology, Inc.", SCHW: "The Charles Schwab Corporation" };
  const facts = Object.fromEntries([...expected.rows.map((r) => r.symbol), "MU"].map((s, i) => [s, { company: names[s] ?? `${s} Financial Holdings Corporation`, cap: 1e12 - i * 1e9 }]));
  return renderToStaticMarkup(React.createElement("main", { style: { background: "#06080d", color: "#f1f5f9", padding: "20px 10px" } }, // the page's own padding at ≤400 px
    React.createElement(Week, { days, initial: "2026-10-01" }),
    React.createElement(ComingUp, { expected, due, today, facts })));
}

/**
 * INTC'S SHAPE ON THE EARNINGS PAGE (#552 COWORK #176): the snapshot with the
 * word "Loss both periods" in the right column, and the cash card with n/m
 * tiles (a loss quarter, positive OCF and FCF, OCF derived) in the main one,
 * under the page's own stylesheet and layout.
 */
async function intcCardsFixture() {
  const { buildSecEarningsView } = await import("../lib/server/secEarningsView.ts");
  const Cards = await import("../app/stock/[symbol]/earnings/SecEarningsCards.tsx");
  const v = buildSecEarningsView(JSON.parse(fs.readFileSync(path.join(ROOT, "data/sec/factset-fixture-AAPL.json"), "utf8")));
  v.snapshot.epsYoY = "loss-both";
  v.cashQuality.netIncome.val = -11.03e9;
  v.cashQuality.operatingCashFlow.val = 7.01e9;
  v.cashQuality.operatingCashFlow.derivedNote = "Derived: the quarter is the year-to-date figure less the previous one.";
  v.cashQuality.freeCashFlow = 4.45e9;
  const styles = ((await earningsPage()).match(/<style[\s\S]*?<\/style>/g) ?? []).join("");
  const body = renderToStaticMarkup(React.createElement("main", { className: "earningsPage" },
    React.createElement("div", { className: "earningsWrap" },
      React.createElement("section", { className: "contentGrid" },
        React.createElement("div", { className: "mainColumn" }, React.createElement(Cards.SecCashQualityCard, { view: v })),
        React.createElement("aside", { className: "sideColumn" }, React.createElement(Cards.SecSnapshotCard, { view: v, pending: null }))))));
  return styles + body;
}

const PAGES = [
  { name: "/stock/AAPL", render: stockPage, enforce: true },
  { name: "/markets/spx", render: spxPage, enforce: true },
  { name: "/stock/AAPL/earnings", render: earningsPage, enforce: true },
  { name: "/earnings-calendar (week fixture)", render: earningsWeekFixture, enforce: true },
  { name: "/stock/AAPL strength note (open)", render: strengthNote, enforce: true },
  { name: "/stock/AAPL performance note (open)", render: performanceNote, enforce: true },
  { name: "/bottlenecks/capex why card", render: () => capexWhy(false), enforce: true },
  { name: "/bottlenecks/capex why card (How to use, open)", render: () => capexWhy(true), enforce: true },
  { name: "/sector", render: async () => (await sectorIndexPage()).replace(/<details /g, "<details open "), enforce: true },
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
  // THE HEADER CELLS' MINI-GRAPHICS (#563 COWORK #112): each stays inside its own stat cell, 320–1280 px.
  if (html.includes("stock-stat-cell")) {
    for (const width of [320, 360, 390, 414, 430, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(doc(html));
      const out = await page.evaluate(() => [...document.querySelectorAll(".stock-stat-cell svg[class^='hs']")].flatMap((g) => {
        const cell = g.closest(".stock-stat-cell").getBoundingClientRect(), r = g.getBoundingClientRect();
        return r.left < cell.left - 1 || r.right > cell.right + 1 || r.top < cell.top - 1 || r.bottom > cell.bottom + 1 ? [g.getAttribute("class")] : [];
      }).concat(document.querySelectorAll(".stock-stat-cell svg[class^='hs']").length ? [] : ["(no graphics rendered)"]));
      if (out.length) { console.log(`  ${width}px: header graphics outside their cell: ${out.join(", ")} — FAIL`); failures++; }
      else console.log(`  ${width}px: every header graphic inside its cell`);
      // Small text over a graphic carries a halo (#563 COWORK #114); a mutant strips the halos and must be caught.
      const bare = async (strip) => {
        if (strip) await page.addStyleTag({ content: ".stock-stat-cell * { text-shadow: none !important; }" });
        return page.evaluate(() => {
          const out = [];
          for (const cell of document.querySelectorAll(".stock-stat-cell")) {
            const gs = [...cell.querySelectorAll("svg[class^='hs']")].map((g) => g.getBoundingClientRect());
            for (const el of cell.querySelectorAll("*")) {
              if (el.closest("svg") || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
              const cs = getComputedStyle(el), r = el.getBoundingClientRect();
              if (parseFloat(cs.fontSize) >= 16 || !r.width) continue;
              const hit = gs.some((g) => r.left < g.right && r.right > g.left && r.top < g.bottom && r.bottom > g.top);
              if (hit && cs.textShadow === "none") out.push(el.textContent.trim().slice(0, 30));
            }
          }
          return out;
        });
      };
      const unhaloed = await bare(false);
      if (unhaloed.length) { console.log(`  ${width}px: small text over a graphic without a halo: ${unhaloed.join(" | ")} — FAIL`); failures++; }
      else {
        const caught = (await bare(true)).length > 0;
        console.log(`  ${width}px: small text over the graphics carries a halo${caught ? " (mutant without halos: caught)" : " — the mutant found no text over a graphic, FAIL"}`);
        if (!caught) failures++;
      }
      await page.close();
    }
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
// ── THE EARNINGS PAGE LAYOUT (#552 COWORK #166 / #168) ───────────────────────
// The snapshot sits in the right column: its tile figures must not wrap at
// 1280px or with a 20px root. On a phone the cards stack Growth & Margins →
// snapshot → "What it means". The income statement's bars carry the
// statement's own labels: no label or figure may be cut, at any width.
{
  const html = await earningsPage();
  console.log("\n/stock/AAPL/earnings layout (#552 COWORK #166/#168)");
  const tiles = () => [...document.querySelectorAll(".snapshotGrid .metricValue")].map((e) => {
    const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.25;
    return { text: e.textContent.trim(), lines: Math.round(e.getBoundingClientRect().height / lh), cut: e.scrollWidth > e.clientWidth + 1 };
  });
  for (const [label, width, css] of [["1280px", 1280, ""], ["1280px, root 20px", 1280, "html { font-size: 20px; }"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(doc(html, css));
    const t = await page.evaluate(tiles);
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".snapshotGrid")).gridTemplateColumns.split(" ").length);
    const bad = t.filter((x) => x.lines > 1 || x.cut);
    console.log(`  ${label}: snapshot tiles ${cols} across · ${bad.length ? `WRAPS OR CUTS: ${bad.map((x) => x.text).join(", ")} — FAIL` : `no figure wraps or cuts (${t.length} tiles)`}`);
    if (bad.length || !t.length) failures++;
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.setContent(doc(html));
    const seq = await page.evaluate(() => [...document.querySelectorAll(".contentGrid section.card")]
      .filter((e) => e.getClientRects().length)
      .map((e) => ({ y: e.getBoundingClientRect().top, name: (e.querySelector(".eyebrow")?.textContent ?? "").trim() }))
      .sort((a, b) => a.y - b.y).map((x) => x.name));
    const iGm = seq.indexOf("Growth & margins"), iSnap = seq.findIndex((n) => /^Latest/.test(n)), iMeans = seq.indexOf("What it means");
    const ok = iGm >= 0 && iSnap === iGm + 1 && iMeans > iSnap;
    console.log(`  390px stacked order: ${seq.slice(0, 6).join(" → ")} … · ${ok ? "Growth & Margins → snapshot → the rest" : "WRONG ORDER — FAIL"}`);
    if (!ok) failures++;
    await page.close();
  }
  for (const width of [320, 360, 390, 414, 430, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(doc(html));
    const r = await page.evaluate(() => [...document.querySelectorAll(".waterfall .wfLabel, .waterfall .wfValue")]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > e.closest(".card").getBoundingClientRect().right + 1)
      .map((e) => e.textContent.trim().slice(0, 30)));
    const n = await page.evaluate(() => document.querySelectorAll(".waterfall .wfRow").length);
    if (r.length || !n) { console.log(`  ${width}px: income bars ${n ? `CUT: ${r.join(", ")}` : "NOT DRAWN"} — FAIL`); failures++; }
    else console.log(`  ${width}px: ${n} income bars, no label or figure cut`);
    await page.close();
  }
}
// ── QUALITY OF EARNINGS AND BALANCE SHEET (#552 COWORK #169) ─────────────────
// Tile figures large and never wrapped or cut (the grid goes 1 across first);
// the balance chart, its labels and the meter stay inside the card, 320–1280px
// and at a 20px root. Reading size itself is the page pass above.
{
  const html = await earningsPage();
  console.log("\n/stock/AAPL/earnings quality and balance cards (#552 COWORK #169)");
  const probe = () => {
    const out = { tiles: 0, bad: [], cols: 0, balance: 0 };
    const grid = document.querySelector(".qualityGrid");
    if (grid) out.cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    for (const e of document.querySelectorAll(".qualityGrid .metricValue")) {
      out.tiles++;
      const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.25;
      if (Math.round(e.getBoundingClientRect().height / lh) > 1 || e.scrollWidth > e.clientWidth + 1) out.bad.push(`tile "${e.textContent.trim()}" wraps or cuts`);
    }
    for (const card of document.querySelectorAll(".qualityCard, .balanceCard")) {
      const R = card.getBoundingClientRect();
      for (const e of card.querySelectorAll(".balanceRowHead, .balanceGapLabel, .balanceLegend, .meterScale span, .meterTrack, .balanceTrack, .convChart, .convPct, .convPeriod, .balanceTotals")) {
        if (card.classList.contains("balanceCard")) out.balance++;
        const r = e.getBoundingClientRect();
        if (r.right > R.right + 1 || r.left < R.left - 1) out.bad.push(`${e.className?.baseVal ?? e.className} "${e.textContent.trim().slice(0, 30)}" outside its card`);
      }
    }
    // THE GAP BOX MEETS THE BAR ENDS: from the shorter bar's end to the longer's.
    const R = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const gap = R(".balanceGap"), segs = [...document.querySelectorAll('.balanceCard [data-seg]')].map((e) => ({ k: e.dataset.seg, r: e.getBoundingClientRect() }));
    if (gap && segs.length) {
      const liquidEnd = Math.max(...segs.filter((x) => x.k !== "debt").map((x) => x.r.right)), debtEnd = segs.find((x) => x.k === "debt")?.r.right ?? 0;
      const [lo, hi] = [Math.min(liquidEnd, debtEnd), Math.max(liquidEnd, debtEnd)];
      if (Math.abs(gap.left - lo) > 2 || Math.abs(gap.right - hi) > 3) out.bad.push(`gap box ${Math.round(gap.left)}–${Math.round(gap.right)} vs bar ends ${Math.round(lo)}–${Math.round(hi)}`);
    } else out.bad.push("no gap box");
    return out;
  };
  for (const [label, width, css] of [["320px", 320, ""], ["360px", 360, ""], ["390px", 390, ""], ["430px", 430, ""], ["1280px", 1280, ""], ["1280px, root 20px", 1280, "html { font-size: 20px; }"], ["390px, root 20px", 390, "html { font-size: 20px; }"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(doc(html, css));
    const r = await page.evaluate(probe);
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const fail = r.bad.length || !r.tiles || !r.balance || scrolls;
    console.log(`  ${label}: ${r.tiles} tiles, ${r.cols} across · ${r.balance} balance elements · ${fail ? `${scrolls ? "SCROLLS SIDEWAYS " : ""}${r.bad.slice(0, 4).join("; ")}${!r.tiles || !r.balance ? "CARDS NOT DRAWN" : ""} — FAIL` : "nothing wraps, cuts or leaves its card"}`);
    if (fail) failures++;
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `quality-balance-${width}${css ? "-root20" : ""}.png`), fullPage: true });
    await page.close();
  }
}
// ── THE WEEK STRIP (#552 COWORK #170): seven tiles in one row at 320 px, no
// tile's lines wrapping ("Mon" over "5 Oct" over the pill), and nothing cut.
{
  const html = await earningsWeekFixture();
  console.log("\n/earnings-calendar week strip (#552 COWORK #170)");
  for (const [label, width, css] of [["320px", 320, ""], ["390px", 390, ""], ["1280px", 1280, ""], ["390px, root 20px", 390, "html { font-size: 20px; }"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(doc(html, css));
    const r = await page.evaluate((big) => {
      const tiles = [...document.querySelectorAll(".ewTile")];
      const tops = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top)));
      const bad = [];
      for (const t of tiles) for (const e of t.children) {
        const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.3;
        // At the default size a line may not wrap; at a 20 px root the date may
        // break between its two words ("5" / "Oct"), but nothing may be cut.
        const wraps = Math.round(e.getBoundingClientRect().height / lh) > 1;
        const cut = e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > t.getBoundingClientRect().right + 1 || e.getBoundingClientRect().left < t.getBoundingClientRect().left - 1;
        if (cut || (wraps && !big)) bad.push(`${t.dataset.weekDay} "${e.textContent}"${cut ? " cut" : " wraps"}`);
      }
      return { n: tiles.length, rows: tops.size, bad, scrolls: document.documentElement.scrollWidth > innerWidth };
    }, Boolean(css));
    const fail = r.n !== 7 || r.rows !== 1 || r.bad.length || r.scrolls;
    console.log(`  ${label}: ${r.n} tiles in ${r.rows} row · ${fail ? `${r.scrolls ? "SCROLLS SIDEWAYS " : ""}${r.bad.slice(0, 4).join("; ")} — FAIL` : "no tile line wraps or cuts"}`);
    if (fail) failures++;
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `earnings-week-${width}${css ? "-root20" : ""}.png`), fullPage: true });
    await page.close();
  }
}
// ── "COMING UP" AS A WEEK GRID (#552 COWORK #179): 4 / 2 / 1 COLUMNS ───────
// The column count at each width, no sideways scroll, and no row text leaving
// its column (a long name is cut by its ellipsis, inside the column), with
// "+ N more" closed and open.
{
  const html = await earningsWeekFixture();
  console.log("\n/earnings-calendar Coming up grid (#552 COWORK #179)");
  for (const [label, width, cols, css] of [["1280px", 1280, 4, ""], ["768px", 768, 2, ""], ["390px", 390, 1, ""], ["320px", 320, 1, ""], ["390px, root 20px", 390, 1, "html { font-size: 20px; }"], ["1280px, root 20px", 1280, 4, "html { font-size: 20px; }"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(doc(html, css));
    const measure = () => page.evaluate(() => {
      const colsEl = [...document.querySelectorAll(".cuCol")];
      const lefts = new Set(colsEl.map((c) => Math.round(c.getBoundingClientRect().left)));
      const bad = [];
      for (const c of colsEl) {
        const cr = c.getBoundingClientRect();
        const walk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (!n.textContent.trim() || n.parentElement.closest("details:not([open]) > :not(summary)")) continue;
          // A NAME CUT BY ITS ELLIPSIS is measured by its box, not its text.
          const el = n.parentElement.classList.contains("cuName") ? n.parentElement : null;
          const range = document.createRange(); range.selectNodeContents(n);
          const rects = el ? [el.getBoundingClientRect()] : [...range.getClientRects()];
          if (rects.some((r) => r.width && (r.left < cr.left - 0.5 || r.right > cr.right + 0.5))) bad.push(`${c.dataset.col} "${n.textContent.trim().slice(0, 24)}"`);
        }
      }
      const ellipsed = [...document.querySelectorAll(".cuName")].filter((e) => e.scrollWidth > e.clientWidth).length;
      return { n: colsEl.length, across: lefts.size, bad, ellipsed, scrolls: document.documentElement.scrollWidth > innerWidth };
    });
    const closed = await measure();
    await page.evaluate(() => document.querySelectorAll(".cuMore").forEach((d) => { d.open = true; }));
    const open = await measure();
    const fail = closed.n !== 4 || closed.across !== cols || closed.bad.length || open.bad.length || closed.scrolls || open.scrolls;
    console.log(`  ${label}: ${closed.n} columns, ${closed.across} across (want ${cols}), ${closed.ellipsed} name(s) ellipsized · ` +
      (fail ? `${closed.scrolls || open.scrolls ? "SCROLLS SIDEWAYS " : ""}${[...closed.bad, ...open.bad].slice(0, 4).join("; ")} — FAIL` : "no text leaves its column, open or closed"));
    if (fail) failures++;
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `coming-up-${width}${css ? "-root20" : ""}.png`), fullPage: true });
    await page.close();
  }
}
// ── NO TILE TEXT LEAVES ITS TILE, INTC'S SHAPE (#552 COWORK #176) ───────────
{
  const html = await intcCardsFixture();
  console.log("\n/stock/INTC/earnings shape: word values and n/m tiles (#552 COWORK #176)");
  for (const [label, width, css] of [["320px", 320, ""], ["360px", 360, ""], ["390px", 390, ""], ["430px", 430, ""], ["1280px", 1280, ""], ["390px, root 20px", 390, "html { font-size: 20px; }"], ["1280px, root 20px", 1280, "html { font-size: 20px; }"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(doc(html, css));
    const r = await page.evaluate(() => {
      const bad = [];
      const tiles = [...document.querySelectorAll(".metricCard")];
      for (const t of tiles) {
        const R = t.getBoundingClientRect();
        // THE TEXT ITSELF, not its box: a nowrap line overflows a box that
        // stays the tile's width, so each text node's own extent is measured.
        const walk = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(n);
          for (const q of range.getClientRects()) {
            if (q.width && (q.right > R.right + 1 || q.left < R.left - 1))
              bad.push(`"${(t.querySelector(".metricLabel")?.textContent ?? "").trim()}": "${n.textContent.trim().slice(0, 40)}"`);
          }
        }
      }
      return { tiles: tiles.length, words: document.querySelectorAll(".metricWord").length, bad: [...new Set(bad)] };
    });
    const fail = r.bad.length || r.tiles < 10 || r.words < 1;
    console.log(`  ${label}: ${r.tiles} tiles, ${r.words} word value(s) · ${fail ? `${r.bad.slice(0, 4).join("; ")}${r.tiles < 10 ? " CARDS NOT DRAWN" : ""} — FAIL` : "no text leaves its tile"}`);
    if (fail) failures++;
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `intc-tiles-${width}${css ? "-root20" : ""}.png`), fullPage: true });
    await page.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
