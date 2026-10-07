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
//      anchor, the ?symbol= deep link's scroll, the hero search's scroll, the H1.
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
    full = renderToStaticMarkup(React.createElement(mod.LandingCards, { c: FULL_LANDING.cards }));
    empty = renderToStaticMarkup(React.createElement(mod.LandingCards, { c: EMPTY_LANDING.cards }));
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
  // #148 §5: two week-windows, each name a logo and a ticker.
  const ea = cardHtml(full, "earnings") ?? "";
  want("the earnings card shows two week-windows", (ea.match(/class="dlWeek"/g) ?? []).length === 2);
  want("each estimated name is a logo plus its ticker", (ea.match(/data-logo-chip=""/g) ?? []).length === FULL_LANDING.cards.earnings.windows.reduce((a, w) => a + w.top.length, 0) &&
    [...ea.matchAll(/data-logo-chip=""[^>]*>([\s\S]*?)<\/a>/g)].every((m) => /<img src="\/logos\//.test(m[1]) && /<span>[A-Z.]+<\/span>/.test(m[1])));
  // #148 §3: the flow chart; every connector has one end on the build-out node, so no line joins two companies.
  const cx = cardHtml(full, "capex") ?? "";
  const lines = [...cx.matchAll(/<line ([^>]*?)\/?>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/(x1|y1|x2|y2)="([\d.]+)"/g)].map((a) => [a[1], Number(a[2])])));
  const onNode = (l) => (l.x1 === 40 && l.y1 === 60) || (l.x2 === 40 && l.y2 === 60);
  want("the capex chart draws every line into or out of the build-out node, never company to company",
    /data-capex-chart=""/.test(cx) && lines.length === 6 && lines.every(onNode) && /data-node="">the build-out</.test(cx) &&
    (cx.match(/class="dlCxFill"/g) ?? []).length === 6 && (cx.match(/<img src="\/logos\//g) ?? []).length === 6);
  // #148 §6: all eleven sectors on one diverging axis, with the S&P 500 reference line.
  const sc = cardHtml(full, "sectors") ?? "";
  const rowsSeen = (sc.match(/data-sector-row="/g) ?? []).length;
  const bars = [...sc.matchAll(/class="dlSecBar" data-tone="(up|down)" style="left:([\d.]+)%;width:([\d.]+)%"/g)];
  want("the sectors chart has all 11 rows, green right / red left of 0, and the S&P reference line",
    rowsSeen === 11 && /data-spx-ref=""/.test(sc) && /S&amp;P 500 \(SPY\)/.test(sc) && bars.length === 11 &&
    bars.every((b) => (b[1] === "up" ? Number(b[2]) === 50 : Math.abs(Number(b[2]) + Number(b[3]) - 50) < 0.01)));
  // 4. Describes, never advises.
  for (const [name, html] of [["the cards", full], ["the empty cards", empty], ["Market right now", mFull]]) {
    const hit = text(html).match(/\b(buy|sell|should|must|recommend)\b/i);
    want(`${name} use no advice words${hit ? ` (found "${hit[0]}")` : ""}`, !hit);
  }
  return fails;
}

/** The wiring, read as source. */
function wiring(client, page, cardsSrc) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const c = stripComments(client, { file: CLIENT }), p = stripComments(page, { file: PAGE });
  want("the page reads the landing through the budget", /budget\("landing", getDashboardLanding\(\)/.test(p));
  want("the page hands the landing to the client", /landing=\{\{\s*market: <MarketNow m=\{landing\.market\} \/>,\s*cards: <LandingCards c=\{landing\.cards\} \/>/.test(p));
  want("the analyser carries the #analyser anchor", /<section id="analyser" ref=\{analyserRef\}/.test(c));
  want("a ?symbol= deep link scrolls to the analyser", /if \(!landing \|\| !cleanSymbol\(deepSymbol\)\) return;\s*analyserRef\.current\?\.scrollIntoView\(/.test(c) && /const deepSymbol = searchParams\.get\("symbol"\)/.test(c));
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
  want("the title is the hero line, the canonical unchanged", /const DASHBOARD_TITLE = "Stock research from the filings, not the hype \| MyStockHarbor";/.test(p) && /title: DASHBOARD_TITLE,/.test(p) && /canonical: "https:\/\/www\.mystockharbor\.com\/dashboard"/.test(p));
  // #142 §3: every curated ETF has a name, and the analyser seeds it.
  want("every curated ETF has a name", ETFS.every((t) => typeof ETF_NAMES[t] === "string" && ETF_NAMES[t].length > 3) && /initialSymbolName \|\| ETF_NAMES\[defaultSymbol\.toUpperCase\(\)\]/.test(c));
  want("the cards are cached with their sources (15 min)", /unstable_cache\(loadDashboardLanding, \["dashboard-landing-v3"\], \{ revalidate: 900/.test(stripComments(cardsSrc, { file: CARDS_SRC })));
  return fails;
}

console.log("1–4. The landing on full and empty fixtures");
const landingSrc = read(LANDING);
const real = rules(await loadLanding(landingSrc));
check("the real landing passes every rule", real.length === 0, real.slice(0, 4).join("; "));

console.log("\n5. The wiring");
const clientSrc = read(CLIENT), pageSrc = read(PAGE), cardsSrc = read(CARDS_SRC);
const realWiring = wiring(clientSrc, pageSrc, cardsSrc);
check("the real page, client and data module pass every wiring rule", realWiring.length === 0, realWiring.join("; "));

console.log("\n6. Planted mutants");
const LANDING_MUTANTS = [
  ...CARDS.filter((id) => id !== "hub").map((id) => [`the ${id} card loses its empty state`, `empty={c.${id} ? null : EMPTY.${id}}`, "empty={null}"]),
  ["the hub card loses its empty state", "empty={hub ? null : EMPTY.hub}", "empty={null}"],
  ["Market right now says nothing when empty", `{!m.mood && !tiles.length ? <p className="dlEmpty" data-card="market" data-empty="">{EMPTY.market}</p> : null}`, ""],
  ["a Pickers screen links off the picker routes", `<Link href={s.href} prefetch={false}>{s.label}</Link>`, `<Link href={s.href + "-x"} prefetch={false}>{s.label}</Link>`],
  ["the capex card advises", "From each company&apos;s filings.", "You should buy these. From each company&apos;s filings."],
  ["the screener link points back at /pickers", 'more={{ href: "/stock-screener", label: "Build your own screen" }}', 'more={{ href: "/pickers", label: "Build your own screen" }}'],
  ["the screens lose their logos", '{s.peek.length ? <span className="dlPeek"', '{false ? <span className="dlPeek"'],
  ["the earnings names lose their logos", '<TickerLogo symbol={s} size={18} radius={4} alt="" /><span>{s}</span>', '<span>{s}</span>'],
  ["a line runs company to company", '<line key={`out${y}`} data-from-node="" x1={40} y1={60} x2={80} y2={y}', '<line key={`out${y}`} data-from-node="" x1={0} y1={y} x2={80} y2={y}'],
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
  ["the deep link no longer scrolls", CLIENT, /if \(!landing \|\| !cleanSymbol\(deepSymbol\)\) return;\s*analyserRef\.current\?\.scrollIntoView\(\{ block: "start" \}\);/, "if (!landing || !cleanSymbol(deepSymbol)) return;"],
  ["the analyser loses its anchor", CLIENT, /<section id="analyser" ref=\{analyserRef\}/, '<section ref={analyserRef}'],
  ["the hero mounted as a component again", CLIENT, /\{LandingHero\(\)\}/, "<LandingHero />"],
  ["the three points come back", CLIENT, /<div className="dlTry">/, '<div className="dlPoints"><h2>As filed</h2></div><div className="dlTry">'],
  ["the title reverted", PAGE, /const DASHBOARD_TITLE = "[^"]*";/, 'const DASHBOARD_TITLE = "Stock Chart Dashboard | MyStockHarbor";'],
  ["the ETF name seed dropped", CLIENT, /initialSymbolName \|\| ETF_NAMES\[defaultSymbol\.toUpperCase\(\)\] \|\| ""/, 'initialSymbolName'],
  ["the news card back on the market feed", CARDS_SRC, /getStockNewsBaseData\(sym, \{ maxDetailedItems: 5 \}\)/, "getGeneralMarketHeadlines()"],
  ["the S&P tile back on the weekly file", CARDS_SRC, /const eod = await readTiingoHistory\("SPY"\)/, 'const eod = await readWeekly("content/markets/spx-weekly.json")'],
  ["the landing read unbudgeted", PAGE, /budget\("landing", (getDashboardLanding\(\)\.catch\(\(\) => EMPTY_LANDING\)), EMPTY_LANDING\)/, "$1"],
];
for (const [label, file, from, to] of WIRING_MUTANTS) {
  const src = file === CLIENT ? clientSrc : file === PAGE ? pageSrc : cardsSrc;
  const m = src.replace(from, to);
  if (m === src) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = file === CLIENT ? wiring(m, pageSrc, cardsSrc) : file === PAGE ? wiring(clientSrc, m, cardsSrc) : wiring(clientSrc, pageSrc, m);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no rule failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
