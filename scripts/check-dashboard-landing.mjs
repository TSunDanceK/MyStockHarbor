// THE DASHBOARD LANDING'S RULES (#563 COWORK #134).
//
// Renders the landing's server parts (app/dashboard/DashboardLanding.tsx) with
// the repo's render hooks, on the measure's two fixtures: every source filled,
// and every source missing. It fails when:
//   1. a card is missing, or shows its empty state with data, or (all missing)
//      does not show its own empty-state words, or loses its section link;
//   2. "Market right now" with nothing to show does not say so;
//   3. a Pickers screen links outside PICKER_ROUTES;
//   4. the landing's words advise (buy, sell, should);
//   5. the wiring breaks: the page's landing read, the analyser's #analyser
//      anchor, the ?symbol= deep link's scroll, the hero search's scroll, the H1;
//   6. (#149) a news item has no thumbnail (60 px, lazy, alt="") or fallback, or
//      the thumbnails stop coming from the stored image / the art library; "/"
//      stops serving this page on every device, or loses its own SEO, or
//      /dashboard stops canonicalising to "/";
//   7. (#154) the capex star off its rows, the earnings card not a list, the
//      sectors card not saying what it measures, one insight on a wide screen,
//      the phone tabs wrapping or losing their names, or the Filed earnings tab
//      not the filed chart (its reader, route and bars checked here).
// Each card's empty state, the market's, the screen links and the deep-link
// scroll each get a planted mutant.
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
const { DASHBOARD_SCREENS } = await import("../lib/server/dashboardCards.ts").catch(() => ({ DASHBOARD_SCREENS: null }));
const { PICKER_ROUTES } = await import("../lib/pickerRoutes.ts");
const { ETF_NAMES } = await import("../lib/etfNames.ts");
const { etfs: ETFS } = await import("../lib/curatedSymbols.ts");

const LANDING = "app/dashboard/DashboardLanding.tsx";
const CLIENT = "app/components/DashboardClient.tsx";
const PAGE = "app/dashboard/page.tsx";
const CARDS_SRC = "lib/server/dashboardCards.ts";
const ROOT = "app/page.tsx";
const read = (p) => fs.readFileSync(p, "utf8");
const CARDS = ["hub", "capex", "pickers", "earnings", "sectors", "insight", "news"];

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

