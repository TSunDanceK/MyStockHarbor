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
  const hrefs = [...(cardHtml(full, "pickers") ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h !== "/pickers");
  want("every Pickers screen links to a PICKER_ROUTES page", hrefs.length === 5 && hrefs.every((h) => PICKER_ROUTES.includes(h)));
  want("DASHBOARD_SCREENS are all PICKER_ROUTES pages", Array.isArray(scr) && scr.length === 5 && scr.every((s) => PICKER_ROUTES.includes(s.href)));
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
  want("the landing's H1 is the brief's", /<h1 className="dlH1">Stock research from the filings, not the hype\.<\/h1>/.test(c));
  want("the old header H1 stays off the landing", /\{!landing \? \(<>\s*<div className="msh-hero">/.test(c));
  want("the cards are cached with their sources (15 min)", /unstable_cache\(loadDashboardLanding, \["dashboard-landing-v1"\], \{ revalidate: 900/.test(stripComments(cardsSrc, { file: CARDS_SRC })));
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
];
for (const [label, from, to] of LANDING_MUTANTS) {
  if (!landingSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = rules(await loadLanding(landingSrc.replace(from, to)));
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no rule failed");
}
const WIRING_MUTANTS = [
  ["the deep link no longer scrolls", CLIENT, /if \(!landing \|\| !cleanSymbol\(deepSymbol\)\) return;\s*analyserRef\.current\?\.scrollIntoView\(\{ block: "start" \}\);/, "if (!landing || !cleanSymbol(deepSymbol)) return;"],
  ["the analyser loses its anchor", CLIENT, /<section id="analyser" ref=\{analyserRef\}/, '<section ref={analyserRef}'],
  ["the landing read unbudgeted", PAGE, /budget\("landing", (getDashboardLanding\(\)\.catch\(\(\) => EMPTY_LANDING\)), EMPTY_LANDING\)/, "$1"],
];
for (const [label, file, from, to] of WIRING_MUTANTS) {
  const src = file === CLIENT ? clientSrc : pageSrc;
  const m = src.replace(from, to);
  if (m === src) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = file === CLIENT ? wiring(m, pageSrc, cardsSrc) : wiring(clientSrc, m, cardsSrc);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no rule failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
