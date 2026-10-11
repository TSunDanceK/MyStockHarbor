// THE DASHBOARD LANDING'S RULES (#563 COWORK #134; v2, #164).
//
// Renders the landing's server parts (app/dashboard/DashboardLanding.tsx) with
// the repo's render hooks, on the measure's two fixtures: every source filled,
// and every source missing; reads the client, the page and the data module as
// source. It fails when (one rule per #164 item, a planted mutant for each):
//   A. Market today: no half-gauge, not the four index tiles (SPY, QQQ, DIA,
//      IWM; 2 × 2 on a phone), not the trend / best-sector line, not one credit,
//      or nothing said when empty; the old S&P / Trend / Best tiles back; the
//      ticker tape or the Market Benchmarks row back on the landing; the hero
//      not the brief's (lead line, the four Try chips, two columns from 860 px);
//      the biggest-mover line missing or worded as a signal;
//   B. the two open features in a card, without their divider, not stacking
//      below 1024 px, or losing their empty states and links; the screens and
//      sectors cards side by side (stacked at 640 px and under), the sectors
//      card not the top 5 and the bottom 1;
//   C. This week: not 3 + 3 earnings rows (no per-row date or tag; the fine
//      line), not one featured post plus "Also:", not 4 one-line headlines with
//      a thumbnail or logo; cards not stretched to one height with footers last;
//   D. the analyser not one card under an H2 (#analyser kept), without the
//      head, the "Change stock…" search, the verdict and the links; the tabs not
//      beside their label at 641 px and up and over it at 640 and under; the
//      Breakdown not collapsed on arrival;
//   E. a card's eyebrow in a new hue; a section with more than one credit line;
//      the landing cache key not bumped;
// plus the standing rules: every card's empty state and section link, screen
// links on PICKER_ROUTES, no advice words, the deep link's scroll, the H1, "/"
// serving this page, and (7) the Filed earnings tab.
//
//   node scripts/check-dashboard-landing.mjs
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/tsx-render-hooks.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const React = await import("react");
const { FULL_LANDING, EMPTY_LANDING } = await import("./lib/measure-stubs/dashboard-landing.mjs");
const { DASHBOARD_SCREENS, biggestMover } = await import("../lib/server/dashboardCards.ts").catch(() => ({ DASHBOARD_SCREENS: null, biggestMover: null }));
const { PICKER_ROUTES } = await import("../lib/pickerRoutes.ts");
const { ETF_NAMES } = await import("../lib/etfNames.ts");
const { etfs: ETFS } = await import("../lib/curatedSymbols.ts");

const LANDING = "app/dashboard/DashboardLanding.tsx";
const CLIENT = "app/components/DashboardClient.tsx";
const PAGE = "app/dashboard/page.tsx";
const CARDS_SRC = "lib/server/dashboardCards.ts";
const ROOT = "app/page.tsx";
const read = (p) => fs.readFileSync(p, "utf8");
/** The cards (with a border and an empty state each); the two open features are checked on their own. */
const CARDS = ["pickers", "sectors", "earnings", "insight", "news"], OPEN = ["hub", "capex"];
/** The existing eyebrow hues (#164 E: no new ones). */
const HUES = ["#93c5fd", "#5FD4C7", "#c4b5fd", "#4ade80", "#facc15", "#38bdf8", "#fbbf24", "#f472b6"];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

let seq = 0;
/** Import a (possibly mutated) copy of the landing beside the original, so its imports resolve. */
async function loadLanding(src) {
  const file = path.join(path.dirname(LANDING), `.check-landing-${process.pid}-${seq++}.tsx`);
  fs.writeFileSync(file, src);
  try { return await import(pathToFileURL(path.resolve(file)).href); } finally { fs.rmSync(file, { force: true }); }
}