/** Every rule on one landing module; returns the failures. */
function rules(mod, scr = DASHBOARD_SCREENS) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  let full = "", empty = "", mFull = "", mEmpty = "";
  try {
    full = renderToStaticMarkup(React.createElement(mod.LandingCards, { c: FULL_LANDING.cards, hasFiledEarnings: () => true }));
    empty = renderToStaticMarkup(React.createElement(mod.LandingCards, { c: EMPTY_LANDING.cards, hasFiledEarnings: () => true }));
    mFull = renderToStaticMarkup(React.createElement(mod.MarketNow, { m: FULL_LANDING.market }));
    mEmpty = renderToStaticMarkup(React.createElement(mod.MarketNow, { m: EMPTY_LANDING.market }));
  } catch (e) {
    return [`the landing renders with every source filled and every source missing (${String(e.message).slice(0, 80)})`];
  }
  for (const id of CARDS) {
    const f = cardHtml(full, id), e = cardHtml(empty, id);
    want(`the ${id} card renders with data`, !!f);
    want(`the ${id} card renders with nothing`, !!e);
    if (!f || !e) continue;
    want(`the ${id} card shows no empty state with data`, !/data-empty/.test(f.slice(0, 80)));
    want(`the ${id} card says "${mod.EMPTY[id]}" with nothing`, /^data-card="[a-z]+" data-empty=""/.test(e) && text(e).includes(mod.EMPTY[id]));
    want(`the ${id} card keeps its section link with nothing`, /<a (?=[^>]*class="dlMore")(?=[^>]*href="\/[a-z0-9/-]*")[^>]*>/.test(e));
  }
  want("Market right now draws its tiles with data", (mFull.match(/data-tile=/g) ?? []).length === 3);
  want(`Market right now says "${mod.EMPTY.market}" with nothing`, text(mEmpty).includes(mod.EMPTY.market));
  // 3. The Pickers card's links, and the data module's screens, are real picker routes.
  const hrefs = [...(cardHtml(full, "pickers") ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h !== "/stock-screener");
  want("every Pickers screen links to a PICKER_ROUTES page", hrefs.length === 5 && hrefs.every((h) => PICKER_ROUTES.includes(h)));
  want("DASHBOARD_SCREENS are all PICKER_ROUTES pages", Array.isArray(scr) && scr.length === 5 && scr.every((s) => PICKER_ROUTES.includes(s.href)));
  // #142 §4: each news item carries its company's ticker, linking to that company's news page.
  const newsChips = [...(cardHtml(full, "news") ?? "").matchAll(/href="\/stock\/([A-Z.]+)\/news"[^>]*>([A-Z.]+)</g)];
  want("every news item links its ticker to that company's news page", newsChips.length === FULL_LANDING.cards.news.length && newsChips.every((m) => m[1] === m[2]));
  // #142 §1: the S&P tile says which close it is, and its date.
  want("the S&P tile names SPY and the close's date", /S&amp;P 500 \(SPY\)/.test(mFull) && text(mFull).includes("close on 6 Oct 2026"));
  // #141 §1: the capex columns say whose figure each one is.
  want("the capex columns say each figure is that company's own", text(cardHtml(full, "capex") ?? "").includes("their own capex") && text(cardHtml(full, "capex") ?? "").includes("their own filed sales"));
  // #148 §4: "Build your own screen" goes to the screener; each screen shows a peek of its members' logos.
  const pk = cardHtml(full, "pickers") ?? "";
  want("\"Build your own screen\" links to /stock-screener", /<a (?=[^>]*class="dlMore")(?=[^>]*href="\/stock-screener")[^>]*>/.test(pk));
  const peeks = [...pk.matchAll(/data-peek=""[^>]*>([\s\S]*?)<\/span>/g)].map((m) => (m[1].match(/<img src="\/logos\//g) ?? []).length);
  const wantPeeks = FULL_LANDING.cards.pickers.screens.filter((x) => x.peek.length).map((x) => x.peek.length);
  want("each screen shows its members' logos (up to 3)", peeks.length === wantPeeks.length && peeks.every((n, i) => n === wantPeeks[i] && n <= 3));
  // #154 §2: a list like the Pickers card: "12–18 Oct · 11 companies", then one company
  // per line (logo, bold ticker, its name truncated with the full name in title, the
  // estimated day), up to 4 a week, then "+N more in the calendar →".
  const ea = cardHtml(full, "earnings") ?? "";
  const weeks = [...ea.matchAll(/<div class="dlWeek" data-week="">([\s\S]*?)(?=<div class="dlWeek"|<p class="dlFine")/g)].map((m) => m[1]);
  const W = FULL_LANDING.cards.earnings.windows;
  want("the earnings card lists two weeks, each headed with its dates and count", weeks.length === 2 &&
    weeks.every((h, i) => h.includes(`<p class="dlWeekHead">${W[i].range} · ${W[i].count} companies</p>`)));
  want("each week lists up to 4 companies, one per line: logo, bold ticker, name (full name in title), estimated day", weeks.every((h, i) => {
    const rows = [...h.matchAll(/<li class="dlEarnRow" data-earn-row="">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    return rows.length === Math.min(4, W[i].top.length) && rows.every((r, k) => {
      const e = W[i].top[k], esc = (t) => t.replace(/&/g, "&amp;");
      return new RegExp(`title="${esc(e.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(r) && /<img src="\/logos\//.test(r) && r.includes(`<strong>${e.symbol}</strong>`) &&
        r.includes(`<span class="dlEarnCo">${esc(e.name)}</span>`) && r.includes(`<span class="dlEarnDay">${e.day} <em>Estimated</em></span>`);
    });
  }));
  want("the rest of each week is counted: \"+N more in the calendar →\"", weeks.every((h, i) => h.includes(`href="/earnings-calendar" class="dlEarnMore" data-earn-more="">+${W[i].count - W[i].top.length} more in the calendar →</a>`)));
  want("a long name truncates on one line with an ellipsis", /\.dlEarnCo\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap;/.test(mod.LANDING_CSS) && !/dlLogoChip|data-logo-chip/.test(ea));
  // #148 §3, lined up by #154 §1: every connector has one end on the hub (no line joins two
  // companies); each leaves its own row level, at that row's centre (rows 28 px, gap 8); the
  // hub sits on the middle row's centre; "the build-out" sits under it, on one line.
  const cx = cardHtml(full, "capex") ?? "";
  const hubY = Number(cx.match(/data-hub-y="([\d.]+)"/)?.[1] ?? NaN);
  const rowY = (i) => i * 36 + 14;
  const ins = [...cx.matchAll(/<path data-into-node="" data-row-y="([\d.]+)" d="([^"]+)"/g)], outs = [...cx.matchAll(/<path data-from-node="" data-row-y="([\d.]+)" d="([^"]+)"/g)];
  want("the capex star: each line level with its own row's centre and ending on the hub, never company to company",
    /data-capex-chart=""/.test(cx) && ins.length === 3 && outs.length === 3 &&
    ins.every((m, i) => Number(m[1]) === rowY(i) && m[2] === `M0 ${rowY(i)} H14 L40 ${hubY}`) && outs.every((m, i) => Number(m[1]) === rowY(i) && m[2] === `M40 ${hubY} L66 ${rowY(i)} H80`) &&
    (cx.match(/class="dlCxFill"/g) ?? []).length === 6 && (cx.match(/<img src="\/logos\//g) ?? []).length === 6);
  want("the hub sits on the middle row's centre, the label under it on one line", hubY === rowY(1) &&
    new RegExp(`<i class="dlCxHub" style="top:${hubY}px"`).test(cx) && new RegExp(`data-node="" style="top:${hubY + 12}px">the build-out<`).test(cx) &&
    /\.dlCxNodeLabel\{[^}]*white-space:nowrap;/.test(mod.LANDING_CSS) && /\.dlCxRow\{[^}]*height:28px;/.test(mod.LANDING_CSS) && /\.dlCapexChart\{[^}]*grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\);[^}]*align-items:end;/.test(mod.LANDING_CSS) && /<span class="dlCxSize" aria-hidden="true">the build-out<\/span>/.test(cx));
  // #148 §6: all eleven sectors on one diverging axis, with the S&P 500 reference line.
  const sc = cardHtml(full, "sectors") ?? "";
  const rowsSeen = (sc.match(/data-sector-row="/g) ?? []).length;
  const bars = [...sc.matchAll(/class="dlSecBar" data-tone="(up|down)" style="left:([\d.]+)%;width:([\d.]+)%"/g)];
  want("the sectors chart has all 11 rows, green right / red left of 0, and the S&P reference line",
    rowsSeen === 11 && /data-spx-ref=""/.test(sc) && /S&amp;P 500 \(SPY\)/.test(sc) && bars.length === 11 &&
    bars.every((b) => (b[1] === "up" ? Number(b[2]) === 50 : Math.abs(Number(b[2]) + Number(b[3]) - 50) < 0.01)));
  // #154 §3: the sectors card says what it measures.
  want("the sectors card is \"Sector growth · year to date\", with its one plain line", sc.includes(">Sector growth · year to date<") &&
    sc.includes(`<p class="dlRead dlSecWhat" data-sector-what="">${mod.SECTOR_WHAT.replace(/\u2019/g, "’")}</p>`) && /since 1 January, weighted by company size\.$/.test(mod.SECTOR_WHAT));
  // #154 §4: the newest two posts, the second shown only at 1024 px and up.
  const ins2 = cardHtml(full, "insight") ?? "";
  want("Insight of the day holds the two newest posts; the second shows at 1024 px and up only", ins2.includes(">Insight of the day<") && /data-insights="2"/.test(ins2) &&
    FULL_LANDING.cards.insights.every((p) => ins2.includes(`href="/insights/${p.slug}"`)) &&
    /\.dlInsights\[data-insights="2"\] \.dlInsight\+\.dlInsight\{display:none;\}/.test(mod.LANDING_CSS) && /@media\(min-width:1024px\)\{\.dlInsights\[data-insights="2"\]\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/.test(mod.LANDING_CSS));
  // #149 §2: a thumbnail left of every headline, the item's stored picture or the art library's, else the fallback block.
  const newsRows = [...(cardHtml(full, "news") ?? "").matchAll(/<li class="dlNewsRow">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  const thumbOk = (row, item) => item.thumb
    ? new RegExp(`^<img (?=[^>]*class="dlNewsThumb")(?=[^>]*src="${item.thumb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}")(?=[^>]*alt="")(?=[^>]*width="60")(?=[^>]*loading="lazy")[^>]*>`).test(row)
    : /^<span class="dlNewsThumb" data-news-thumb="fallback" aria-hidden="true"><\/span>/.test(row);
  want("every news item starts with its thumbnail (60 px, lazy, alt=\"\") or the fallback block, then the headline, then the chip",
    newsRows.length === FULL_LANDING.cards.news.length && FULL_LANDING.cards.news.some((n) => !n.thumb) && FULL_LANDING.cards.news.some((n) => n.thumb) &&
    newsRows.every((r, i) => thumbOk(r, FULL_LANDING.cards.news[i]) && /dlNewsThumb[\s\S]*<a href="https:[\s\S]*class="dlPill"/.test(r)));
  // 4. Describes, never advises.
  for (const [name, html] of [["the cards", full], ["the empty cards", empty], ["Market right now", mFull]]) {
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
  want("the page reads the landing through the budget", /budget\("landing", getDashboardLanding\(\)/.test(p));
  want("the page hands the landing to the client", /landing=\{\{\s*market: <MarketNow m=\{landing\.market\} \/>,\s*cards: <LandingCards c=\{landing\.cards\}(?: hasFiledEarnings=\{await filedEarningsGate\(\)\})? \/>/.test(p));
  want("the analyser carries the #analyser anchor", /<section id="analyser" ref=\{analyserRef\}/.test(c));
  want("a ?symbol= or #analyser deep link scrolls to the analyser", /if \(!landing \|\| !wantsAnalyser\(window\.location\.hash, deepSymbol\)\) return;\s*return holdOnAnalyser\(\(\) => analyserRef\.current\);/.test(c) && /const deepSymbol = searchParams\.get\("symbol"\)/.test(c));
  want("a hero pick routes through chooseSymbol, then scrolls to the analyser", /function pickFromHero\([^)]*\) \{\s*chooseSymbol\(sym, name, "stock"\);[\s\S]{0,120}analyserRef\.current\?\.scrollIntoView/.test(c));
  // #148 §2: the three points under the hero are gone.
  want("the three points under the hero are gone", !/dlPoints|"As filed"|Explained, not advised/.test(c));
  // #148 §1: the hero is called, never mounted as its own (render-local) component type.
  want("the hero is called as a function, so the search input keeps its identity", /\{LandingHero\(\)\}/.test(c) && !/<LandingHero\s*\/>/.test(c));
  want("the landing's H1 is the brief's", /<h1 className="dlH1">Stock research from the filings, not the hype\.<\/h1>/.test(c));
  want("the old header H1 stays off the landing", /\{!landing \? \(<>\s*<div className="msh-hero">/.test(c));
  const d = stripComments(cardsSrc, { file: CARDS_SRC });
  // #142 §4: the news card reads the largest preset names' own news, not the symbol-less market feed.
  want("the news card reads the top preset names' own news", /PRESET_UNIVERSE\.slice\(0, NEWS_SYMBOLS\)/.test(d) && /getStockNewsBaseData\(sym, \{ maxDetailedItems: 5 \}\)/.test(d) && !/getGeneralMarketHeadlines/.test(d));
  // #142 §1: the S&P tile reads SPY's latest stored close, not the weekly file.
  want("the S&P tile reads SPY's latest stored close", /const eod = await readTiingoHistory\("SPY"\)/.test(d) && !/spx-weekly\.json/.test(d));
  // #142 §2: the hero line is the title; the canonical stays.
  want("the title is the hero line; /dashboard canonicalises to \"/\" (#149 §1)", /const DASHBOARD_TITLE = "Stock research from the filings, not the hype \| MyStockHarbor";/.test(p) && /title: DASHBOARD_TITLE,/.test(p) && /canonical: "https:\/\/www\.mystockharbor\.com\/",/.test(p));
  // #149 §1: "/" renders this page on every device and keeps its own title, canonical and structured data.
  const r = stripComments(root, { file: ROOT });
  want("\"/\" renders the dashboard's page, with no phone-only branch", /import DashboardPage from "\.\/dashboard\/page";/.test(r) && /<DashboardPage searchParams=\{searchParams\} \/>/.test(r) &&
    !/HomePageRouter|MobileHomePage|user-agent|headers\(\)/i.test(r));
  want("\"/\" keeps its title, canonical and structured data", /title: "Stock Analysis Tools, Stock Pickers & Market Insights \| MyStockHarbor",/.test(r) && /canonical: "https:\/\/www\.mystockharbor\.com\/",/.test(r) &&
    /type="application\/ld\+json"/.test(r) && /"@type": "WebSite"/.test(r) && /"@type": "WebApplication"/.test(r));
  // #149 §2: thumbnails from what the news read already holds; no new fetch per render.
  want("news thumbnails come from the stored image (where allowed) or the art library, no new read",
    /if \(SHOW_PUBLISHER_IMAGES && image && \/\^https:\\\/\\\/\/\.test\(image\)\) return \{ \.\.\.n, thumb: image \};/.test(d) && /const art = artFor\(n\.symbol, n\.title, `dash-news:\$\{n\.url\}`, taken\);/.test(d) &&
    !/\bfetch\(/.test(d));
  // #142 §3: every curated ETF has a name, and the analyser seeds it.
  want("every curated ETF has a name", ETFS.every((t) => typeof ETF_NAMES[t] === "string" && ETF_NAMES[t].length > 3) && /initialSymbolName \|\| ETF_NAMES\[defaultSymbol\.toUpperCase\(\)\]/.test(c));
  want("the cards are cached with their sources (15 min)", /unstable_cache\(loadDashboardLanding, \["dashboard-landing-v5"\], \{ revalidate: 900/.test(stripComments(cardsSrc, { file: CARDS_SRC })));
  // #154 §2/§4 data: four names a week from the committed snapshot (no read), the newest two posts.
  want("the earnings rows: 4 a week, named from the committed snapshot, the estimated day", /export const EARNINGS_ROWS = 4;/.test(d) && /top: c\.items\.slice\(0, EARNINGS_ROWS\)\.map\(\(i\) => \(\{ symbol: i\.symbol, name: cleanName\(snapshotCompanyName\(i\.symbol\)\) \|\| i\.symbol, day: shortDay\(i\.estimatedOn\) \}\)\)/.test(d));
  want("the insight card reads the newest two posts", /export const INSIGHTS_SHOWN = 2;/.test(d) && /getAllPosts\(\)\.slice\(0, INSIGHTS_SHOWN\)/.test(d));
  // #154 §5: the tabs on one line on a phone: icon + short label, full name in aria-label and on desktop.
  want("the analyser tabs: full name in aria-label and on desktop; icon + short label on one line at 480 px and under",
    /aria-label=\{t\.label\} data-tab=\{t\.key\} className="dlTab"/.test(c) && /<span className="dlTabFull">\{t\.label\}<\/span><span className="dlTabShort" aria-hidden="true">\{t\.short\}<\/span>/.test(c) &&
    /short: "Chart"[\s\S]*short: "Levels"[\s\S]*short: "Zones"[\s\S]*short: "Earnings"[\s\S]*short: "News"/.test(c) &&
    /@media\(max-width:480px\)\{\.dlTabs\{flex-wrap:nowrap;overflow-x:auto;[^}]*\}[\s\S]*\.dlTab\{[^}]*flex-direction:column;[^}]*\}[\s\S]*\.dlTabFull\{display:none;\}\.dlTabShort\{display:inline;\}\}/.test(c));
  // #160 (replacing #154 §6): the Filed earnings tab is the stock page's snapshot card; its empty state the brief's words.
  want("the Filed earnings tab's card is called, not mounted (a mount remounts and refetches the chart each render)", /else if \(tab === "earnings"\) body = SectionCard\(\{/.test(c));
  want("the Filed earnings tab draws the stock page's snapshot, with the brief's empty state", /<FiledEarningsChart symbol=\{symbol\} \/>/.test(c) && /Filed figures not available for \{symbol\}\./.test(c) && !/The latest filed quarter reads/.test(c));
  return fails;
}

console.log("1–4. The landing on full and empty fixtures");
const landingSrc = read(LANDING);
const real = rules(await loadLanding(landingSrc));
check("the real landing passes every rule", real.length === 0, real.slice(0, 4).join("; "));

console.log("\n5. The wiring");
const clientSrc = read(CLIENT), pageSrc = read(PAGE), cardsSrc = read(CARDS_SRC), rootSrc = read(ROOT);
const realWiring = wiring(clientSrc, pageSrc, cardsSrc);
check("the real page, client and data module pass every wiring rule", realWiring.length === 0, realWiring.join("; "));

console.log("\n6. Planted mutants");
const LANDING_MUTANTS = [
  ["a news thumbnail loses lazy loading", 'width={60} height={60} loading="lazy"', 'width={60} height={60}'],
  ["a news item without a picture loses its fallback", '<span className="dlNewsThumb" data-news-thumb="fallback" aria-hidden="true" />', "null"],
  ["the thumbnail gets alt text", 'src={n.thumb} alt=""', "src={n.thumb} alt={n.title}"],
  ...CARDS.filter((id) => id !== "hub" && id !== "insight").map((id) => [`the ${id} card loses its empty state`, `empty={c.${id} ? null : EMPTY.${id}}`, "empty={null}"]),
  ["the insight card loses its empty state", "empty={c.insights ? null : EMPTY.insight}", "empty={null}"],
  ["#154 §1: the hub off the middle row", "const H = n * CX_ROW + (n - 1) * CX_GAP, hubY = H / 2;", "const H = n * CX_ROW + (n - 1) * CX_GAP, hubY = H / 3;"],
  ["#154 §1: the label back above the hub", "style={{ top: hubY + 12 }}>the build-out", "style={{ top: hubY - 30 }}>the build-out"],
  ["#154 §1: the lines no longer level with their rows", "d={`M0 ${cy(i)} H14 L40 ${hubY}`}", "d={`M0 ${(i + 0.5) * 30} L40 ${hubY}`}"],
  ["#154 §2: the earnings card back to chips", '<strong>{e.symbol}</strong>', '<span>{e.symbol}</span>'],
  ["#154 §2: the rest of the week not counted", "{w.count > w.top.length ? <Link", "{false ? <Link"],
  ["#154 §2: long names wrap instead of truncating", ".dlEarnCo{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", ".dlEarnCo{min-width:0;"],
  ["#154 §2: the full name dropped from title", "className=\"dlEarnName\" title={e.name}", "className=\"dlEarnName\""],
  ["#154 §3: the old eyebrow", 'eyebrow="Sector growth · year to date"', 'eyebrow="Sectors · year to date"'],
  ["#154 §3: the plain line dropped", '<p className="dlRead dlSecWhat" data-sector-what="">{SECTOR_WHAT}</p>', ""],
  ["#154 §4: one post only", "{c.insights.map((p, i) => (", "{c.insights.slice(0, 1).map((p, i) => ("],
  ["#154 §4: the second post on phones too", '.dlInsights[data-insights="2"] .dlInsight+.dlInsight{display:none;}', ""],
  ["the hub card loses its empty state", "empty={hub ? null : EMPTY.hub}", "empty={null}"],
  ["Market right now says nothing when empty", `{!m.mood && !tiles.length ? <p className="dlEmpty" data-card="market" data-empty="">{EMPTY.market}</p> : null}`, ""],
  ["a Pickers screen links off the picker routes", `<Link href={s.href} prefetch={false}>{s.label}</Link>`, `<Link href={s.href + "-x"} prefetch={false}>{s.label}</Link>`],
  ["the capex card advises", "From each company&apos;s filings.", "You should buy these. From each company&apos;s filings."],
  ["the screener link points back at /pickers", 'more={{ href: "/stock-screener", label: "Build your own screen" }}', 'more={{ href: "/pickers", label: "Build your own screen" }}'],
  ["the screens lose their logos", '{s.peek.length ? <span className="dlPeek"', '{false ? <span className="dlPeek"'],
  ["the earnings names lose their logos", '<TickerLogo symbol={e.symbol} size={20} radius={5} alt="" />', ""],
  ["a line runs company to company", "d={`M40 ${hubY} L66 ${cy(i)} H80`}", "d={`M0 ${cy(i)} H80`}"],
  ["the S&P reference line is dropped", '{spx !== null ? <i className="dlSecRef"', '{false ? <i className="dlSecRef"'],
  ["a falling sector's bar draws to the right", 'style={up ? { left: "50%", width: `${at(v) - 50}%` } : { left: `${at(v)}%`, width: `${50 - at(v)}%` }}', 'style={{ left: "50%", width: `${Math.abs(at(v) - 50)}%` }}'],
  ["a news chip links to the wrong page", "href={`/stock/${encodeURIComponent(n.symbol)}/news`}", "href={`/stock/${encodeURIComponent(n.symbol)}`}"],
  ["the S&P tile loses its date", "close on {day(m.spx.date)}", "latest close"],
  ["the capex columns lose whose figure it is", "Top spenders · their own capex", "Spending most"],
];
for (const [label, from, to] of LANDING_MUTANTS) {
  if (!landingSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = rules(await loadLanding(landingSrc.replace(from, to)));
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no rule failed");
}
const WIRING_MUTANTS = [
  ["the deep link no longer scrolls", CLIENT, /if \(!landing \|\| !wantsAnalyser\(window\.location\.hash, deepSymbol\)\) return;\s*return holdOnAnalyser\(\(\) => analyserRef\.current\);/, "if (!landing || !wantsAnalyser(window.location.hash, deepSymbol)) return;"],
  ["the analyser loses its anchor", CLIENT, /<section id="analyser" ref=\{analyserRef\}/, '<section ref={analyserRef}'],
  ["the hero mounted as a component again", CLIENT, /\{LandingHero\(\)\}/, "<LandingHero />"],
  ["the three points come back", CLIENT, /<div className="dlTry">/, '<div className="dlPoints"><h2>As filed</h2></div><div className="dlTry">'],
  ["the title reverted", PAGE, /const DASHBOARD_TITLE = "[^"]*";/, 'const DASHBOARD_TITLE = "Stock Chart Dashboard | MyStockHarbor";'],
  ["the ETF name seed dropped", CLIENT, /initialSymbolName \|\| ETF_NAMES\[defaultSymbol\.toUpperCase\(\)\] \|\| ""/, 'initialSymbolName'],
  ["the news card back on the market feed", CARDS_SRC, /getStockNewsBaseData\(sym, \{ maxDetailedItems: 5 \}\)/, "getGeneralMarketHeadlines()"],
  ["the S&P tile back on the weekly file", CARDS_SRC, /const eod = await readTiingoHistory\("SPY"\)/, 'const eod = await readWeekly("content/markets/spx-weekly.json")'],
  ["/dashboard canonical back on itself", PAGE, /canonical: "https:\/\/www\.mystockharbor\.com\/",/, 'canonical: "https://www.mystockharbor.com/dashboard",'],
  ["\"/\" back on the phone-only router", ROOT, /<DashboardPage searchParams=\{searchParams\} \/>/, "<HomePageRouter initialIsMobile={false} />"],
  ["\"/\" loses its structured data", ROOT, /"@type": "WebApplication",/, '"@type": "Thing",'],
  ["the thumbnails read the publisher picture regardless", CARDS_SRC, /if \(SHOW_PUBLISHER_IMAGES && image && /, "if (image && "],
  ["#154 §5: the tabs lose their accessible full names", CLIENT, /aria-label=\{t\.label\} data-tab/, "data-tab"],
  ["#154 §5: the tabs wrap on a phone", CLIENT, /\.dlTabs\{flex-wrap:nowrap;overflow-x:auto;/, ".dlTabs{flex-wrap:wrap;"],
  ["#154 §5: the short labels gone", CLIENT, /<span className="dlTabShort" aria-hidden="true">\{t\.short\}<\/span>/, ""],
  ["#154 §6: the tab's card mounted (remounts the chart)", CLIENT, /else if \(tab === "earnings"\) body = SectionCard\(\{/, 'else if (tab === "earnings") body = <SectionCard title="x">{null}</SectionCard>; else if (false) body = SectionCard({'],
  ["#154 §6: the tab back to one sentence", CLIENT, /: <FiledEarningsChart symbol=\{symbol\}[^\n]*\/>,/, ": <p className=\"dlRead\">The latest filed quarter reads <strong>{earningsSummary?.toneLabel}</strong>.</p>,"],
  ["#154 §2: earnings names from a live read", CARDS_SRC, /name: cleanName\(snapshotCompanyName\(i\.symbol\)\) \|\| i\.symbol/, "name: (await getCompanyNameMap()).get(i.symbol) ?? i.symbol"],
  ["#154 §4: the newest post only", CARDS_SRC, /export const INSIGHTS_SHOWN = 2;/, "export const INSIGHTS_SHOWN = 1;"],
  ["the landing read unbudgeted", PAGE, /budget\("landing", (getDashboardLanding\(\)\.catch\(\(\) => EMPTY_LANDING\)), EMPTY_LANDING\)/, "$1"],
];
for (const [label, file, from, to] of WIRING_MUTANTS) {
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
