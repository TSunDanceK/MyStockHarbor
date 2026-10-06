// THE /bottlenecks HUB (#125 COWORK): rules, then mutants.
//
// lib/bottleneckHub.ts (keys, distinct-page counts, the supplier / customer
// split, groups, themes, the web, the merge census), lib/bottlenecks.ts (the
// content read) and the hub's components are transpiled and run against
// today's content/bottlenecks/*.md and small fixtures; app/bottlenecks/page.tsx
// and claude/BOTTLENECKS.md are read as source. Rules: Amazon is one key with
// the summed distinct-page count; a page naming a company twice counts once;
// ticker keying; the alias map (and Samsung SDI kept apart); generic buckets
// never merge across pages; the supplier / customer split; ten rows plus "See
// full leaderboard", rows that open to chips, "Why it matters" behind a tap;
// the six themes with distinct-page counts; the capex link; the hero (title,
// tiles, search, web) and the phone rule (web hidden at 560px and under, top
// ten instead); the archive and list still there in the mobile order; sizes
// from rem or the tokens, fine print tagged, no transforms; describes, never
// advises; the workflow doc carries the keying rule. A mutant each.
//
//   node scripts/check-bottlenecks-hub.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stripComments } from "./lib/source-code.mjs";

// The reading-size reader, as scripts/check-reading-size.mjs defines it (that
// script runs its own suite on import, so the two functions are repeated here).
function sizesIn(src) {
  const out = [];
  for (const m of src.matchAll(/fontSize:\s*([^,}\n]+)/g)) out.push(m[1].trim());
  for (const m of src.matchAll(/font-size:\s*([^;"`}\n]+)/g)) out.push(m[1].trim());
  for (const m of src.matchAll(/fontSize=(\{[^}]*\}|"[^"]*")/g)) out.push(m[1].trim());
  return out;
}
function badSize(v) {
  if (/var\(--fs-(read|label|fine)\)/.test(v) || /^inherit|^"inherit"/.test(v)) return null;
  const nums = [...v.matchAll(/(?<![\w.$-])(\d+(?:\.\d+)?)(px|rem)?(?![\w.%])/g)];
  for (const [, n, unit] of nums) {
    if (unit === "px" || (!unit && !/^\{?\s*["'`]/.test(v) && /^\{?\s*[\d(]|\?\s*\d|:\s*\d/.test(v))) return `${v} (px)`;
    if (unit === "rem" && Number(n) < 0.75) return `${v} (under 0.75rem)`;
  }
  return null;
}

const read = (f) => fs.readFileSync(f, "utf8");
const UNITS = {
  hub: "lib/bottleneckHub.ts",
  content: "lib/bottlenecks.ts",
  logo: "app/components/TickerLogo.tsx",
  web: "app/components/BottleneckWeb.tsx",
  search: "app/components/BottleneckHubSearch.tsx",
  hero: "app/components/BottleneckHero.tsx",
  board: "app/components/BottleneckLeaderboard.tsx",
  themes: "app/components/BottleneckThemes.tsx",
  archive: "app/components/BottleneckArchive.tsx",
};
const PAGE = "app/bottlenecks/page.tsx", DOC = "claude/BOTTLENECKS.md";
const NEW_FILES = ["hub", "web", "search", "hero", "board", "themes"];
const IMPORT_OF = {
  "@/lib/bottleneckHub": "hub", "./bottleneckHub": "hub",
  "@/app/components/TickerLogo": "logo", "@/app/components/BottleneckWeb": "web",
  "@/app/components/BottleneckHubSearch": "search",
};
const ORDER = ["hub", "content", "logo", "web", "search", "hero", "board", "themes", "archive"];

let n = 0;
/** Transpiles every unit (with any overrides) to fresh temp modules wired to each other, and imports them. */
async function loadAll(over = {}) {
  const batch = `${process.pid}-${n++}`;
  const files = [];
  const mods = {};
  try {
    for (const u of ORDER) {
      let src = (over[u] ?? read(UNITS[u])).replace(/^import type[^;]+;$/gm, "");
      src = src.replace(/from "([^"]+)";/g, (m, spec) => (IMPORT_OF[spec] ? `from "./.check-bnhub-${batch}-${IMPORT_OF[spec]}.mjs";` : spec === "next/link" ? 'from "next/link.js";' : m));
      const js = ts.transpileModule(src, { fileName: UNITS[u], compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react", esModuleInterop: true } }).outputText;
      const tmp = `scripts/.check-bnhub-${batch}-${u}.mjs`;
      fs.writeFileSync(tmp, js);
      files.push(tmp);
      mods[u] = await import(`${process.cwd()}/${tmp}`);
    }
  } finally {
    for (const f of files) fs.rmSync(f, { force: true });
  }
  return mods;
}
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<title>[\s\S]*?<\/title>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&rsaquo;/g, "›").replace(/\s+/g, " ").trim();
const ADVICE = /\b(buy|buying|sell(?!s? to\b)|selling|should|must|recommend(?!ation\b)\w*|consider|opportunit\w*|bargain|undervalued|overvalued|cheap|target|upside|downside|will)\b/i;
const h = React.createElement;

// ── Fixtures ────────────────────────────────────────────────────────────────
const E = (name, ticker = null) => ({ name, ticker, pct: 10, blurb: "" });
const P = (slug, supplyChain, customers = []) => ({ slug, symbol: slug.toUpperCase(), companyName: `${slug.toUpperCase()} Corp`, category: "", domain: "", title: "", date: "2026-10-01", summary: "", disclaimer: "", supplyChainNote: "", customersNote: "", supplyChain, customers });
const FIX = [
  P("aaa", [E("Amazon.com, Inc. (AWS)", "AMZN"), E("Samsung Electronics"), E("Largest distributor")]),
  P("bbb", [E("Amazon (AWS)", "AMZN"), E("Samsung Foundry"), E("Samsung SDI"), E("Largest distributor")]),
  // Named twice on one page, on both charts: counts once, once in each half of the split.
  P("ccc", [E("Amazon (AWS)", "AMZN"), E("Valve Corporation"), E("Valve Corporation (Steam)")], [E("Amazon.com, Inc.", "AMZN"), E("Apple", "AAPL")]),
  // The same company written with no ticker joins the ticker'd key; GOOG folds into GOOGL.
  P("ddd", [E("Apple Inc."), E("Alphabet (Google Cloud)", "GOOGL"), E("Mastercard Incorporated", "MA")], [E("Alphabet Inc.", "GOOG")]),
];
const co = (cs, key) => cs.find((c) => c.key === key);
// THE RIM (#563 COWORK #131): with two hubs (AMZN, AAPL), "zzz" names neither and stays off the rim.
const RIM_FIX = [...FIX, P("zzz", [E("Samsung SDI"), E("Valve Corporation")])];
// THE SAFETY VALVE: 250 connected pages over a few sectors, uneven, each naming one or two hubs.
const SECTOR_NAMES = ["Technology", "Industrials", "Healthcare", "Financials", "Consumer Cyclical", "Energy", "Communication", "Utilities"];
const BIG_FIX = Array.from({ length: 250 }, (_, i) => P(`s${String(i).padStart(3, "0")}`, [E("Amazon (AWS)", "AMZN"), ...(i % 3 ? [] : [E("Apple", "AAPL")]), ...(i % 5 ? [] : [E("Nvidia", "NVDA")])]));
const bigSector = (sym) => SECTOR_NAMES[Number(sym.slice(1)) % 13 % SECTOR_NAMES.length];

const RULES = {
  "Amazon is one key: today every AMZN spelling (incl. 'Amazon.com, Inc. (AWS)' and 'Amazon (AWS)') merges, at the summed distinct-page count": ({ M, posts, companies }) => {
    const amzn = companies.filter((c) => /amazon/i.test(c.name) || c.key === "AMZN");
    const pages = new Set(posts.filter((p) => [...p.supplyChain, ...p.customers].some((e) => e.ticker === "AMZN")).map((p) => p.slug));
    const census = M.hub.buildMergeCensus(posts).find((r) => r.key === "AMZN");
    const fx = co(M.hub.buildHubCompanies(FIX), "AMZN");
    return amzn.length === 1 && amzn[0].key === "AMZN" && amzn[0].count === pages.size && pages.size > 26 &&
      ["Amazon.com, Inc. (AWS)", "Amazon (AWS)"].every((nm) => census.from.some((f) => f.name === nm)) && fx.count === 3 && fx.name === "Amazon";
  },
  "counts are distinct stock pages: a page naming a company twice counts once": ({ M, posts, companies }) => {
    const fx = M.hub.buildHubCompanies(FIX);
    const valve = companies.find((c) => c.key === "name:valve");
    const entries = posts.reduce((a, p) => a + [...p.supplyChain, ...p.customers].filter((e) => /^Valve Corporation/.test(e.name)).length, 0);
    return co(fx, "name:valve").count === 1 && co(fx, "AMZN").count === 3 && valve.count === valve.pages.length && valve.count < entries &&
      companies.every((c) => c.count === new Set(c.pages.map((p) => p.slug)).size);
  },
  "ticker keying: one ticker is one key whatever the name; a ticker-less exact name joins it; GOOG → GOOGL": ({ M, companies }) => {
    const fx = M.hub.buildHubCompanies(FIX);
    const keys = companies.map((c) => c.key);
    return co(fx, "AAPL").count === 2 && !fx.some((c) => c.key === "name:apple") && co(fx, "GOOGL").count === 1 && !co(fx, "GOOG") &&
      co(fx, "MA").name === "Mastercard" && new Set(keys).size === keys.length && companies.filter((c) => c.ticker === "TSM").length === 1 && co(companies, "TSM").count >= 29;
  },
  "the alias map: Samsung Foundry and 'Samsung Electronics (Foundry)' join Samsung Electronics; Samsung SDI stays apart": ({ M, posts, companies }) => {
    const fx = M.hub.buildHubCompanies(FIX);
    const census = M.hub.buildMergeCensus(posts).find((r) => r.key === "name:samsung electronics");
    return M.hub.NAME_ALIASES["samsung foundry"] === "samsung electronics" && co(fx, "name:samsung electronics").count === 2 && co(fx, "name:samsung sdi").count === 1 &&
      ["Samsung Foundry", "Samsung Electronics (Foundry)", "Samsung Electronics"].every((nm) => census.from.some((f) => f.name === nm)) && co(companies, "name:samsung sdi")?.count === 1;
  },
  "generic buckets ('Largest distributor') are keyed per page: never merged, never ranked": ({ M }) => {
    const fx = M.hub.buildHubCompanies(FIX);
    return M.hub.isGroupEntry(E("Largest distributor")) && !M.hub.isGroupEntry(E("Samsung Electronics")) && !M.hub.isGroupEntry(E("Other cloud", "XYZ")) &&
      !fx.some((c) => /distributor/i.test(c.name)) && M.hub.companyKey(E("Largest distributor"), new Map(), "aaa") !== M.hub.companyKey(E("Largest distributor"), new Map(), "bbb");
  },
  "the supplier / key-customer split counts pages per chart (supplyChain vs customers)": ({ M, companies }) => {
    const a = co(M.hub.buildHubCompanies(FIX), "AMZN"), meta = co(companies, "META");
    return a.supplierPages === 3 && a.customerPages === 1 && co(M.hub.buildHubCompanies(FIX), "AAPL").customerPages === 1 && co(M.hub.buildHubCompanies(FIX), "AAPL").supplierPages === 1 &&
      meta.supplierPages === 0 && meta.customerPages === meta.count && companies.every((c) => c.supplierPages <= c.count && c.customerPages <= c.count && c.supplierPages + c.customerPages >= c.count);
  },
  "the leaderboard: ten rows then 'See full leaderboard'; each row logo, name, 'named on N stock pages', split bar, ×N, opening to chips → /bottlenecks/[slug]": ({ board, boardSrc }) => {
    const rows = board.match(/<details class="bnLbRow">/g) ?? [];
    const first = board.slice(board.indexOf('<details class="bnLbRow">'), board.indexOf("</details>") + 10);
    return rows.length === 10 && /<button[^>]*>See full leaderboard<\/button>/.test(board) && /const TOP = 10;/.test(boardSrc) && /full \? rows : rows\.slice\(0, TOP\)/.test(boardSrc) &&
      /<summary class="bnLbSummary">/.test(first) && /named on 44 stock pages/.test(first) && /×44/.test(first) && /class="bnLbBar"/.test(first) &&
      /supplier \d+/.test(first) && /customer \d+/.test(first) && (first.match(/<a (?=[^>]*class="bnLbChip")(?=[^>]*href="\/bottlenecks\/[a-z0-9.-]+")[^>]*>/g) ?? []).length === 44 &&
      /<img [^>]*src="\/logos\/AMZN\.webp"|aria-hidden="true"[^>]*>A</.test(first) && /prefetch=\{false\} className="bnLbChip"/.test(boardSrc);
  },
  "'Why it matters' sits behind a tap (<details>), at --fs-read when open": ({ board, boardSrc }) =>
    /<details class="bnLbWhy"><summary>Why it matters<\/summary><p>A company that keeps showing up here/.test(board) && /\.bnLbWhy p \{[^}]*font-size: var\(--fs-read\)/.test(boardSrc),
  "six themes, from the editorial map, each counting distinct mapped pages; three logos each": ({ M, companies, themesHtml }) => {
    const t = M.hub.buildThemes(companies);
    const ids = t.map((x) => x.title).join("|");
    const cloud = t.find((x) => x.id === "cloud");
    const cloudPages = new Set(companies.filter((c) => M.hub.THEME_MAP[c.key] === "cloud").flatMap((c) => c.pages.map((p) => p.slug)));
    const fx = M.hub.buildThemes(M.hub.buildHubCompanies(FIX), { AMZN: "cloud", GOOGL: "cloud" }).find((x) => x.id === "cloud");
    return ids === "Chip foundry|Memory|AI accelerators|Cloud hosting|Payment networks|Big customers" && t.every((x) => x.line && x.top.length === 3 && x.pageCount > 0) &&
      cloud.pageCount === cloudPages.size && cloud.pageCount < cloud.top.reduce((a, c) => a + c.count, 0) && fx.pageCount === 4 &&
      t.every((x) => themesHtml.includes(`${x.pageCount} mapped stocks name a company here`)) && (themesHtml.match(/class="bnThemeCard"/g) ?? []).length === 6;
  },
  "the hub link card 'Follow the money: AI and data-centre capex' → /bottlenecks/capex, on the page": ({ themesHtml, page }) =>
    /<a (?=[^>]*class="bnCapexCard")(?=[^>]*href="\/bottlenecks\/capex")[^>]*>[\s\S]*?Follow the money: AI and data-centre capex[\s\S]*?<\/a>/.test(themesHtml) && /<BottleneckThemes themes=\{hub\.themes\} \/>/.test(page),
  "the hero: eyebrow, the one-line title in the h1, three stat tiles, the reworded search, the source note": ({ heroHtml, hub }) =>
    /<h1[^>]*><span[^>]*text-transform:uppercase[^>]*>Stock Bottlenecks<\/span><span[^>]*>Which companies the market can&#x27;t easily do without<\/span><\/h1>/.test(heroHtml) &&
    new RegExp(`>${hub.stats.stocksMapped}</div><div[^>]*>stocks mapped</div>`).test(heroHtml) && new RegExp(`>about </span>${hub.stats.companiesNamed}</div><div[^>]*>companies named</div>`).test(heroHtml) &&
    new RegExp(`>AMZN <span[^>]*>×${hub.stats.mostShared.count}</span></div><div[^>]*>most shared</div>`).test(heroHtml) &&
    /<label[^>]*>Search a stock: what does it depend on\?<\/label>/.test(heroHtml) && /Dependencies come from public filings and research\. The shares on each stock page are editorial estimates/.test(heroHtml),
  "the web: server-rendered SVG, the top 8 hubs sized by page count, a line per stock naming each, 'N stocks depend on X'": ({ heroHtml, hub, webSrc }) => {
    const hubs = heroHtml.match(/<g class="bnHub bnHub-\d+"[^>]*aria-label="(\d+) stocks depend on ([^"]+)"/g) ?? [];
    const lines = hub.web.hubs.map((x, i) => ((heroHtml.split(`class="bnLinks bnLinks-${i}"`)[1] ?? "").split("</g>")[0].match(/<line /g) ?? []).length);
    return hubs.length === 8 && hub.web.hubs.every((x, i) => x.key === hub.companies[i].key && lines[i] === hub.companies[i].count && (i === 0 || x.r <= hub.web.hubs[i - 1].r)) &&
      /<svg class="bnWeb"/.test(heroHtml) && heroHtml.includes(`>${hub.companies[0].count} stocks depend on ${hub.companies[0].name}</p>`) && !/^"use client"/.test(webSrc.trim()) && !/from "(recharts|d3|chart\.js)/.test(webSrc);
  },
  "the rim: only stocks naming a hub, each with a line; the caption counts the dots; the tiles still count every page": ({ M, hub, heroHtml }) => {
    const fx = M.hub.buildDependencyWeb(RIM_FIX, M.hub.buildHubCompanies(RIM_FIX), 2);
    const dots = (heroHtml.match(/<circle class="bnStock /g) ?? []).length;
    const linesTo = (slug) => hub.web.hubs.filter((x) => (heroHtml.split(`class="bnLinks bnLinks-${hub.web.hubs.indexOf(x)}"`)[1] ?? "").split("</g>")[0].includes(`<line x1="${hub.web.stocks.find((t) => t.slug === slug).x}" y1="${hub.web.stocks.find((t) => t.slug === slug).y}"`)).length;
    return fx.hubs.map((x) => x.key).join() === "AMZN,AAPL" && !fx.stocks.some((t) => t.slug === "zzz") && fx.stocks.length === 4 && fx.connected === 4 && fx.arcs === null &&
      hub.web.stocks.length === hub.web.connected && hub.web.stocks.every((t) => t.hubs.length > 0 && linesTo(t.slug) === t.hubs.length) &&
      dots === hub.web.connected && heroHtml.includes(`>${hub.web.connected} stocks that name one of these 8. Hover or tap a hub to see who names it.</p>`) &&
      hub.stats.stocksMapped === M.content.getAllBottleneckPosts().length;
  },
  "the safety valve: past 200 connected pages the rim is sector arcs, one bundled line per hub and sector, as wide as its pages": ({ M }) => {
    const companies = M.hub.buildHubCompanies(BIG_FIX), web = M.hub.buildDependencyWeb(BIG_FIX, companies, 8, bigSector);
    const small = M.hub.buildDependencyWeb(BIG_FIX.slice(0, 200), M.hub.buildHubCompanies(BIG_FIX.slice(0, 200)), 8, bigSector);
    const html = renderToStaticMarkup(h(M.web.default, { web }));
    const sum = (f) => web.arcs.reduce((a, x) => a + f(x), 0);
    const amznIn = (x) => x.bundles.find((b) => b.hub === "AMZN")?.pages ?? 0;
    const widths = web.arcs.flatMap((x) => x.bundles), byPages = [...widths].sort((a, b) => a.pages - b.pages);
    return M.hub.WEB.maxDots === 200 && small.arcs === null && small.stocks.length === 200 &&
      web.stocks.length === 0 && web.connected === 250 && web.arcs.length === SECTOR_NAMES.length && sum((x) => x.count) === 250 && sum(amznIn) === 250 &&
      web.hubs.every((hb) => sum((x) => x.bundles.find((b) => b.hub === hb.key)?.pages ?? 0) === co(companies, hb.key).count) &&
      byPages.every((b, i) => i === 0 || b.width >= byPages[i - 1].width) && byPages[0].width < byPages.at(-1).width &&
      !/class="bnStock /.test(html) && (html.match(/<g class="bnArc /g) ?? []).length === web.arcs.length &&
      (html.match(/<line class="bnBundle"/g) ?? []).length === widths.length && html.includes(">250 stocks that name one of these 3. Hover or tap a hub to see who names it.</p>") &&
      web.arcs.every((x) => html.includes(`<title>${x.sector}: ${x.count} stocks</title>`));
  },
  "phones (≤560px): the web hidden by CSS, the top ten as a list instead": ({ heroHtml, heroSrc, hub }) =>
    /@media \(max-width: 560px\) \{\s*\.bnWebBlock \{ display: none; \}\s*\.bnTopList \{ display: block; \}\s*\}/.test(heroSrc) && /\.bnTopList \{ display: none; \}/.test(heroSrc) &&
    /<div class="bnWebBlock"[^>]*><div class="bnWebWrap"><svg class="bnWeb"/.test(heroHtml) &&
    ((heroHtml.split('class="bnTopList"')[1] ?? "").match(/<li /g) ?? []).length === 10 && heroHtml.split('class="bnTopList"')[1].includes(`×${hub.companies[9].count}</span></li></ol>`),
  "the archive and the Latest/A–Z list are still there, in the mobile order (main, rail, themes, archive)": ({ page, archiveHtml }) =>
    /<BottleneckList posts=\{posts\} \/>/.test(page) && /<BottleneckArchive posts=\{posts\} \/>/.test(page) && /<section data-bntab="list">\s*<BottleneckList/.test(page) &&
    /<div data-bntab="list" style=\{\{ gridArea: "archive", minWidth: 0 \}\}>\s*<BottleneckArchive/.test(page) && /grid-template-areas: "main" "rail" "themes" "archive" !important;/.test(page) &&
    FIX.every((p) => archiveHtml.includes(`href="/bottlenecks/${p.slug}"`)) && /<details/.test(archiveHtml),
  "sizes from rem or the tokens (no px), fine print tagged at --fs-fine, no transforms": ({ srcs, heroHtml }) =>
    Object.values(srcs).every((s) => sizesIn(s).every((v) => badSize(v) === null) && !/(?<![-\w])transform\s*[:=]/i.test(s)) &&
    /<p data-fine-print="true" style="[^"]*font-size:var\(--fs-fine\)[^"]*">Dependencies come from/.test(heroHtml) &&
    !/font-size:\s*\d+(\.\d+)?px/.test(heroHtml),
  "describes, never advises (hero, web, leaderboard, themes)": ({ heroHtml, board, themesHtml }) => [heroHtml, board, themesHtml].every((x) => !ADVICE.test(text(x))),
  "the workflow doc carries the keying rule: ticker, else normalised name + alias map; distinct pages": ({ doc }) =>
    /ticker when present/i.test(doc) && /normalised name/i.test(doc) && /NAME_ALIASES/.test(doc) && /distinct (stock )?pages/i.test(doc) && /lib\/bottleneckHub\.ts/.test(doc),
};

async function measure(over = {}) {
  const M = await loadAll(over);
  const posts = M.content.getAllBottleneckPosts();
  const hub = M.hub.buildBottleneckHub(posts);
  const companies = hub.companies;
  const rows = companies.filter((c) => c.count >= 2);
  const src = (u) => stripComments(over[u] ?? read(UNITS[u]), { file: UNITS[u] });
  return {
    M, posts, hub, companies,
    heroHtml: renderToStaticMarkup(h(M.hero.default, { hub, items: posts.map(({ slug, symbol, companyName }) => ({ slug, symbol, companyName })) })),
    board: renderToStaticMarkup(h(M.board.default, { rows, singles: companies.length - rows.length })),
    themesHtml: renderToStaticMarkup(h(M.themes.default, { themes: hub.themes })),
    archiveHtml: renderToStaticMarkup(h(M.archive.default, { posts: FIX })),
    boardSrc: src("board"), heroSrc: src("hero"), webSrc: src("web"),
    srcs: Object.fromEntries(NEW_FILES.map((u) => [u, src(u)]).concat([["page", stripComments(over.page ?? read(PAGE), { file: PAGE })]])),
    page: stripComments(over.page ?? read(PAGE), { file: PAGE }),
    doc: over.doc ?? read(DOC),
  };
}

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };

console.log("=== Rules ===");
const base = await measure();
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));
console.log("  top 10: " + base.companies.slice(0, 10).map((c) => `${c.ticker ?? c.name} ×${c.count} (s${c.supplierPages}/c${c.customerPages})`).join(" · "));
console.log("  themes: " + base.hub.themes.map((t) => `${t.title} ${t.pageCount}`).join(" · "));

const R = Object.keys(RULES);
const find = (start) => { const r = R.find((x) => x.startsWith(start)); if (!r) throw new Error(`no rule ${start}`); return r; };
// [rule, unit (a UNITS key, "page" or "doc"), mutation]
const MUTANTS = [
  ["Amazon is one key", "hub", (s) => s.replace("if (raw) return TICKER_ALIASES[raw] ?? raw;", "if (raw) return `${TICKER_ALIASES[raw] ?? raw}:${normName(company.name)}`;")],
  ["counts are distinct", "hub", (s) => s.replace("acc.pages.set(post.slug, page);", "acc.pages.set(`${post.slug}#${acc.pages.size}`, page);")],
  ["ticker keying", "hub", (s) => s.replace("return tickerByName.get(aliased) ?? `name:${aliased}`;", "return `name:${aliased}`;")],
  ["ticker keying", "hub", (s) => s.replace("  GOOG: \"GOOGL\",\n", "")],
  ["the alias map", "hub", (s) => s.replace('  "samsung foundry": "samsung electronics",\n', "")],
  ["the alias map", "hub", (s) => s.replace('"samsung foundry": "samsung electronics",', '"samsung foundry": "samsung electronics", "samsung sdi": "samsung electronics",')],
  ["generic buckets", "hub", (s) => s.replace("|rest of|largest|", "|rest of|")],
  ["the supplier / key-customer split", "hub", (s) => s.replace('(chart === "supplier" ? acc.supplier : acc.customer).add(post.slug);', "acc.supplier.add(post.slug);")],
  ["the leaderboard:", "board", (s) => s.replace("const TOP = 10;", "const TOP = 12;")],
  ["the leaderboard:", "board", (s) => s.replace(/(\s+)See full leaderboard(\s+<\/button>)/, "$1See more$2")],
  ["the leaderboard:", "board", (s) => s.replace("href={`/bottlenecks/${p.slug}`} prefetch={false} className=\"bnLbChip\"", "href={`/stock/${p.symbol}`} prefetch={false} className=\"bnLbChip\"")],
  ["'Why it matters'", "board", (s) => s.replace('<details className="bnLbWhy">\n        <summary>Why it matters</summary>', '<div className="bnLbWhy">\n        <div>Why it matters</div>').replace("        </p>\n      </details>", "        </p>\n      </div>")],
  ["six themes", "hub", (s) => s.replace("return { ...t, pageCount: pages.size, top: members.slice(0, 3) };", "return { ...t, pageCount: members.reduce((a, c) => a + c.count, 0), top: members.slice(0, 3) };")],
  ["six themes", "hub", (s) => s.replace('  { id: "payments", title: "Payment networks", line: "The rails card and online payments run on." },\n', "")],
  ["the hub link card", "themes", (s) => s.replace('href="/bottlenecks/capex"', 'href="/capex"')],
  ["the hub link card", "page", (s) => s.replace("<BottleneckThemes themes={hub.themes} />", "")],
  ["the hero:", "hero", (s) => s.replace('"Which companies the market can\'t easily do without"', '"Stock bottlenecks"')],
  ["the hero:", "search", (s) => s.replace("Search a stock: what does it depend on?", "Search by company name or ticker...")],
  ["the web:", "hub", (s) => s.replace("ring: 116, edge: 236, hubs: 8,", "ring: 116, edge: 236, hubs: 6,")],
  ["the web:", "hub", (s) => s.replace("r: round(24 + 13 * Math.sqrt(c.count / max)),", "r: 30,").replace("const top = companies.slice(0, hubCount);", "const top = companies.slice(0, hubCount).reverse();")],
  // An unconnected page back on the rim; the caption counting every page.
  ["the rim:", "hub", (s) => s.replace("    .filter((x) => x.linked.length > 0);\n", "\n")],
  ["the rim:", "web", (s) => s.replace("{connected} stocks that name one of these {hubs.length}.", "{stocks.length + 1} stocks that name one of these {hubs.length}.")],
  // The valve never opening; bundles all one width.
  ["the safety valve", "hub", (s) => s.replace("if (linked.length > maxDots) return", "if (linked.length > maxDots * 10) return")],
  ["the safety valve", "hub", (s) => s.replace(".map((b) => ({ ...b, width: round(1 + 7 * (b.pages / bundleMax)) })),", ".map((b) => ({ ...b, width: 2 })),")],
  ["phones", "hero", (s) => s.replace("          .bnWebBlock { display: none; }\n", "")],
  ["phones", "hero", (s) => s.replace("{companies.slice(0, 10).map(", "{companies.slice(0, 5).map(")],
  ["the archive", "page", (s) => s.replace("<BottleneckArchive posts={posts} />", "")],
  ["the archive", "page", (s) => s.replace('grid-template-areas: "main" "rail" "themes" "archive" !important;', 'grid-template-areas: "main" "archive" "rail" "themes" !important;')],
  ["sizes from rem", "hero", (s) => s.replace('const tileLabel: React.CSSProperties = { marginTop: 4, fontSize: "var(--fs-label)"', 'const tileLabel: React.CSSProperties = { marginTop: 4, fontSize: 13')],
  ["sizes from rem", "hero", (s) => s.replace("<p data-fine-print style=", "<p style=")],
  ["sizes from rem", "board", (s) => s.replace(".bnLbBar > span { display: block; height: 100%; }", ".bnLbBar > span { display: block; height: 100%; transform: scaleX(1); }")],
  ["sizes from rem", "themes", (s) => s.replace('<h3 style={{ margin: 0, fontSize: "1.0625rem"', '<h3 style={{ margin: 0, fontSize: "15px"')],
  ["describes, never advises", "hero", (s) => s.replace("These are the companies those pages name most often.", "These are the companies you should buy before they run.")],
  ["the workflow doc", "doc", (s) => s.replace(/NAME_ALIASES/g, "the aliases")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [start, unit, mutate] of MUTANTS) {
  const label = find(start);
  const src = read(unit === "page" ? PAGE : unit === "doc" ? DOC : UNITS[unit]), mut = mutate(src);
  if (mut === src) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  let m;
  try { m = await measure({ [unit]: mut }); } catch { m = null; }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