const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const cardHtml = (html, id) => {
  const i = html.indexOf(`data-card="${id}"`);
  if (i < 0) return null;
  const end = html.indexOf("</section>", i);
  return html.slice(i, end);
};
const openHtml = (html, id) => {
  const i = html.indexOf(`data-open="${id}"`);
  if (i < 0) return null;
  const next = [html.indexOf('data-open="', i + 12), html.indexOf('data-row="only-cards"', i)].filter((x) => x > 0);
  return html.slice(i, Math.min(...next));
};
const tiingoLinks = (html) => (html.match(/href="https:\/\/www\.tiingo\.com/g) ?? []).length;
const mediaFree = (css) => css.replace(/@media\([^)]*\)\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").replace(/@container[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");

/** Every rule on one landing module; returns the failures. */
function rules(mod, scr = DASHBOARD_SCREENS) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  let full = "", empty = "", mFull = "", mEmpty = "";
  try {
    full = renderToStaticMarkup(React.createElement(mod.LandingCards, { c: FULL_LANDING.cards, hasFiledEarnings: () => true }));
    empty = renderToStaticMarkup(React.createElement(mod.LandingCards, { c: EMPTY_LANDING.cards, hasFiledEarnings: () => true }));
    mFull = renderToStaticMarkup(React.createElement(mod.MarketToday, { m: FULL_LANDING.market }));
    mEmpty = renderToStaticMarkup(React.createElement(mod.MarketToday, { m: EMPTY_LANDING.market }));
  } catch (e) {
    return [`the landing renders with every source filled and every source missing (${String(e.message).slice(0, 80)})`];
  }
  const css = mod.LANDING_CSS, base = mediaFree(css);
  // Every card: its data, its empty state's own words, its section link.
  for (const id of CARDS) {
    const f = cardHtml(full, id), e = cardHtml(empty, id);
    want(`the ${id} card renders with data`, !!f);
    want(`the ${id} card renders with nothing`, !!e);
    if (!f || !e) continue;
    want(`the ${id} card shows no empty state with data`, !/data-empty/.test(f.slice(0, 80)));
    want(`the ${id} card says "${mod.EMPTY[id]}" with nothing`, /^data-card="[a-z]+" data-empty=""/.test(e) && text(e).includes(mod.EMPTY[id]));
    want(`the ${id} card keeps its section link with nothing`, /<a (?=[^>]*class="dlMore")(?=[^>]*href="\/[a-z0-9/-]*")[^>]*>/.test(e));
  }

  // ── A. Market today ──
  want("A: Market today draws the Market Mood half-gauge, with \"What goes into it?\"", /data-mood-gauge=""/.test(mFull) && /data-gauge-needle="44"/.test(mFull) && text(mFull).includes("What goes into it?") && !/moodThermo|moodSpark/.test(mFull));
  const tiles = [...mFull.matchAll(/data-index="([A-Z]+)"/g)].map((m) => m[1]);
  want("A: the index row is SPY, QQQ, DIA, IWM, each its move on the close", tiles.join(",") === "SPY,QQQ,DIA,IWM" && text(mFull).includes("−1.04%") && text(mFull).includes("+0.21%"));
  want("A: the index row is 2 × 2 at 560 px and under, one row of 4 above", /\.dlIdx\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\);/.test(base) && /@media\(max-width:560px\)\{[^@]*\.dlIdx\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/.test(css));
  want("A: one line carries the trend score and the best sector", text(mFull).includes("Trend score 85/100, a strong uptrend · Best sector YTD: Technology +55%"));
  want("A: the old S&P / Trend / Best-sector tiles are gone", !/data-tile=|dlTiles|S&amp;P 500 \(SPY\)/.test(mFull));
  want(`A: Market today says "${mod.EMPTY.market}" with nothing`, text(mEmpty).includes(mod.EMPTY.market));
  want("A: one linked Tiingo credit in Market today", tiingoLinks(mFull) === 1);
  // The biggest mover (the retired tape's top item): one factual line, no signal words.
  const pk = cardHtml(full, "pickers") ?? "";
  want("A: the screens card carries \"Biggest mover today: SMCI, up 9.4%\" (facts, no signal words)", /data-mover=""/.test(pk) && text(pk).includes("Biggest mover today: SMCI, up 9.4%") && !/signal/i.test(text(pk)) &&
    mod.moverLine({ symbol: "XYZ", changePct: -3.21, label: "Last close · 1 Oct" }) === "Biggest mover on the last close (1 Oct): XYZ, down 3.2%");
  want("A: biggestMover takes the largest move either way", typeof biggestMover === "function" && biggestMover([{ symbol: "a", changePct: 3 }, { symbol: "b", changePct: -5.5 }, { symbol: "c", changePct: null }])?.symbol === "B");

  // ── B. Only on MyStockHarbor ──
  for (const id of OPEN) {
    const f = openHtml(full, id), e = openHtml(empty, id);
    want(`B: the ${id} feature is open (no card), inside the open row`, !!f && full.includes(`<div class="dlOpen" data-open="${id}">`) && /data-open-row=""/.test(full) && full.indexOf("data-open-row") < full.indexOf(`data-open="${id}"`) && !/class="dlCard"/.test(f ?? ""));
    want(`B: the ${id} feature says "${mod.EMPTY[id]}" with nothing, and keeps its link`, !!e && text(e).includes(mod.EMPTY[id]) && /data-empty=""/.test(e) && /class="dlMore"/.test(e));
  }
  want("B: the open features sit on the page background, a thin line under them, side by side from 1024 px", /\.dlOpen\{(?![^}]*(?:border|background))[^}]*\}/.test(base) && /\.dlOpenRow\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);[^}]*border-bottom:1px solid/.test(base) &&
    /@media\(max-width:1023px\)\{\.dlOpenRow\{grid-template-columns:minmax\(0,1fr\);/.test(css));
  want("B: the capex flow (both column heads, the fine line) fills its half", text(openHtml(full, "capex") ?? "").includes("their own capex") && text(openHtml(full, "capex") ?? "").includes("their own filed sales") && text(openHtml(full, "capex") ?? "").includes("not a record of who paid them"));
  want("B: the screens and sectors cards side by side, stacked at 640 px and under", /data-row="only-cards"/.test(full) && full.indexOf('data-card="pickers"') > full.indexOf('data-row="only-cards"') && full.indexOf('data-card="sectors"') < full.indexOf('data-section="week"') &&
    /\.dlRow2\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/.test(base) && /@media\(max-width:640px\)\{\.dlRow2\{grid-template-columns:minmax\(0,1fr\);\}\}/.test(css));
  const hrefs = [...pk.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h !== "/stock-screener" && !h.startsWith("/stock/"));
  want("every Pickers screen links to a PICKER_ROUTES page", hrefs.length === 5 && hrefs.every((h) => PICKER_ROUTES.includes(h)));
  want("DASHBOARD_SCREENS are all PICKER_ROUTES pages", Array.isArray(scr) && scr.length === 5 && scr.every((s) => PICKER_ROUTES.includes(s.href)));
  want("\"Build your own screen\" links to /stock-screener, with the members' logos", /<a (?=[^>]*class="dlMore")(?=[^>]*href="\/stock-screener")[^>]*>/.test(pk) && (pk.match(/data-peek=""/g) ?? []).length === 4);
  const sc = cardHtml(full, "sectors") ?? "";
  const secRows = [...sc.matchAll(/data-sector-row="([a-z-]+)"/g)].map((m) => m[1]);
  want("B: the sectors card is the top 5 and the bottom 1, on the shared axis with the S&P line, and \"All 11 sectors\"", secRows.join(",") === "technology,energy,industrials,basic-materials,financial-services,consumer-cyclical" &&
    /data-spx-ref=""/.test(sc) && /href="\/sector"/.test(sc) && text(sc).includes("All 11 sectors") && sc.includes(`<p class="dlRead dlSecWhat" data-sector-what="">${mod.SECTOR_WHAT.replace(/’/g, "’")}</p>`));
  const bars = [...sc.matchAll(/class="dlSecBar" data-tone="(up|down)" style="left:([\d.]+)%;width:([\d.]+)%"/g)];
  want("a rising sector's bar runs right of 0, a falling one left", bars.length === 6 && bars.every((b) => (b[1] === "up" ? Number(b[2]) === 50 : Math.abs(Number(b[2]) + Number(b[3]) - 50) < 0.01)));
  // The capex star lined up (#154 §1): each line level with its row, ending on the hub.
  const cx = openHtml(full, "capex") ?? "";
  const hubY = Number(cx.match(/data-hub-y="([\d.]+)"/)?.[1] ?? NaN), rowY = (i) => i * 36 + 14;
  const ins = [...cx.matchAll(/<path data-into-node="" data-row-y="([\d.]+)" d="([^"]+)"/g)], outs = [...cx.matchAll(/<path data-from-node="" data-row-y="([\d.]+)" d="([^"]+)"/g)];
  want("the capex star: each line level with its own row and ending on the hub, never company to company", ins.length === 3 && outs.length === 3 && hubY === rowY(1) &&
    ins.every((m, i) => m[2] === `M0 ${rowY(i)} H14 L40 ${hubY}`) && outs.every((m, i) => m[2] === `M40 ${hubY} L66 ${rowY(i)} H80`));

  // ── C. This week ──
  const week = full.slice(full.indexOf('data-section="week"'));
  want("C: This week holds earnings, insight and headlines, three equal columns, stacked at 860 px and under", /data-row="week"/.test(week) && week.indexOf('data-card="earnings"') < week.indexOf('data-card="insight"') && week.indexOf('data-card="insight"') < week.indexOf('data-card="news"') &&
    /\.dlRow3\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);\}/.test(base) && /@media\(max-width:860px\)\{\.dlRow3\{grid-template-columns:minmax\(0,1fr\);\}\}/.test(css));
  want("C: cards stretch to the row's height, their footer links last", /\.dlRow\{[^}]*align-items:stretch;/.test(base) && /\.dlCard\{display:flex;flex-direction:column;/.test(base) && /\.dlMore\{margin-top:auto;/.test(base));
  const ea = cardHtml(full, "earnings") ?? "";
  const W = FULL_LANDING.cards.earnings.windows;
  const weeks = [...ea.matchAll(/<div class="dlWeek" data-week="">([\s\S]*?)(?=<div class="dlWeek"|<p class="dlFine")/g)].map((m) => m[1]);
  want("C: two weeks, each headed with its dates and count", weeks.length === 2 && weeks.every((h, i) => h.includes(`<p class="dlWeekHead">${W[i].range} · ${W[i].count} companies</p>`)));
  want("C: three companies a week: logo, bold ticker, name (full name in title); no per-row date or tag", weeks.every((h, i) => {
    const rows = [...h.matchAll(/<li class="dlEarnRow" data-earn-row="">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    return rows.length === 3 && rows.every((r, k) => {
      const e = W[i].top[k], esc = (t) => t.replace(/&/g, "&amp;");
      return r.includes(`title="${esc(e.name)}"`) && /<img src="\/logos\//.test(r) && r.includes(`<strong>${e.symbol}</strong>`) && r.includes(`<span class="dlEarnCo">${esc(e.name)}</span>`) && !r.includes(e.day) && !/Estimated|dlEarnDay|<em>/.test(r);
    });
  }));
  want("C: the earnings fine line, and \"Open the calendar\"", ea.includes('<p class="dlFine" data-fine-print=""><strong style="color:#f59e0b">Estimated</strong> from each company&#x27;s own SEC reporting pattern') && /href="\/earnings-calendar"[^>]*>Open the calendar →/.test(ea));
  want("a long name truncates on one line with an ellipsis", /\.dlEarnCo\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap;/.test(css));
  const ins2 = cardHtml(full, "insight") ?? "";
  const [p0, p1] = FULL_LANDING.cards.insights;
  want("C: one featured post (art, title, since line), then \"Also:\" for the second", (ins2.match(/data-insight-post=/g) ?? []).length === 1 && ins2.includes(`href="/insights/${p0.slug}"`) && /class="dlInsightImg"/.test(ins2) &&
    text(ins2).includes("since the post on 28 Jul 2026") && /data-insight-also=""><span class="dlAlsoLabel">Also:<\/span>/.test(ins2) && ins2.includes(`href="/insights/${p1.slug}"`) && !/data-insights=/.test(ins2));
  const nw = cardHtml(full, "news") ?? "";
  const newsRows = [...nw.matchAll(/<li class="dlNewsRow" data-news-row="">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  const thumbOk = (row, item) => item.thumb
    ? new RegExp(`^<img (?=[^>]*class="dlNewsThumb")(?=[^>]*src="${item.thumb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}")(?=[^>]*alt="")(?=[^>]*width="44")(?=[^>]*loading="lazy")[^>]*>`).test(row)
    : /^<div class="dlNewsThumb" data-news-thumb="logo"><div[^>]*><img src="\/logos\/[A-Z]+\.webp" alt=""/.test(row);
  want("C: four headlines, each a thumbnail (44 px, lazy, alt=\"\") or the company's logo, then the headline on one line",
    newsRows.length === 4 && FULL_LANDING.cards.news.some((n) => !n.thumb) && newsRows.every((r, i) => thumbOk(r, FULL_LANDING.cards.news[i]) && /<a class="dlNewsTitle" href="https:[^"]*" target="_blank" rel="noopener noreferrer nofollow" title="/.test(r)) &&
    /\.dlNewsTitle\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap;/.test(css) && /href="\/headlines"/.test(nw));

  // ── E. System ──
  const eyebrows = [...(full + mFull).matchAll(/class="dlEyebrow" style="color:(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
  want("E: one accent per eyebrow, from the existing hues only", eyebrows.length === 8 && eyebrows.every((h) => HUES.includes(h)));
  const only = full.slice(full.indexOf('data-section="only"'), full.indexOf('data-section="week"'));
  want("E: one data-credit line per section (the head), none per block", tiingoLinks(only) === 1 && tiingoLinks(only.slice(only.indexOf("dlSectionHead"), only.indexOf("data-open-row"))) === 1 && tiingoLinks(week) === 0);

  // Describes, never advises.
  for (const [name, html] of [["the cards", full], ["the empty cards", empty], ["Market today", mFull]]) {
    const hit = text(html).match(/\b(buy|sell|should|must|recommend)\b/i);
    want(`${name} use no advice words${hit ? ` (found "${hit[0]}")` : ""}`, !hit);
  }
  return fails;
}

/** The wiring, read as source. */
function wiring(client, page, cardsSrc, root = read(ROOT)) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const c = stripComments(client, { file: CLIENT }), p = stripComments(page, { file: PAGE });
  const base = mediaFree(c);
  want("the page reads the landing through the budget", /budget\("landing", getDashboardLanding\(\)/.test(p));
  want("the page hands the landing to the client", /landing=\{\{\s*market: <MarketToday m=\{landing\.market\} \/>,\s*cards: <LandingCards c=\{landing\.cards\}(?: hasFiledEarnings=\{await filedEarningsGate\(\)\})? \/>/.test(p));
  // A. The hero: the brief's lead line, the four Try chips, two columns from 860 px; no tape, no benchmarks row.
  want("A: the hero's lead line is the brief's", /<p className="dlLead">Every figure traced to an SEC filing, every chart explained in plain English, with supply-chain maps you won&apos;t find elsewhere\.<\/p>/.test(c));
  want("A: the Try chips are NVDA, TSLA, JPM, AMZN and nothing else", /const TRY_SYMBOLS = \["NVDA", "TSLA", "JPM", "AMZN"\];/.test(c) && !/Scan for ideas/.test(c));
  want("A: the hero is two columns from 860 px, stacked below", /\.dlHero\{display:grid;grid-template-columns:minmax\(0,1\.1fr\) minmax\(0,1fr\);/.test(base) && /@media\(max-width:859px\)\{\.dlHero\{grid-template-columns:minmax\(0,1fr\);\}\}/.test(c) && /\.dlHeroLeft\{display:flex;flex-direction:column;justify-content:center;/.test(base));
  want("A: the live ticker tape is off the landing", /\{landing \? null : <DashboardTicker credit=\{tiingoCredit\} \/>\}/.test(c));
  want("A: the Market Benchmarks row is off the landing", /\{landing \? null : \(\s*<div className="msh-lower">\s*<BenchmarksPanel \/>/.test(c));
  // D. The analyser: an H2, one card, the head with "Change stock…", the links; #analyser kept.
  want("D: \"Analyse any stock\" is an H2 over one card that holds the head, the panels and the links",
    /<section id="analyser" ref=\{analyserRef\} className="dlAnalyser" aria-labelledby="dlAnalyserTitle">\s*<h2 id="dlAnalyserTitle" className="dlH2">Analyse any stock<\/h2>\s*<div className="dlAnalyserCard" data-analyser-card="">\s*\{AnalyserHead\(\)\}\s*\{errBox\}\s*\{grids\}\s*\{AnalyserFoot\(\)\}/.test(c));
  want("D: the head: logo, symbol, name, price, and a compact \"Change stock…\" search", /data-analyser-id=""/.test(c) && /data-analyser-price=""/.test(c) && /<div className="msh-searchbox dlChange" ref=\{mobileSearchBoxRef\} data-change-stock="">/.test(c) && /placeholder="Change stock…"/.test(c) && /data-verdict=""/.test(c));
  want("D: the Supply map and stock page links in the card's foot", /function AnalyserFoot\(\)[\s\S]*data-bottlenecks-link=""[\s\S]*stock page →/.test(c));
  want("D: the tabs: icon beside the label at 641 px and up, over it at 640 and under; full names in aria-label and title",
    /\.dlTab\{[^}]*flex-direction:row;/.test(base) && /@media\(max-width:640px\)\{\.dlTab\{flex-direction:column;/.test(c) && /\.dlTabIcon\{display:block;/.test(base) && !/\.dlTab(Icon|Short)\{[^}]*display:none/.test(c) &&
    /aria-label=\{t\.label\} title=\{t\.label\} data-tab=\{t\.key\} className="dlTab"/.test(c) && /<span className="dlTabShort" aria-hidden="true">\{t\.short\}<\/span>/.test(c) && !/dlTabFull/.test(c));
  want("at 480 px and under: a scroll strip, never the page sideways", /@media\(max-width:480px\)\{\.dlTabs\{overflow-x:auto;/.test(c));
  want("D: the Breakdown collapsed by default (\"Breakdown ▸\") at every width on the landing", /const breakdown = landing \? <MobileBreakdownAccordion \/> : <BreakdownPanel \/>;/.test(c) && /const \[breakdownOpen, setBreakdownOpen\] = useState\(false\);/.test(c) && /Breakdown <span aria-hidden="true">\{breakdownOpen \? "▾" : "▸"\}<\/span>/.test(c) && /data-breakdown=\{breakdownOpen \? "open" : "collapsed"\}/.test(c));
  want("a ?symbol= or #analyser deep link scrolls to the analyser", /if \(!landing \|\| !wantsAnalyser\(window\.location\.hash, deepSymbol\)\) return;\s*return holdOnAnalyser\(\(\) => analyserRef\.current\);/.test(c) && /const deepSymbol = searchParams\.get\("symbol"\)/.test(c));
  want("a hero pick routes through chooseSymbol, then scrolls to the analyser", /function pickFromHero\([^)]*\) \{\s*chooseSymbol\(sym, name, "stock"\);[\s\S]{0,120}analyserRef\.current\?\.scrollIntoView/.test(c));
  want("the hero is called as a function, so the search input keeps its identity", /\{LandingHero\(\)\}/.test(c) && !/<LandingHero\s*\/>/.test(c) && !/<AnalyserHead\s*\/>/.test(c));
  want("the two search boxes share the query; only the one last focused shows it and its list", /value=\{searchFrom === "hero" \? query : ""\}/.test(c) && /value=\{searchFrom === "change" \? query : ""\}/.test(c) && /open && searchFrom === "hero" && results\.length > 0/.test(c) && /open && searchFrom === "change" && results\.length > 0/.test(c));
  want("the landing's H1 is the brief's", /<h1 className="dlH1">Stock research from the filings, not the hype\.<\/h1>/.test(c));
  want("the old header H1 stays off the landing", /\{!landing \? \(<>\s*<div className="msh-hero">/.test(c));
  const d = stripComments(cardsSrc, { file: CARDS_SRC });
  // The data: the index row from the newest-bar blob, the mover from the pickers payload, 3 + 3, 4 headlines; the key bumped.
  want("A: the index row reads the newest-bar blob (no new read)", /const eod = await readTiingoEodLast\(\)\.catch\(\(\) => null\);/.test(d) && /INDEX_ROW\.flatMap/.test(d));
  want("A: the mover comes from the pickers payload the screens already read", /mover: biggestMover\(data\.tickerFeed\?\.topMovers \?\? \[\]\),/.test(d) && /\["dashboard-screen-counts-v3"\]/.test(d));
  want("C: three earnings names a week, named from the committed snapshot", /export const EARNINGS_ROWS = 3;/.test(d) && /top: c\.items\.slice\(0, EARNINGS_ROWS\)\.map\(\(i\) => \(\{ symbol: i\.symbol, name: cleanName\(snapshotCompanyName\(i\.symbol\)\) \|\| i\.symbol, day: shortDay\(i\.estimatedOn\) \}\)\)/.test(d));
  want("C: four headlines from the top preset names' own news", /export const NEWS_SYMBOLS = 5, NEWS_SHOWN = 4;/.test(d) && /PRESET_UNIVERSE\.slice\(0, NEWS_SYMBOLS\)/.test(d) && /getStockNewsBaseData\(sym, \{ maxDetailedItems: 5 \}\)/.test(d));
  want("C: the insight card reads the newest two posts (one featured, one \"Also\")", /export const INSIGHTS_SHOWN = 2;/.test(d) && /getAllPosts\(\)\.slice\(0, INSIGHTS_SHOWN\)/.test(d));
  want("E: the landing cache key bumped (v6), 15 minutes", /unstable_cache\(loadDashboardLanding, \["dashboard-landing-v6"\], \{ revalidate: 900/.test(d));
  want("news thumbnails come from the stored image (where allowed) or the art library, no new read",
    /if \(SHOW_PUBLISHER_IMAGES && image && \/\^https:\\\/\\\/\/\.test\(image\)\) return \{ \.\.\.n, thumb: image \};/.test(d) && /const art = artFor\(n\.symbol, n\.title, `dash-news:\$\{n\.url\}`, taken\);/.test(d) && !/\bfetch\(/.test(d));
  want("the title is the hero line; /dashboard canonicalises to \"/\" (#149 §1)", /const DASHBOARD_TITLE = "Stock research from the filings, not the hype \| MyStockHarbor";/.test(p) && /title: DASHBOARD_TITLE,/.test(p) && /canonical: "https:\/\/www\.mystockharbor\.com\/",/.test(p));
  const r = stripComments(root, { file: ROOT });
  want("\"/\" renders the dashboard's page, with no phone-only branch", /import DashboardPage from "\.\/dashboard\/page";/.test(r) && /<DashboardPage searchParams=\{searchParams\} \/>/.test(r) && !/HomePageRouter|MobileHomePage|user-agent|headers\(\)/i.test(r));
  want("\"/\" keeps its title, canonical and structured data", /title: "Stock Analysis Tools, Stock Pickers & Market Insights \| MyStockHarbor",/.test(r) && /canonical: "https:\/\/www\.mystockharbor\.com\/",/.test(r) &&
    /type="application\/ld\+json"/.test(r) && /"@type": "WebSite"/.test(r) && /"@type": "WebApplication"/.test(r));
  want("every curated ETF has a name", ETFS.every((t) => typeof ETF_NAMES[t] === "string" && ETF_NAMES[t].length > 3) && /initialSymbolName \|\| ETF_NAMES\[defaultSymbol\.toUpperCase\(\)\]/.test(c));
  // #160: the Filed earnings tab is the stock page's snapshot card.
  want("the Filed earnings tab's card is called, not mounted", /else if \(tab === "earnings"\) body = SectionCard\(\{/.test(c));
  want("the Filed earnings tab draws the stock page's snapshot, with the brief's empty state", /<FiledEarningsChart symbol=\{symbol\} \/>/.test(c) && /Filed figures not available for \{symbol\}\./.test(c));
  return fails;
}

console.log("1. The landing on full and empty fixtures (A, B, C, E)");
const landingSrc = read(LANDING);
const real = rules(await loadLanding(landingSrc));
check("the real landing passes every rule", real.length === 0, real.slice(0, 4).join("; "));

console.log("\n2. The wiring (A, D, E)");
const clientSrc = read(CLIENT), pageSrc = read(PAGE), cardsSrc = read(CARDS_SRC), rootSrc = read(ROOT);
const realWiring = wiring(clientSrc, pageSrc, cardsSrc);
check("the real page, client and data module pass every wiring rule", realWiring.length === 0, realWiring.join("; "));

console.log("\n3. Planted mutants");
const LANDING_MUTANTS = [
  // A
  ["A: the thermometer back in Market today", '<MarketMoodCard view={m.mood} variant="gauge" />', "<MarketMoodCard view={m.mood} />"],
  ["A: an index tile dropped", "if (!r) return null;", 'if (!r || x.symbol === "IWM") return null;'],
  ["A: the index row stays 4 across on a phone", ".dlIdx{grid-template-columns:repeat(2,minmax(0,1fr));}", ""],
  ["A: the trend / best-sector line dropped", '{line ? <p className="dlMarketLine" data-market-line="">{line}</p> : null}', ""],
  ["A: Market today says nothing when empty", '{!shown ? <p className="dlEmpty" data-card="market" data-empty="">{EMPTY.market}</p> : null}', ""],
  ["A: a second credit in Market today", "<span className=\"dlIdxSym\">{x.symbol}</span>", "<span className=\"dlIdxSym\">{x.symbol}</span>{credit}"],
  ["A: the mover worded as a signal", "Biggest mover today", "Top buy signal today"],
  ["A: the mover line dropped", "{c.pickers.mover ? (", "{false ? ("],
  // B
  ["B: the hub feature back in a card", '<div className="dlOpen" data-open="hub">', '<div className="dlOpen dlCard" data-open="hub">'],
  ["B: the open features get a card background", ".dlOpen{display:flex;flex-direction:column;gap:10px;min-width:0;}", ".dlOpen{display:flex;flex-direction:column;gap:10px;min-width:0;background:#0d1422;}"],
  ["B: the divider dropped", "padding:4px 0 24px;border-bottom:1px solid #1f2b44;}", "padding:4px 0 24px;}"],
  ["B: the open features never stack", "@media(max-width:1023px){.dlOpenRow{grid-template-columns:minmax(0,1fr);gap:28px;}}", ""],
  ["B: the hub feature loses its empty state", '<p className="dlEmpty" data-card="hub" data-empty="">{EMPTY.hub}</p>', ""],
  ["B: the capex feature loses its empty state", '<p className="dlEmpty" data-card="capex" data-empty="">{EMPTY.capex}</p>', "null"],
  ["B: all 11 sectors drawn again", "<SectorBars rows={sectorRows(c.sectors.rows)}", "<SectorBars rows={c.sectors.rows}"],
  ["B: the screens and sectors cards stay side by side on a phone", "@media(max-width:640px){.dlRow2{grid-template-columns:minmax(0,1fr);}}", ""],
  ["a Pickers screen links off the picker routes", "<Link href={s.href} prefetch={false}>{s.label}</Link>", "<Link href={s.href + \"-x\"} prefetch={false}>{s.label}</Link>"],
  ["the capex feature advises", "From each company&apos;s filings.", "You should buy these. From each company&apos;s filings."],
  ["a line runs company to company", "d={`M40 ${hubY} L66 ${cy(i)} H80`}", "d={`M0 ${cy(i)} H80`}"],
  // C
  ["C: the cards no longer stretch to one height", ".dlRow{display:grid;gap:16px;align-items:stretch;}", ".dlRow{display:grid;gap:16px;align-items:start;}"],
  ["C: a card's footer no longer pinned to the bottom", ".dlMore{margin-top:auto;", ".dlMore{margin-top:6px;"],
  ["C: This week never stacks", "@media(max-width:860px){.dlRow3{grid-template-columns:minmax(0,1fr);}}", ""],
  ["C: the per-row date back", "                                <span className=\"dlEarnCo\">{e.name}</span>\n                              </Link>", "                                <span className=\"dlEarnCo\">{e.name}</span> {e.day}\n                              </Link>"],
  ["C: the earnings fine line dropped", "<p className=\"dlFine\" data-fine-print=\"\"><strong style={{ color: \"#f59e0b\" }}>Estimated</strong> from", "<p className=\"dlFine\" data-fine-print=\"\">From"],
  ["C: the earnings card loses its empty state", "empty={c.earnings ? null : EMPTY.earnings}", "empty={null}"],
  ["C: the \"Also:\" row dropped", "{also ? <p className=\"dlAlso\"", "{false ? <p className=\"dlAlso\""],
  ["C: the insight card loses its empty state", "empty={featured ? null : EMPTY.insight}", "empty={null}"],
  ["C: a headline wraps", ".dlNewsTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}", ".dlNewsTitle{min-width:0;}"],
  ["C: a headline without a picture loses its logo", "<div className=\"dlNewsThumb\" data-news-thumb=\"logo\"><TickerLogo symbol={n.symbol} size={28} radius={7} alt=\"\" /></div>", "null"],
  ["C: a news thumbnail loses lazy loading", 'width={44} height={44} loading="lazy"', "width={44} height={44}"],
  ["C: the news card loses its empty state", "empty={c.news ? null : EMPTY.news}", "empty={null}"],
  ["the screens card loses its empty state", "empty={c.pickers ? null : EMPTY.pickers}", "empty={null}"],
  ["the sectors card loses its empty state", "empty={c.sectors ? null : EMPTY.sectors}", "empty={null}"],
  // E
  ["E: a new eyebrow hue", 'tone="#38bdf8"', 'tone="#ff00aa"'],
  ["E: a credit per block again", "<p className=\"dlFine\" data-fine-print=\"\">Cap-weighted across each sector&apos;s tracked stocks;", "<p className=\"dlFine\" data-fine-print=\"\">{credit} Cap-weighted across each sector&apos;s tracked stocks;"],
];
for (const [label, from, to] of LANDING_MUTANTS) {
  if (!landingSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = rules(await loadLanding(landingSrc.split(from).join(to)));
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no rule failed");
}
const WIRING_MUTANTS = [
  ["A: the old lead line", /<p className="dlLead">Every figure traced to an SEC filing[^<]*<\/p>/, '<p className="dlLead">Every figure traced to the SEC filing or the price it came from.</p>', CLIENT],
  ["A: \"Scan for ideas\" back in the hero", /\{TRY_SYMBOLS\.map\(\(t\) => <button key=\{t\} type="button" className="dlTryChip" onClick=\{\(\) => pickFromHero\(t\)\}>\{t\}<\/button>\)\}/, '{TRY_SYMBOLS.map((t) => <button key={t} type="button" className="dlTryChip" onClick={() => pickFromHero(t)}>{t}</button>)}<Link href="/pickers" className="dlTryChip">Scan for ideas →</Link>', CLIENT],
  ["A: the hero stacks until 960 px", /@media\(max-width:859px\)\{\.dlHero/, "@media(max-width:960px){.dlHero", CLIENT],
  ["A: the ticker tape back on the landing", /\{landing \? null : <DashboardTicker credit=\{tiingoCredit\} \/>\}/, "<DashboardTicker credit={tiingoCredit} />", CLIENT],
  ["A: the Market Benchmarks row back on the landing", /\{landing \? null : \(\s*<div className="msh-lower">/, '{(\n          <div className="msh-lower">', CLIENT],
  ["A: the index row on a new read", /const eod = await readTiingoEodLast\(\)\.catch\(\(\) => null\);/, 'const eod = await readIndexQuotes("SPY,QQQ,DIA,IWM");', CARDS_SRC],
  ["D: the analyser loses its anchor", /<section id="analyser" ref=\{analyserRef\}/, "<section ref={analyserRef}", CLIENT],
  ["D: the analyser card dropped (panels loose under the H2)", /<div className="dlAnalyserCard" data-analyser-card="">/, '<div className="dlAnalyserLoose">', CLIENT],
  ["D: no \"Change stock…\" search in the head", /placeholder="Change stock…"/, 'placeholder=""', CLIENT],
  ["D: the tabs stacked at every width again", /\.dlTab\{flex:1 1 0;min-width:0;display:inline-flex;flex-direction:row;/, ".dlTab{flex:1 1 0;min-width:0;display:inline-flex;flex-direction:column;", CLIENT],
  ["D: the tabs beside their label on a phone too", /@media\(max-width:640px\)\{\.dlTab\{flex-direction:column;gap:4px;padding:8px 6px;\}\}/, "", CLIENT],
  ["D: the tabs lose their accessible full names", /aria-label=\{t\.label\} title/, "title", CLIENT],
  ["D: the tooltip dropped", / title=\{t\.label\} data-tab/, " data-tab", CLIENT],
  ["D: the tabs wrap on a phone", /@media\(max-width:480px\)\{\.dlTabs\{overflow-x:auto;/, "@media(max-width:480px){.dlTabs{flex-wrap:wrap;", CLIENT],
  ["D: the Breakdown open on desktop again", /const breakdown = landing \? <MobileBreakdownAccordion \/> : <BreakdownPanel \/>;/, "const breakdown = <BreakdownPanel />;", CLIENT],
  ["D: the Breakdown open on arrival", /const \[breakdownOpen, setBreakdownOpen\] = useState\(false\);/, "const [breakdownOpen, setBreakdownOpen] = useState(true);", CLIENT],
  ["the deep link no longer scrolls", /if \(!landing \|\| !wantsAnalyser\(window\.location\.hash, deepSymbol\)\) return;\s*return holdOnAnalyser\(\(\) => analyserRef\.current\);/, "if (!landing || !wantsAnalyser(window.location.hash, deepSymbol)) return;", CLIENT],
  ["the hero mounted as a component again", /\{LandingHero\(\)\}/, "<LandingHero />", CLIENT],
  ["both search boxes show the query at once", /value=\{searchFrom === "change" \? query : ""\}/, "value={query}", CLIENT],
  ["the title reverted", /const DASHBOARD_TITLE = "[^"]*";/, 'const DASHBOARD_TITLE = "Stock Chart Dashboard | MyStockHarbor";', PAGE],
  ["/dashboard canonical back on itself", /canonical: "https:\/\/www\.mystockharbor\.com\/",/, 'canonical: "https://www.mystockharbor.com/dashboard",', PAGE],
  ["the landing read unbudgeted", /budget\("landing", (getDashboardLanding\(\)\.catch\(\(\) => EMPTY_LANDING\)), EMPTY_LANDING\)/, "$1", PAGE],
  ["\"/\" back on the phone-only router", /<DashboardPage searchParams=\{searchParams\} \/>/, "<HomePageRouter initialIsMobile={false} />", ROOT],
  ["\"/\" loses its structured data", /"@type": "WebApplication",/, '"@type": "Thing",', ROOT],
  ["C: four earnings names a week again", /export const EARNINGS_ROWS = 3;/, "export const EARNINGS_ROWS = 4;", CARDS_SRC],
  ["C: three headlines again", /NEWS_SHOWN = 4;/, "NEWS_SHOWN = 3;", CARDS_SRC],
  ["C: earnings names from a live read", /name: cleanName\(snapshotCompanyName\(i\.symbol\)\) \|\| i\.symbol/, "name: (await getCompanyNameMap()).get(i.symbol) ?? i.symbol", CARDS_SRC],
  ["E: the landing cache key not bumped", /\["dashboard-landing-v6"\]/, '["dashboard-landing-v5"]', CARDS_SRC],
  ["the thumbnails read the publisher picture regardless", /if \(SHOW_PUBLISHER_IMAGES && image && /, "if (image && ", CARDS_SRC],
  ["the Filed earnings tab's card mounted", /else if \(tab === "earnings"\) body = SectionCard\(\{/, 'else if (tab === "earnings") body = <SectionCard title="x">{null}</SectionCard>; else if (false) body = SectionCard({', CLIENT],
];
for (const [label, from, to, file] of WIRING_MUTANTS) {
  const src = file === CLIENT ? clientSrc : file === PAGE ? pageSrc : file === ROOT ? rootSrc : cardsSrc;
  const m = src.replace(from, to);
  if (m === src) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = file === CLIENT ? wiring(m, pageSrc, cardsSrc) : file === PAGE ? wiring(clientSrc, m, cardsSrc) : file === ROOT ? wiring(clientSrc, pageSrc, cardsSrc, m) : wiring(clientSrc, pageSrc, m);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no rule failed");
}

// 7. THE FILED EARNINGS TAB (#563 COWORK #160, replacing #154 §6's custom chart):
// the stock page's Earnings snapshot, rendered unchanged. Rules on the reader and
// route as source; the tab's body rendered against A's card rendered directly.
console.log("\n7. The Filed earnings tab");
const FE_DATA = "lib/server/dashboardEarnings.ts", FE_ROUTE = "app/api/dashboard-earnings/[symbol]/route.ts", FE_CHART = "app/dashboard/FiledEarningsChart.tsx";
const SNAP = JSON.parse(read("scripts/fixtures/measure-earnings-snapshot-AAPL.json"));
const { default: Card } = await import("../app/components/LatestEarningsCard.tsx");
function earningsTab(dataSrc, routeSrc, chartSrc, chartMod) {
  const fails = [], want = (l, ok) => { if (!ok) fails.push(l); };
  const dsrc = stripComments(dataSrc, { file: FE_DATA }), rsrc = stripComments(routeSrc, { file: FE_ROUTE }), csrc = stripComments(chartSrc, { file: FE_CHART });
  want("the reader is the stock page's snapshot, unchanged (no second reading of the filings)", /import \{ getSecEarningsSnapshot \} from "@\/lib\/server\/secEarningsSnapshot";/.test(dsrc) &&
    /const snapshot = await getSecEarningsSnapshot\(symbol\);/.test(dsrc) && /return snapshot;/.test(dsrc) && !/buildSecEarningsView|buildGrowthVisuals|readFactSet\(|FILED_PERIODS/.test(dsrc));
  want("not-yet-read (or an unreadable store) is never cached; the cache is an hour per symbol", /if \(snapshot\.awaitingRead\) throw new NotSettled\(\);/.test(dsrc) && /unstable_cache\(loadDashboardEarnings, \["dashboard-earnings-snapshot-v1"\], \{ revalidate: 3600/.test(dsrc));
  want("the route: BotID first, the CDN window only on a settled answer, no-store otherwise", /if \(await isUnwantedBot\(\)\)/.test(rsrc) && /"Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"/.test(rsrc) &&
    /if \(e instanceof NotSettled\) return NextResponse\.json\(\{ symbol: cleanSymbol\(symbol\), available: false \}, \{ headers: \{ "Cache-Control": "no-store" \} \}\);/.test(rsrc) && /status: 503, headers: \{ "Cache-Control": "no-store" \}/.test(rsrc) &&
    /\{ path: "\/api\/dashboard-earnings\/\*", method: "GET" \}/.test(read("instrumentation-client.ts")));
  want("the card is A's LatestEarningsCard, imported, not copied (no chart of the tab's own)", /import LatestEarningsCard from "@\/app\/components\/LatestEarningsCard";/.test(csrc) && !/<svg|<rect |<polyline/.test(csrc));
  const body = (props) => { try { return renderToStaticMarkup(React.createElement(chartMod.FiledEarningsBody, props)); } catch (e) { return `THREW ${e.message}`; } };
  const direct = renderToStaticMarkup(React.createElement(Card, { snapshot: SNAP, symbol: "AAPL", hasFiledEarnings: true }));
  want("with a snapshot, the tab is exactly the stock page's card (same markup)", body({ symbol: "AAPL", data: SNAP, failed: false, hasFiledEarnings: true }) === `<div class="fe" data-filed-earnings="snapshot">${direct}</div>` && /snapshotMetricsWrap/.test(direct));
  const unfiled = renderToStaticMarkup(React.createElement(Card, { snapshot: SNAP, symbol: "AAPL", hasFiledEarnings: false }));
  want("the card's earnings link follows hasFiledEarnings (#552 COWORK #197)", unfiled !== direct && body({ symbol: "AAPL", data: SNAP, failed: false, hasFiledEarnings: false }) === `<div class="fe" data-filed-earnings="snapshot">${unfiled}</div>`);
  const spy = body({ symbol: "SPY", data: { symbol: "SPY", available: false }, failed: false, hasFiledEarnings: false });
  want("a fund (no snapshot) keeps the empty state, with no card and no earnings link", spy.includes("Filed figures not available for SPY.") && !/snapshotMetricsWrap|\/earnings"/.test(spy));
  want("a failed fetch is the empty state; no answer yet is loading", body({ symbol: "MSFT", data: null, failed: true, hasFiledEarnings: true }).includes("Filed figures not available for MSFT.") &&
    body({ symbol: "MSFT", data: null, failed: false, hasFiledEarnings: true }).includes("Loading the filed figures"));
  return fails;
}
const feData = read(FE_DATA), feRoute = read(FE_ROUTE), feChartSrc = read(FE_CHART);
async function loadChart(src) {
  const file = path.join("app/dashboard", `.check-fe-${process.pid}-${seq++}.tsx`);
  fs.writeFileSync(file, src);
  try { return await import(pathToFileURL(path.resolve(file)).href); } finally { fs.rmSync(file, { force: true }); }
}
const feReal = earningsTab(feData, feRoute, feChartSrc, await loadChart(feChartSrc));
check("the reader, the route and the tab pass every rule", feReal.length === 0, feReal.join("; "));
for (const [label, file, from, to] of [
  ["a second reader (the old cut-down view)", FE_DATA, "const snapshot = await getSecEarningsSnapshot(symbol);", "const snapshot = await getSecEarningsSnapshot(symbol); buildSecEarningsView;"],
  ["not-yet-read cached as none", FE_DATA, "if (snapshot.awaitingRead) throw new NotSettled();", ""],
  ["a failed read pinned to the CDN", FE_ROUTE, 'return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });', 'return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "public, s-maxage=3600" } });'],
  ["the card copied, not imported", FE_CHART, 'import LatestEarningsCard from "@/app/components/LatestEarningsCard";', 'const LatestEarningsCard = ({ snapshot }: { snapshot: { symbol: string }; symbol: string; hasFiledEarnings: boolean }) => <section className="snapshotMetricsWrap">{snapshot.symbol}</section>;'],
  ["the card's earnings link forced on", FE_CHART, "<LatestEarningsCard snapshot={data} symbol={symbol} hasFiledEarnings={p.hasFiledEarnings} />", "<LatestEarningsCard snapshot={data} symbol={symbol} hasFiledEarnings />"],
  ["a fund handed to the card", FE_CHART, "if (!data?.available) {", "if (!data) {"],
]) {
  const src = file === FE_DATA ? feData : file === FE_ROUTE ? feRoute : feChartSrc;
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const m = src.replace(from, to);
  const fails = file === FE_CHART ? earningsTab(feData, feRoute, m, await loadChart(m)) : file === FE_DATA ? earningsTab(m, feRoute, feChartSrc, await loadChart(feChartSrc)) : earningsTab(feData, m, feChartSrc, await loadChart(feChartSrc));
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no rule failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
